using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;

namespace LocalCrmAgent.Services;

/// <summary>
/// Background service that uploads recordings to PocketBase.
/// Uses auth token relayed from the dashboard via WebSocket.
///
/// Performance design:
/// - Event-driven: wakes immediately when a recording is linked (no polling delay)
/// - Parallel uploads: processes up to 3 recordings concurrently
/// - Non-blocking backoff: skips recordings in cooldown, processes others immediately
/// - Phone number resolution runs in parallel with upload prep
/// </summary>
public class RecordingUploadService : IDisposable
{
    private readonly RecordingStorageManager _storage;
    // Default HttpClient.Timeout (100 s) is too tight for large MP3 uploads
    // on slow links and too lenient for completely wedged sockets. Five
    // minutes is a reasonable upper bound for any single upload attempt;
    // backoff handles the retry side.
    private readonly HttpClient _httpClient = new() { Timeout = TimeSpan.FromMinutes(5) };
    private readonly object _lock = new();

    // Lightweight global circuit breaker: after this many consecutive upload
    // failures across any file we pause all uploads for the cooldown window
    // so we don't hammer PocketBase during a wider outage / token revocation.
    private const int CircuitFailureThreshold = 5;
    private static readonly TimeSpan CircuitCooldown = TimeSpan.FromSeconds(60);
    private int _consecutiveFailures;
    private DateTime _circuitOpenUntil = DateTime.MinValue;

    private string? _workerBaseUrl;
    private string? _agentToken;
    private string? _repUserId;
    private string? _fallbackBaseUrl;
    private ZoomPhoneApiService? _zoomApi;

    private CancellationTokenSource? _cts;
    private Task? _uploadTask;

    // Signal the upload loop to wake up immediately
    private readonly SemaphoreSlim _wakeSignal = new(0, int.MaxValue);

    // Track last attempt time per file for non-blocking backoff
    private readonly Dictionary<string, DateTime> _lastAttemptTime = new();

    // Exponential backoff delays (in seconds)
    private static readonly int[] BackoffDelays = [5, 15, 30, 60, 300, 900];

    // Max concurrent uploads
    private const int MaxConcurrent = 3;

    public event Action<string, string?, string?, bool, string?>? UploadCompleted;
    public event Action? UploadAuthExpired;
    public event Action<string, long, long>? UploadProgress;
    /// <summary>
    /// Fired when consecutive failures trip the global circuit breaker so
    /// the dashboard can surface a clear "uploads paused" indicator instead
    /// of leaving the user to wonder why pending uploads stopped progressing.
    /// </summary>
    public event Action<int, string?>? CircuitBreakerTripped;

    public bool IsConfigured
    {
        get { lock (_lock) return _workerBaseUrl != null && _agentToken != null; }
    }

    public string? CurrentUpload { get; private set; }

    /// <summary>True when the most recent upload attempt failed with a
    /// network-class error (primary AND fallback unreachable). Cleared on the
    /// next successful upload. The tray uses this to show "server offline".</summary>
    public bool LastFailureWasNetwork { get; private set; }

    /// <summary>True when the last accepted upload went through the fallback
    /// cloud relay instead of the primary worker. Cleared when the primary
    /// accepts again. The tray uses this to show "uploading via cloud relay".</summary>
    public bool LastUploadViaFallback { get; private set; }

    /// <summary>Uploads are effectively paused: the last attempt died on the
    /// network (both URLs) or the global circuit breaker is open.</summary>
    public bool IsOffline => LastFailureWasNetwork || IsCircuitOpen();

    public RecordingUploadService(RecordingStorageManager storage)
    {
        _storage = storage;
    }

    /// <summary>Wire the Zoom Phone API client so uploads can resolve the real
    /// call_id + external number from call_history via a device-IP match.</summary>
    public void SetZoomApi(ZoomPhoneApiService zoomApi) => _zoomApi = zoomApi;

    /// <summary>
    /// Configure the GHL worker upload target. Recordings are POSTed to
    /// <c>{workerBaseUrl}/recordings/ingest</c> with the shared agent bearer
    /// token; the worker matches the contact by phone and attaches the clip.
    /// </summary>
    public void SetWorkerConfig(string workerBaseUrl, string agentToken, string? repUserId)
    {
        lock (_lock)
        {
            _workerBaseUrl = workerBaseUrl.TrimEnd('/');
            _agentToken = agentToken;
            _repUserId = repUserId;
        }
        Debug.WriteLine($"[Upload] Worker upload configured for {workerBaseUrl}");
        Wake(); // process any pending uploads immediately
    }

    /// <summary>
    /// Configure the cloud-relay base URL tried when the primary worker is
    /// unreachable or answers 5xx. Same /recordings/ingest contract and the
    /// same bearer token; null disables the fallback path.
    /// </summary>
    public void SetFallbackBaseUrl(string? fallbackBaseUrl)
    {
        lock (_lock)
        {
            _fallbackBaseUrl = string.IsNullOrWhiteSpace(fallbackBaseUrl)
                ? null
                : fallbackBaseUrl.TrimEnd('/');
        }
        Debug.WriteLine($"[Upload] Fallback relay configured: {fallbackBaseUrl ?? "(none)"}");
    }

    /// <summary>
    /// Update just the rep identity (repKey) without touching the worker URL or
    /// token. Used when the Chrome extension pushes the rep's resolved GoHighLevel
    /// user id, so call attribution needs no manual setup on the machine.
    /// </summary>
    public void SetRepUserId(string repUserId)
    {
        lock (_lock)
        {
            _repUserId = repUserId;
        }
        Debug.WriteLine($"[Upload] Rep identity set to {repUserId}");
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _uploadTask = Task.Run(() => ProcessLoop(_cts.Token));
        Debug.WriteLine("[Upload] Service started");
    }

    /// <summary>Wake the upload loop immediately (called after linking, auth, etc).</summary>
    private void Wake()
    {
        try { _wakeSignal.Release(); } catch { /* already at max */ }
    }

    private async Task ProcessLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!IsConfigured)
                {
                    // Wait for auth — wake signal or 5s timeout
                    await WaitForSignal(5000, ct);
                    continue;
                }

                if (IsCircuitOpen())
                {
                    var wait = (int)Math.Max(500, (_circuitOpenUntil - DateTime.UtcNow).TotalMilliseconds);
                    await WaitForSignal(wait, ct);
                    continue;
                }

                var pending = _storage.GetPendingUploads();
                if (pending.Count == 0)
                {
                    // Nothing to upload — wait for wake signal or 2s poll
                    await WaitForSignal(2000, ct);
                    continue;
                }

                // Filter out recordings still in backoff cooldown
                var ready = pending.Where(e => !IsInBackoff(e)).ToList();
                if (ready.Count == 0)
                {
                    // All pending are in backoff — wait shortest remaining cooldown
                    var minWait = pending.Min(e => GetRemainingBackoffMs(e));
                    await WaitForSignal(Math.Max(500, minWait), ct);
                    continue;
                }

                // Upload up to MaxConcurrent recordings in parallel
                var batch = ready.Take(MaxConcurrent).ToList();
                var tasks = batch.Select(entry => UploadRecording(entry, ct)).ToList();
                await Task.WhenAll(tasks);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Upload] Loop error: {ex.Message}");
                await WaitForSignal(5000, ct);
            }
        }
    }

    /// <summary>Wait for wake signal OR timeout, whichever comes first.</summary>
    private async Task WaitForSignal(int timeoutMs, CancellationToken ct)
    {
        try { await _wakeSignal.WaitAsync(timeoutMs, ct); }
        catch (OperationCanceledException) { throw; }
        catch { /* timeout is fine */ }
    }

    private bool IsInBackoff(RecordingEntry entry)
    {
        if (entry.RetryCount == 0) return false;
        lock (_lastAttemptTime)
        {
            if (!_lastAttemptTime.TryGetValue(entry.FileName, out var lastAttempt))
                return false;
            var delayIdx = Math.Min(entry.RetryCount - 1, BackoffDelays.Length - 1);
            return DateTime.UtcNow < lastAttempt.AddSeconds(BackoffDelays[delayIdx]);
        }
    }

    private int GetRemainingBackoffMs(RecordingEntry entry)
    {
        if (entry.RetryCount == 0) return 0;
        lock (_lastAttemptTime)
        {
            if (!_lastAttemptTime.TryGetValue(entry.FileName, out var lastAttempt))
                return 0;
            var delayIdx = Math.Min(entry.RetryCount - 1, BackoffDelays.Length - 1);
            var remaining = lastAttempt.AddSeconds(BackoffDelays[delayIdx]) - DateTime.UtcNow;
            return Math.Max(0, (int)remaining.TotalMilliseconds);
        }
    }

    private async Task UploadRecording(RecordingEntry entry, CancellationToken ct)
    {
        string? workerBaseUrl, agentToken, repUserId, fallbackBaseUrl;
        lock (_lock)
        {
            workerBaseUrl = _workerBaseUrl;
            agentToken = _agentToken;
            repUserId = _repUserId;
            fallbackBaseUrl = _fallbackBaseUrl;
        }

        if (workerBaseUrl == null || agentToken == null) return;

        var filePath = Path.Combine(_storage.RecordingsDirectory, entry.FileName);
        if (!File.Exists(filePath))
        {
            Debug.WriteLine($"[Upload] File not found, removing entry: {entry.FileName}");
            _storage.RemoveEntry(entry.FileName);
            return;
        }

        // Track attempt time for non-blocking backoff
        lock (_lastAttemptTime) { _lastAttemptTime[entry.FileName] = DateTime.UtcNow; }

        // Derive the worker ingest metadata from the recording. Prefer the
        // dashboard-issued client call id (bound to the dial) so a retry dedups
        // against the first attempt; otherwise mint a deterministic id from
        // (channel, rep, connect time), which is equally retry-stable. The
        // worker keys clip:{clientCallId} for idempotency.
        var channel = string.IsNullOrEmpty(entry.Channel) ? "desktop" : entry.Channel;
        var rep = repUserId ?? "";
        var connectTsMs = new DateTimeOffset(
            DateTime.SpecifyKind(entry.StartTime, DateTimeKind.Utc)).ToUnixTimeMilliseconds();
        var endTsMs = connectTsMs + (long)entry.DurationSeconds * 1000;
        var clientCallId = !string.IsNullOrEmpty(entry.ClientCallId)
            ? entry.ClientCallId!
            : $"{channel}:{rep}:{connectTsMs}";

        // Resolve the real Zoom call_id + external number from call_history by
        // matching THIS machine's device IP + the recording start time, so the
        // worker can correlate by exact call_id. On the shared Zoom account this
        // is how the desktop number is obtained at all (it isn't reliably visible
        // in the desktop UI). Best-effort; falls back to phone+time on the worker.
        if (string.IsNullOrEmpty(entry.ZoomCallId) && _zoomApi is { IsConfigured: true })
        {
            try
            {
                var startUtc = DateTime.SpecifyKind(entry.StartTime, DateTimeKind.Utc);
                var (cid, phone) = await _zoomApi.ResolveOwnCallAsync(startUtc);
                if (!string.IsNullOrEmpty(cid))
                {
                    _storage.UpdateEntry(entry.FileName, e =>
                    {
                        e.ZoomCallId = cid;
                        if (!string.IsNullOrEmpty(phone)) e.PhoneNumber = phone;
                    });
                    entry.ZoomCallId = cid;
                    if (!string.IsNullOrEmpty(phone)) entry.PhoneNumber = phone;
                    FileLogger.Write($"[Upload] Resolved Zoom call {cid} for {entry.FileName} (phone={phone})");
                }
            }
            catch (Exception ex) { Debug.WriteLine($"[Upload] Zoom call resolve failed: {ex.Message}"); }
        }

        var phoneE164 = (entry.PhoneNumber ?? "").Trim();
        var isWav = entry.FileName.EndsWith(".wav", StringComparison.OrdinalIgnoreCase);
        var contentType = isWav ? "audio/wav" : "audio/mpeg";

        try
        {
            CurrentUpload = entry.FileName;

            // ── Primary attempt ─────────────────────────────────────────
            HttpResponseMessage? response = null;
            string? primaryNetworkError = null;
            try
            {
                response = await SendIngestAsync(workerBaseUrl, agentToken, entry, filePath, contentType,
                    clientCallId, rep, channel, phoneE164, connectTsMs, endTsMs, ct);
            }
            catch (Exception ex) when (IsNetworkException(ex, ct))
            {
                primaryNetworkError = DescribeNetworkError(ex);
            }

            // Network-class failure or 5xx from the primary → one immediate
            // retry against the cloud relay before counting the attempt failed.
            var primaryServerError = response != null && (int)response.StatusCode >= 500;
            if (response == null || primaryServerError)
            {
                var primaryProblem = primaryNetworkError ?? $"HTTP {(int)response!.StatusCode} from primary";

                if (!string.IsNullOrEmpty(fallbackBaseUrl)
                    && !string.Equals(fallbackBaseUrl, workerBaseUrl, StringComparison.OrdinalIgnoreCase))
                {
                    response?.Dispose();
                    FileLogger.Write($"[Upload] Primary failed ({primaryProblem}) — retrying via cloud relay {fallbackBaseUrl}: {entry.FileName}");

                    HttpResponseMessage? fbResponse = null;
                    string? fbNetworkError = null;
                    try
                    {
                        fbResponse = await SendIngestAsync(fallbackBaseUrl, agentToken, entry, filePath, contentType,
                            clientCallId, rep, channel, phoneE164, connectTsMs, endTsMs, ct);
                    }
                    catch (Exception ex) when (IsNetworkException(ex, ct))
                    {
                        fbNetworkError = DescribeNetworkError(ex);
                    }

                    if (fbResponse != null &&
                        (fbResponse.IsSuccessStatusCode || fbResponse.StatusCode == HttpStatusCode.Conflict))
                    {
                        CurrentUpload = null;
                        await HandleAcceptedResponse(entry, fbResponse, viaFallback: true, ct);
                        return;
                    }

                    // Both paths failed. Never permanent here: the primary was
                    // unreachable, so a 4xx from the relay isn't a trustworthy
                    // verdict on the clip — keep retrying on the backoff cadence.
                    var fbProblem = fbNetworkError ?? $"HTTP {(int)fbResponse!.StatusCode} from fallback";
                    fbResponse?.Dispose();
                    CurrentUpload = null;
                    FileLogger.Write($"[Upload] Both primary and relay failed for {entry.FileName} — primary: {primaryProblem}; relay: {fbProblem}");
                    HandleNetworkFailure(entry, $"primary: {primaryProblem}; relay: {fbProblem}");
                    return;
                }

                // No fallback configured — behave exactly as before (retry forever).
                response?.Dispose();
                CurrentUpload = null;
                Debug.WriteLine($"[Upload] Network/server failure: {entry.FileName} — {primaryProblem}");
                HandleNetworkFailure(entry, primaryProblem);
                return;
            }

            CurrentUpload = null;

            if (response.StatusCode == HttpStatusCode.Unauthorized)
            {
                FileLogger.Write($"[Upload] Rejected 401 (agent token invalid/missing): {entry.FileName}");
                UploadAuthExpired?.Invoke();
                return;
            }

            // 4xx (other than 401/409) → permanent failure: retrying won't help.
            if (response.StatusCode != HttpStatusCode.Conflict
                && (int)response.StatusCode >= 400 && (int)response.StatusCode < 500)
            {
                var body = await SafeReadBody(response, ct);
                var errMsg = $"HTTP {(int)response.StatusCode}: {body}";
                FileLogger.Write($"[Upload] Permanent failure (won't retry): {entry.FileName} — {errMsg}");
                _storage.UpdateEntry(entry.FileName, e => { e.Error = errMsg; });
                UploadCompleted?.Invoke(entry.FileName, null, entry.CallLogId, false, errMsg);
                lock (_lastAttemptTime) { _lastAttemptTime.Remove(entry.FileName); }
                return;
            }

            // 200/202/409 from the primary.
            await HandleAcceptedResponse(entry, response, viaFallback: false, ct);
        }
        catch (OperationCanceledException) { CurrentUpload = null; throw; }
        catch (Exception ex)
        {
            CurrentUpload = null;
            Debug.WriteLine($"[Upload] Failed: {entry.FileName} — {ex.Message}");
            _storage.UpdateEntry(entry.FileName, e =>
            {
                e.RetryCount++;
                e.Error = e.RetryCount >= 10 ? ex.Message : null;
            });

            if (entry.RetryCount + 1 >= 10)
            {
                UploadCompleted?.Invoke(entry.FileName, null, entry.CallLogId, false, ex.Message);
            }
        }
    }

    /// <summary>
    /// POST the recording multipart to <c>{baseUrl}/recordings/ingest</c>.
    /// The form (and the underlying file stream) is rebuilt per attempt because
    /// multipart content cannot be resent — the fallback retry calls this again.
    /// Network-class failures surface as exceptions for the caller to classify.
    /// </summary>
    private async Task<HttpResponseMessage> SendIngestAsync(
        string baseUrl, string agentToken, RecordingEntry entry, string filePath, string contentType,
        string clientCallId, string rep, string channel, string phoneE164,
        long connectTsMs, long endTsMs, CancellationToken ct)
    {
        using var form = new MultipartFormDataContent();
        using var fileStream = File.OpenRead(filePath);
        var totalBytes = fileStream.Length;
        var fileNameForProgress = entry.FileName;
        var fileContent = new ProgressableStreamContent(fileStream, (sent, total) =>
        {
            try { UploadProgress?.Invoke(fileNameForProgress, sent, total); } catch { }
        });
        fileContent.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        fileContent.Headers.ContentLength = totalBytes;
        form.Add(fileContent, "clip", entry.FileName);

        // Identifier-only payload: the worker owns direction + contact match.
        form.Add(new StringContent(clientCallId), "clientCallId");
        form.Add(new StringContent(rep), "repKey");
        form.Add(new StringContent(channel), "channel");
        if (!string.IsNullOrEmpty(entry.ZoomCallId)) form.Add(new StringContent(entry.ZoomCallId), "zoomCallId");
        if (!string.IsNullOrEmpty(phoneE164)) form.Add(new StringContent(phoneE164), "phoneE164");
        form.Add(new StringContent(connectTsMs.ToString()), "connectTsMs");
        form.Add(new StringContent(endTsMs.ToString()), "endTsMs");

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{baseUrl}/recordings/ingest");
        request.Headers.TryAddWithoutValidation("Authorization", $"Bearer {agentToken}");
        request.Content = form;

        // Default SendAsync buffers the full response before returning, so the
        // response body stays readable after form/stream disposal here.
        return await _httpClient.SendAsync(request, ct);
    }

    /// <summary>
    /// Network-class exception filter for a single ingest attempt: DNS/socket
    /// failures, connection resets mid-transfer, and HttpClient timeouts (an
    /// OperationCanceledException NOT caused by our own cancellation token).
    /// </summary>
    private static bool IsNetworkException(Exception ex, CancellationToken ct) => ex switch
    {
        HttpRequestException => true,
        IOException => true,
        OperationCanceledException => !ct.IsCancellationRequested,
        _ => false,
    };

    private static string DescribeNetworkError(Exception ex) =>
        ex is OperationCanceledException ? "Network timeout" : ex.Message;

    /// <summary>
    /// Consume an accepted ingest response (200/202/409) from either the
    /// primary worker or the fallback relay and mark the entry uploaded.
    /// </summary>
    private async Task HandleAcceptedResponse(RecordingEntry entry, HttpResponseMessage response, bool viaFallback, CancellationToken ct)
    {
        using (response)
        {
            // 409 → the worker already ingested this callId (duplicate or a retry
            // after a success we never recorded). The clip is attached; we're done.
            if (response.StatusCode == HttpStatusCode.Conflict)
            {
                MarkUploaded(entry, null, "duplicate (already attached)", viaFallback);
                return;
            }

            // 200 → { ghlMessageId }; 202 → { status: "review" } (no phone match,
            // parked in GHL Medias for manual review). Both mean accepted.
            string? ghlMessageId = null;
            try
            {
                var responseJson = await response.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(responseJson);
                if (doc.RootElement.TryGetProperty("ghlMessageId", out var idProp))
                    ghlMessageId = idProp.GetString();
            }
            catch { }

            MarkUploaded(entry, ghlMessageId,
                response.StatusCode == HttpStatusCode.Accepted ? "parked for review (no phone)" : null,
                viaFallback);
        }
    }

    /// <summary>Mark an entry as successfully attached to GHL and reset breakers.</summary>
    private void MarkUploaded(RecordingEntry entry, string? ghlMessageId, string? note, bool viaFallback = false)
    {
        _storage.UpdateEntry(entry.FileName, e =>
        {
            e.Uploaded = true;
            e.UploadedAt = DateTime.UtcNow;
            e.GhlMessageId = ghlMessageId;
        });
        // Distinguish "attached to a GHL contact" from "uploaded but parked in
        // GHL Medias review (no phone/call_id match)". Both set Uploaded=true so
        // we stop retrying, but a review-parked clip is NOT on the contact, so
        // surface it loudly via FileLogger (Debug.WriteLine was a no-op in
        // Release, which is why ~unattached uploads looked like clean successes).
        if (!string.IsNullOrEmpty(ghlMessageId))
            FileLogger.Write($"[Upload] Attached to GHL{(viaFallback ? " via cloud relay" : "")}: {entry.FileName} → msg {ghlMessageId}");
        else
            FileLogger.Write($"[Upload] Uploaded{(viaFallback ? " via cloud relay" : "")} but NOT attached: {entry.FileName} [{note ?? "no GHL message id"}] "
                + "— check Zoom S2S creds (zoom-api.json / setZoomApiConfig) so the call number resolves");
        lock (_lastAttemptTime) { _lastAttemptTime.Remove(entry.FileName); }
        // Reset breaker on any successful upload — partial outages clear.
        Interlocked.Exchange(ref _consecutiveFailures, 0);
        LastFailureWasNetwork = false;
        LastUploadViaFallback = viaFallback;
        UploadCompleted?.Invoke(entry.FileName, ghlMessageId, entry.CallLogId, true, null);
    }

    /// <summary>
    /// Network failures never mark the entry as permanently failed — we cap
    /// RetryCount at the largest backoff index so the loop keeps retrying at
    /// the max-backoff cadence (15 min) until the network recovers.
    /// </summary>
    private void HandleNetworkFailure(RecordingEntry entry, string message)
    {
        LastFailureWasNetwork = true;
        _storage.UpdateEntry(entry.FileName, e =>
        {
            // Cap at the index that yields the longest backoff slot so retries
            // continue every ~15 min indefinitely without ever being treated
            // as permanent failures.
            var cap = BackoffDelays.Length;
            if (e.RetryCount < cap) e.RetryCount++;
            e.Error = null;
        });

        // Trip the global breaker after enough consecutive failures across
        // any file — likely a wider outage / token revocation. Cools down
        // for CircuitCooldown so we don't hammer PocketBase.
        var failures = Interlocked.Increment(ref _consecutiveFailures);
        if (failures >= CircuitFailureThreshold)
        {
            // Edge-trigger: only fire the breaker event the first time we
            // cross the threshold within a cooldown window. Otherwise every
            // failed upload during the cooldown window would re-broadcast.
            var alreadyOpen = DateTime.UtcNow < _circuitOpenUntil;
            _circuitOpenUntil = DateTime.UtcNow + CircuitCooldown;
            FileLogger.Write($"[Upload] Circuit opened after {failures} consecutive failures; cooling down {CircuitCooldown.TotalSeconds:F0}s. Last error: {message}");
            if (!alreadyOpen)
            {
                try { CircuitBreakerTripped?.Invoke((int)CircuitCooldown.TotalSeconds, message); }
                catch { /* event handler errors must not crash the upload loop */ }
            }
        }
    }

    private bool IsCircuitOpen()
    {
        return DateTime.UtcNow < _circuitOpenUntil;
    }

    private static async Task<string> SafeReadBody(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            return body.Length > 500 ? body[..500] : body;
        }
        catch { return ""; }
    }

    /// <summary>
    /// Link a recording to a call log by the dashboard-issued client call id.
    /// Preferred over <see cref="LinkRecording"/> because it bypasses the
    /// global-latest-recording race when MP3 conversion lag means the previous
    /// call's file is still the freshest entry.
    /// </summary>
    public void LinkRecordingByClientCallId(string clientCallId, string callLogId)
    {
        var entry = _storage.GetByClientCallId(clientCallId);
        if (entry == null)
        {
            Debug.WriteLine($"[Upload] LinkByClientCallId: no recording found for clientCallId={clientCallId}");
            return;
        }
        LinkRecording(entry.FileName, callLogId, entry.RecordingId);
    }

    /// <summary>
    /// Link a recording to a call log. Triggers immediate upload.
    /// </summary>
    public void LinkRecording(string? fileName, string callLogId, string? recordingId = null)
    {
        string? resolvedFileName = null;
        if (recordingId != null)
        {
            var entry = _storage.GetEntryByRecordingId(recordingId);
            if (entry != null) resolvedFileName = entry.FileName;
        }
        resolvedFileName ??= fileName;

        if (resolvedFileName == null)
        {
            Debug.WriteLine($"[Upload] LinkRecording: no recording found for id={recordingId} file={fileName}");
            return;
        }

        var newName = _storage.RenameWithCallLogId(resolvedFileName, callLogId);
        if (newName == null)
            _storage.UpdateEntry(resolvedFileName, e => e.CallLogId = callLogId);

        Debug.WriteLine($"[Upload] Linked {resolvedFileName} → call_log {callLogId}");

        // Wake the upload loop immediately — don't wait for next poll
        Wake();
    }

    public void EnqueueUpload(string fileName)
    {
        _storage.UpdateEntry(fileName, e =>
        {
            e.Error = null;
            e.RetryCount = 0;
        });
        Wake();
    }

    /// <summary>
    /// Reset all failed entries (Error cleared, RetryCount = 0) and wake the
    /// loop so they re-attempt immediately.
    /// </summary>
    public void RetryAll()
    {
        _storage.RetryFailed();
        lock (_lastAttemptTime) { _lastAttemptTime.Clear(); }
        Wake();
    }

    /// <summary>Snapshot of recordings that failed to upload (4xx or out-of-retries).</summary>
    public List<RecordingEntry> GetFailedUploads() => _storage.GetFailedUploads();

    public void Stop()
    {
        _cts?.Cancel();
        try { _uploadTask?.Wait(3000); } catch { }
        _cts?.Dispose();
        _cts = null;
        Debug.WriteLine("[Upload] Service stopped");
    }

    public void Dispose()
    {
        Stop();
        _wakeSignal.Dispose();
        _httpClient.Dispose();
    }
}

/// <summary>
/// StreamContent wrapper that reports bytes-written to a callback so the
/// dashboard can show real upload progress instead of a static spinner.
/// </summary>
internal sealed class ProgressableStreamContent : StreamContent
{
    private const int BufferSize = 81920;
    private readonly Stream _content;
    private readonly Action<long, long> _onProgress;

    public ProgressableStreamContent(Stream content, Action<long, long> onProgress) : base(content)
    {
        _content = content;
        _onProgress = onProgress;
    }

    protected override async Task SerializeToStreamAsync(Stream stream, TransportContext? context)
    {
        var total = TryGetTotal();
        var buffer = new byte[BufferSize];
        long sent = 0;
        int read;
        while ((read = await _content.ReadAsync(buffer.AsMemory(0, BufferSize)).ConfigureAwait(false)) > 0)
        {
            await stream.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            sent += read;
            try { _onProgress(sent, total); } catch { }
        }
    }

    protected override bool TryComputeLength(out long length)
    {
        length = TryGetTotal();
        return length > 0;
    }

    private long TryGetTotal()
    {
        try { return _content.CanSeek ? _content.Length : 0; } catch { return 0; }
    }
}
