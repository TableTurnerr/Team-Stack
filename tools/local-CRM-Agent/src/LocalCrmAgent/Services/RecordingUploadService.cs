using System.Diagnostics;
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
    private readonly HttpClient _httpClient = new();
    private readonly object _lock = new();

    private string? _pocketbaseUrl;
    private string? _authToken;
    private string? _uploaderId;

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

    public bool IsConfigured
    {
        get { lock (_lock) return _pocketbaseUrl != null && _authToken != null; }
    }

    public string? CurrentUpload { get; private set; }

    public RecordingUploadService(RecordingStorageManager storage)
    {
        _storage = storage;
    }

    public void SetAuth(string pocketbaseUrl, string authToken, string uploaderId)
    {
        lock (_lock)
        {
            _pocketbaseUrl = pocketbaseUrl.TrimEnd('/');
            _authToken = authToken;
            _uploaderId = uploaderId;
        }
        Debug.WriteLine($"[Upload] Auth configured for {pocketbaseUrl}");
        Wake(); // process any pending uploads immediately
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
        string? pocketbaseUrl, authToken, uploaderId;
        lock (_lock)
        {
            pocketbaseUrl = _pocketbaseUrl;
            authToken = _authToken;
            uploaderId = _uploaderId;
        }

        if (pocketbaseUrl == null || authToken == null) return;

        var filePath = Path.Combine(_storage.RecordingsDirectory, entry.FileName);
        if (!File.Exists(filePath))
        {
            Debug.WriteLine($"[Upload] File not found, removing entry: {entry.FileName}");
            _storage.RemoveEntry(entry.FileName);
            return;
        }

        // Track attempt time for non-blocking backoff
        lock (_lastAttemptTime) { _lastAttemptTime[entry.FileName] = DateTime.UtcNow; }

        // Resolve call log ID and phone number in parallel
        var callLogId = entry.CallLogId ?? RecordingStorageManager.ExtractCallLogId(entry.FileName);

        try
        {
            // Run phone resolution and call log verification in parallel
            var resolveTask = ResolvePhoneNumber(pocketbaseUrl, authToken, entry.PhoneNumber, ct);
            var verifyTask = callLogId != null
                ? VerifyCallLogExists(pocketbaseUrl, authToken, callLogId, ct)
                : Task.FromResult(true);

            await Task.WhenAll(resolveTask, verifyTask);

            var (phoneNumberRecordId, companyId) = resolveTask.Result;

            if (callLogId != null && !verifyTask.Result)
            {
                Debug.WriteLine($"[Upload] Call log {callLogId} deleted — discarding {entry.FileName}");
                _storage.RemoveEntry(entry.FileName);
                try { File.Delete(filePath); } catch { }
                UploadCompleted?.Invoke(entry.FileName, null, callLogId, false, "Call log deleted");
                return;
            }

            // Upload recording
            CurrentUpload = entry.FileName;

            using var form = new MultipartFormDataContent();
            using var fileStream = File.OpenRead(filePath);
            var fileContent = new StreamContent(fileStream);
            fileContent.Headers.ContentType = new MediaTypeHeaderValue("audio/mpeg");
            form.Add(fileContent, "file", entry.FileName);

            form.Add(new StringContent(entry.PhoneNumber), "phone_number");
            if (uploaderId != null) form.Add(new StringContent(uploaderId), "uploader");
            form.Add(new StringContent(entry.FileName), "original_filename");
            form.Add(new StringContent(entry.DurationSeconds.ToString()), "duration");
            form.Add(new StringContent(entry.StartTime.ToString("yyyy-MM-dd HH:mm:ss.fffZ")), "recording_date");
            form.Add(new StringContent($"Recorded by CRM Agent on {entry.StartTime:yyyy-MM-dd} at {entry.StartTime:HH:mm}"), "note");

            if (callLogId != null) form.Add(new StringContent(callLogId), "call_log");
            if (phoneNumberRecordId != null) form.Add(new StringContent(phoneNumberRecordId), "phone_number_record");
            if (companyId != null) form.Add(new StringContent(companyId), "company");

            var request = new HttpRequestMessage(HttpMethod.Post,
                $"{pocketbaseUrl}/api/collections/recordings/records");
            request.Headers.TryAddWithoutValidation("Authorization", authToken);
            request.Content = form;

            var response = await _httpClient.SendAsync(request, ct);

            CurrentUpload = null;

            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                Debug.WriteLine("[Upload] Auth expired (401)");
                UploadAuthExpired?.Invoke();
                return;
            }

            response.EnsureSuccessStatusCode();

            // Parse response for the created record ID
            string? recordingId = null;
            try
            {
                var responseJson = await response.Content.ReadAsStringAsync(ct);
                using var doc = JsonDocument.Parse(responseJson);
                recordingId = doc.RootElement.GetProperty("id").GetString();
            }
            catch { }

            _storage.UpdateEntry(entry.FileName, e =>
            {
                e.Uploaded = true;
                e.UploadedAt = DateTime.UtcNow;
                e.PocketbaseRecordingId = recordingId;
            });

            Debug.WriteLine($"[Upload] Uploaded: {entry.FileName} → {recordingId}");

            // Update call_log.has_recording (fire and forget — don't block next upload)
            if (callLogId != null)
            {
                _ = UpdateCallLogHasRecording(pocketbaseUrl, authToken, callLogId, ct);
            }

            // Clean up backoff tracking
            lock (_lastAttemptTime) { _lastAttemptTime.Remove(entry.FileName); }

            UploadCompleted?.Invoke(entry.FileName, recordingId, callLogId, true, null);
        }
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

    private async Task<(string? phoneNumberRecordId, string? companyId)> ResolvePhoneNumber(
        string pocketbaseUrl, string authToken, string phoneNumber, CancellationToken ct)
    {
        try
        {
            var cleanNumber = new string(phoneNumber.Where(c => char.IsDigit(c) || c == '+').ToArray());
            if (string.IsNullOrEmpty(cleanNumber)) return (null, null);

            var url = $"{pocketbaseUrl}/api/collections/phone_numbers/records?filter=phone_number~\"{cleanNumber}\"&expand=company&perPage=1";
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.TryAddWithoutValidation("Authorization", authToken);

            var response = await _httpClient.SendAsync(request, ct);
            if (!response.IsSuccessStatusCode) return (null, null);

            var json = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            var items = doc.RootElement.GetProperty("items");
            if (items.GetArrayLength() == 0) return (null, null);

            var first = items[0];
            var phoneId = first.GetProperty("id").GetString();
            string? companyId = null;

            if (first.TryGetProperty("company", out var companyProp) && companyProp.ValueKind == JsonValueKind.String)
                companyId = companyProp.GetString();

            return (phoneId, companyId);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Upload] Phone resolution failed: {ex.Message}");
            return (null, null);
        }
    }

    private async Task<bool> VerifyCallLogExists(string pocketbaseUrl, string authToken, string callLogId, CancellationToken ct)
    {
        try
        {
            var url = $"{pocketbaseUrl}/api/collections/call_logs/records/{callLogId}?fields=id";
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.TryAddWithoutValidation("Authorization", authToken);

            var response = await _httpClient.SendAsync(request, ct);
            return response.StatusCode != System.Net.HttpStatusCode.NotFound;
        }
        catch
        {
            return true; // assume exists on network error
        }
    }

    private async Task UpdateCallLogHasRecording(string pocketbaseUrl, string authToken, string callLogId, CancellationToken ct)
    {
        try
        {
            var url = $"{pocketbaseUrl}/api/collections/call_logs/records/{callLogId}";
            var request = new HttpRequestMessage(HttpMethod.Patch, url);
            request.Headers.TryAddWithoutValidation("Authorization", authToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { has_recording = true }),
                System.Text.Encoding.UTF8,
                "application/json");

            await _httpClient.SendAsync(request, ct);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Upload] Failed to update call_log: {ex.Message}");
        }
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
