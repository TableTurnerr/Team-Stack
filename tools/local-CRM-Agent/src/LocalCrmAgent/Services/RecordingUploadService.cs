using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;

namespace LocalCrmAgent.Services;

/// <summary>
/// Background service that uploads recordings to PocketBase.
/// Uses auth token relayed from the dashboard via WebSocket.
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

    // Exponential backoff delays (in seconds)
    private static readonly int[] BackoffDelays = [10, 30, 60, 300, 900, 1800];

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

    /// <summary>
    /// Set PocketBase auth configuration (relayed from dashboard).
    /// </summary>
    public void SetAuth(string pocketbaseUrl, string authToken, string uploaderId)
    {
        lock (_lock)
        {
            _pocketbaseUrl = pocketbaseUrl.TrimEnd('/');
            _authToken = authToken;
            _uploaderId = uploaderId;
        }
        Debug.WriteLine($"[Upload] Auth configured for {pocketbaseUrl}");
    }

    /// <summary>
    /// Start the background upload processing loop.
    /// </summary>
    public void Start()
    {
        _cts = new CancellationTokenSource();
        _uploadTask = Task.Run(() => ProcessLoop(_cts.Token));
        Debug.WriteLine("[Upload] Service started");
    }

    /// <summary>
    /// Process pending uploads in a loop.
    /// </summary>
    private async Task ProcessLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                if (!IsConfigured)
                {
                    await Task.Delay(5000, ct);
                    continue;
                }

                var pending = _storage.GetPendingUploads();
                if (pending.Count == 0)
                {
                    await Task.Delay(5000, ct);
                    continue;
                }

                foreach (var entry in pending)
                {
                    if (ct.IsCancellationRequested) break;

                    // Check backoff
                    if (entry.RetryCount > 0)
                    {
                        var delayIdx = Math.Min(entry.RetryCount - 1, BackoffDelays.Length - 1);
                        var delaySec = BackoffDelays[delayIdx];
                        // Skip if not enough time has passed since last attempt
                        // We use a simple approach: just delay before retry
                        await Task.Delay(delaySec * 1000, ct);
                    }

                    CurrentUpload = entry.FileName;
                    await UploadRecording(entry, ct);
                    CurrentUpload = null;
                }
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Upload] Loop error: {ex.Message}");
                try { await Task.Delay(10000, ct); } catch { break; }
            }
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

        try
        {
            // Resolve phone number record and company
            string? phoneNumberRecordId = null;
            string? companyId = null;
            await ResolvePhoneNumber(pocketbaseUrl, authToken, entry.PhoneNumber, ct)
                .ContinueWith(t =>
                {
                    if (t.IsCompletedSuccessfully)
                    {
                        (phoneNumberRecordId, companyId) = t.Result;
                    }
                }, ct);

            // Upload recording
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

            if (entry.CallLogId != null) form.Add(new StringContent(entry.CallLogId), "call_log");
            if (phoneNumberRecordId != null) form.Add(new StringContent(phoneNumberRecordId), "phone_number_record");
            if (companyId != null) form.Add(new StringContent(companyId), "company");

            var request = new HttpRequestMessage(HttpMethod.Post,
                $"{pocketbaseUrl}/api/collections/recordings/records");
            request.Headers.Authorization = new AuthenticationHeaderValue(authToken);
            request.Content = form;

            var response = await _httpClient.SendAsync(request, ct);

            if (response.StatusCode == System.Net.HttpStatusCode.Unauthorized)
            {
                Debug.WriteLine("[Upload] Auth expired (401)");
                UploadAuthExpired?.Invoke();
                return;
            }

            response.EnsureSuccessStatusCode();

            // Parse response for the created record ID
            var responseJson = await response.Content.ReadAsStringAsync(ct);
            string? recordingId = null;
            try
            {
                using var doc = JsonDocument.Parse(responseJson);
                recordingId = doc.RootElement.GetProperty("id").GetString();
            }
            catch { }

            // Update manifest
            _storage.UpdateEntry(entry.FileName, e =>
            {
                e.Uploaded = true;
                e.UploadedAt = DateTime.UtcNow;
                e.PocketbaseRecordingId = recordingId;
            });

            Debug.WriteLine($"[Upload] Uploaded: {entry.FileName} → {recordingId}");

            // Update call_log.has_recording if linked
            if (entry.CallLogId != null)
            {
                await UpdateCallLogHasRecording(pocketbaseUrl, authToken, entry.CallLogId, ct);
            }

            UploadCompleted?.Invoke(entry.FileName, recordingId, entry.CallLogId, true, null);
        }
        catch (Exception ex)
        {
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
            // Strip formatting, keep digits and +
            var cleanNumber = new string(phoneNumber.Where(c => char.IsDigit(c) || c == '+').ToArray());
            if (string.IsNullOrEmpty(cleanNumber)) return (null, null);

            var url = $"{pocketbaseUrl}/api/collections/phone_numbers/records?filter=phone_number~\"{cleanNumber}\"&expand=company&perPage=1";
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            request.Headers.Authorization = new AuthenticationHeaderValue(authToken);

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
            {
                companyId = companyProp.GetString();
            }

            return (phoneId, companyId);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Upload] Phone resolution failed: {ex.Message}");
            return (null, null);
        }
    }

    private async Task UpdateCallLogHasRecording(string pocketbaseUrl, string authToken, string callLogId, CancellationToken ct)
    {
        try
        {
            var url = $"{pocketbaseUrl}/api/collections/call_logs/records/{callLogId}";
            var request = new HttpRequestMessage(HttpMethod.Patch, url);
            request.Headers.Authorization = new AuthenticationHeaderValue(authToken);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { has_recording = true }),
                System.Text.Encoding.UTF8,
                "application/json");

            await _httpClient.SendAsync(request, ct);
            Debug.WriteLine($"[Upload] Updated call_log {callLogId} has_recording=true");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Upload] Failed to update call_log: {ex.Message}");
        }
    }

    /// <summary>
    /// Link a recording to a call log (called from WebSocket command).
    /// </summary>
    public void LinkRecording(string fileName, string callLogId)
    {
        _storage.UpdateEntry(fileName, e => e.CallLogId = callLogId);
        Debug.WriteLine($"[Upload] Linked {fileName} → call_log {callLogId}");
    }

    /// <summary>
    /// Manually trigger upload for a specific file.
    /// </summary>
    public void EnqueueUpload(string fileName)
    {
        _storage.UpdateEntry(fileName, e =>
        {
            e.Error = null;
            e.RetryCount = 0;
        });
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
        _httpClient.Dispose();
    }
}
