using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace LocalCrmAgent.Services;

/// <summary>
/// Manages local recording file storage and a JSON manifest that tracks
/// all recordings, their metadata, upload status, and call log links.
/// </summary>
public class RecordingStorageManager
{
    private readonly string _recordingsDir;
    private readonly string _manifestPath;
    private readonly object _lock = new();
    private List<RecordingEntry> _entries = [];

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public string RecordingsDirectory => _recordingsDir;

    public RecordingStorageManager(string? directory = null)
    {
        _recordingsDir = directory
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "CRM Recordings");
        _manifestPath = Path.Combine(_recordingsDir, "recordings.json");

        Directory.CreateDirectory(_recordingsDir);
        LoadManifest();
    }

    /// <summary>
    /// Generate a recording file path with timestamp + sanitized phone number.
    /// When <paramref name="recordingId"/> is supplied it is folded into the
    /// filename so back-to-back calls to the same number within the same
    /// millisecond cannot collide on disk (the prior format relied on the
    /// timestamp alone, which is rare-but-possible to repeat under load).
    /// </summary>
    public string GenerateFilePath(string phoneNumber, string? recordingId = null)
    {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
        var sanitized = SanitizePhoneNumber(phoneNumber);
        var idPart = string.IsNullOrEmpty(recordingId) ? "" : $"_{recordingId}";
        var fileName = $"{timestamp}_{sanitized}{idPart}.mp3";
        return Path.Combine(_recordingsDir, fileName);
    }

    /// <summary>
    /// Generate a temp WAV path for recording before MP3 conversion.
    /// </summary>
    public string GenerateTempWavPath(string phoneNumber, string? recordingId = null)
    {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
        var sanitized = SanitizePhoneNumber(phoneNumber);
        var idPart = string.IsNullOrEmpty(recordingId) ? "" : $"_{recordingId}";
        return Path.Combine(_recordingsDir, $".tmp_{timestamp}_{sanitized}{idPart}.wav");
    }

    /// <summary>
    /// Rename a recording file to include the call log ID so that even a
    /// manual upload can be auto-linked.  Returns the new file name.
    /// Format: {timestamp}_{phone}_cl-{callLogId}.mp3
    /// Atomic: writes a {newPath}.linking sentinel before File.Move so a
    /// crash mid-rename can be recovered on next LoadManifest().
    /// </summary>
    public string? RenameWithCallLogId(string fileName, string callLogId)
    {
        lock (_lock)
        {
            var entry = _entries.Find(e => e.FileName == fileName);
            if (entry == null) return null;

            // Already renamed?
            if (fileName.Contains($"_cl-{callLogId}")) return fileName;

            var ext = Path.GetExtension(fileName);
            var baseName = Path.GetFileNameWithoutExtension(fileName);
            var newFileName = $"{baseName}_cl-{callLogId}{ext}";

            var oldPath = Path.Combine(_recordingsDir, fileName);
            var newPath = Path.Combine(_recordingsDir, newFileName);
            var sentinelPath = newPath + ".linking";

            try
            {
                var sentinelJson = JsonSerializer.Serialize(new RenameSentinel
                {
                    OldFileName = fileName,
                    NewFileName = newFileName,
                    CallLogId = callLogId,
                }, JsonOptions);
                File.WriteAllText(sentinelPath, sentinelJson);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Storage] Sentinel write failed: {ex.Message}");
                return null;
            }

            try
            {
                if (File.Exists(oldPath))
                    File.Move(oldPath, newPath);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Storage] Rename failed: {ex.Message}");
                TryDeleteFile(sentinelPath);
                return null;
            }

            entry.FileName = newFileName;
            entry.CallLogId = callLogId;
            PersistManifest();
            TryDeleteFile(sentinelPath);
            Debug.WriteLine($"[Storage] Renamed: {fileName} → {newFileName}");
            return newFileName;
        }
    }

    /// <summary>
    /// Extract a call log ID from a filename containing the _cl-{id} pattern.
    /// Returns null if no match.
    /// </summary>
    public static string? ExtractCallLogId(string fileName)
    {
        var match = Regex.Match(fileName, @"_cl-([a-zA-Z0-9]+)\.");
        return match.Success ? match.Groups[1].Value : null;
    }

    public RecordingEntry AddEntry(string fileName, string phoneNumber, DateTime startTime, string? recordingId = null)
    {
        var entry = new RecordingEntry
        {
            FileName = fileName,
            PhoneNumber = phoneNumber,
            StartTime = startTime,
            RecordingId = recordingId,
        };

        lock (_lock)
        {
            _entries.Add(entry);
            PersistManifest();
        }

        Debug.WriteLine($"[Storage] Added entry: {fileName}");
        return entry;
    }

    public void UpdateEntry(string fileName, Action<RecordingEntry> update)
    {
        lock (_lock)
        {
            var entry = _entries.Find(e => e.FileName == fileName);
            if (entry != null)
            {
                update(entry);
                PersistManifest();
            }
        }
    }

    public RecordingEntry? GetEntry(string fileName)
    {
        lock (_lock)
        {
            return _entries.Find(e => e.FileName == fileName);
        }
    }

    public void RemoveEntry(string fileName)
    {
        lock (_lock)
        {
            _entries.RemoveAll(e => e.FileName == fileName);
            PersistManifest();
        }
    }

    /// <summary>
    /// Get recordings that need uploading.
    /// Only recordings linked to a CRM call log (has CallLogId) are eligible.
    /// Un-linked recordings remain on disk but won't be uploaded.
    /// </summary>
    public List<RecordingEntry> GetPendingUploads()
    {
        lock (_lock)
        {
            return _entries
                .Where(e => !e.Uploaded && e.Error == null && e.RetryCount < 10 && e.CallLogId != null && e.ConversionComplete)
                .ToList();
        }
    }

    /// <summary>
    /// Get recordings that have finished converting but haven't been linked to
    /// a CRM call log yet. These are the ones the dashboard can preview
    /// locally after a page refresh (before the call has been submitted).
    /// </summary>
    public List<RecordingEntry> GetUnlinkedRecordings()
    {
        lock (_lock)
        {
            return _entries
                .Where(e => !e.Uploaded && e.CallLogId == null && e.Error == null && e.ConversionComplete)
                .OrderByDescending(e => e.StartTime)
                .ToList();
        }
    }

    /// <summary>
    /// Get recordings that have not been linked to a call log yet.
    /// </summary>
    public int UnlinkedCount
    {
        get
        {
            lock (_lock)
            {
                return _entries.Count(e => !e.Uploaded && e.CallLogId == null && e.Error == null);
            }
        }
    }

    /// <summary>
    /// Find a recording entry by its recording ID.
    /// </summary>
    public RecordingEntry? GetEntryByRecordingId(string recordingId)
    {
        lock (_lock)
        {
            return _entries.Find(e => e.RecordingId == recordingId);
        }
    }

    /// <summary>
    /// Find a recording entry by its dashboard-supplied client call ID.
    /// </summary>
    public RecordingEntry? GetByClientCallId(string clientCallId)
    {
        if (string.IsNullOrEmpty(clientCallId)) return null;
        lock (_lock)
        {
            return _entries.Find(e => e.ClientCallId == clientCallId);
        }
    }

    /// <summary>
    /// Get recordings that failed to upload.
    /// </summary>
    public List<RecordingEntry> GetFailedUploads()
    {
        lock (_lock)
        {
            return _entries
                .Where(e => !e.Uploaded && e.Error != null)
                .ToList();
        }
    }

    /// <summary>
    /// Reset all failed entries so they can be retried.
    /// </summary>
    public void RetryFailed()
    {
        lock (_lock)
        {
            foreach (var entry in _entries.Where(e => e.Error != null && !e.Uploaded))
            {
                entry.Error = null;
                entry.RetryCount = 0;
            }
            PersistManifest();
        }
    }

    public int PendingCount
    {
        get
        {
            lock (_lock)
            {
                // Only count recordings that are actually eligible for upload.
                // Unlinked recordings (no CallLogId) are filtered out by
                // GetPendingUploads and would never upload — counting them
                // here would mislead users into thinking uploads are stuck.
                return _entries.Count(e => !e.Uploaded && e.Error == null && e.RetryCount < 10 && e.CallLogId != null && e.ConversionComplete);
            }
        }
    }

    public int FailedCount
    {
        get
        {
            lock (_lock)
            {
                return _entries.Count(e => !e.Uploaded && (e.Error != null || e.RetryCount >= 10));
            }
        }
    }

    /// <summary>
    /// Cancel pending uploads. Removes matching entries from the manifest and
    /// deletes the associated local files on disk.
    ///
    /// - If <paramref name="callLogIds"/> is null or empty, cancels ALL non-uploaded entries.
    /// - Otherwise, cancels only entries whose CallLogId matches one of the provided IDs.
    ///
    /// Returns the number of entries cancelled.
    /// </summary>
    public int CancelPending(IReadOnlyCollection<string>? callLogIds = null)
    {
        List<RecordingEntry> toRemove;
        lock (_lock)
        {
            bool matchAll = callLogIds == null || callLogIds.Count == 0;
            toRemove = _entries
                .Where(e => !e.Uploaded && (matchAll ||
                    (e.CallLogId != null && callLogIds!.Contains(e.CallLogId))))
                .ToList();

            if (toRemove.Count > 0)
            {
                foreach (var entry in toRemove)
                    _entries.Remove(entry);
                PersistManifest();
            }
        }

        // Delete local files outside the lock to avoid blocking on slow I/O
        foreach (var entry in toRemove)
        {
            try
            {
                var path = Path.Combine(_recordingsDir, entry.FileName);
                if (File.Exists(path)) File.Delete(path);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Storage] Failed to delete {entry.FileName}: {ex.Message}");
            }
        }

        if (toRemove.Count > 0)
            Debug.WriteLine($"[Storage] Cancelled {toRemove.Count} pending uploads");
        return toRemove.Count;
    }

    private void LoadManifest()
    {
        try
        {
            if (File.Exists(_manifestPath))
            {
                var json = File.ReadAllText(_manifestPath);
                _entries = JsonSerializer.Deserialize<List<RecordingEntry>>(json, JsonOptions) ?? [];
                Debug.WriteLine($"[Storage] Loaded manifest: {_entries.Count} entries");

                // Backfill ConversionComplete for entries written by older agent
                // builds that didn't track the flag. FileSizeBytes > 0 or already-
                // uploaded both imply the MP3 was fully written at some point, so
                // they're safe to mark complete.
                foreach (var e in _entries)
                {
                    if (!e.ConversionComplete && (e.Uploaded || e.FileSizeBytes > 0))
                        e.ConversionComplete = true;
                }
            }

            RecoverFromRenameSentinels();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Storage] Failed to load manifest: {ex.Message}");
            _entries = [];
        }
    }

    /// <summary>
    /// Sweep for *.linking sentinels left behind by a crashed RenameWithCallLogId.
    /// If the rename completed on disk but the manifest still points at the old
    /// name, retroactively reconcile it. Orphan sentinels are deleted.
    /// </summary>
    private void RecoverFromRenameSentinels()
    {
        string[] sentinels;
        try
        {
            sentinels = Directory.GetFiles(_recordingsDir, "*.linking");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Storage] Sentinel sweep failed: {ex.Message}");
            return;
        }

        if (sentinels.Length == 0) return;

        bool dirty = false;
        foreach (var sentinelPath in sentinels)
        {
            try
            {
                var json = File.ReadAllText(sentinelPath);
                var sentinel = JsonSerializer.Deserialize<RenameSentinel>(json, JsonOptions);
                if (sentinel == null || string.IsNullOrEmpty(sentinel.NewFileName))
                {
                    TryDeleteFile(sentinelPath);
                    continue;
                }

                var newPath = Path.Combine(_recordingsDir, sentinel.NewFileName);

                if (File.Exists(newPath) && !string.IsNullOrEmpty(sentinel.OldFileName))
                {
                    var entry = _entries.Find(e => e.FileName == sentinel.OldFileName);
                    if (entry != null)
                    {
                        entry.FileName = sentinel.NewFileName;
                        if (!string.IsNullOrEmpty(sentinel.CallLogId))
                            entry.CallLogId = sentinel.CallLogId;
                        dirty = true;
                        Debug.WriteLine($"[Storage] Recovered rename: {sentinel.OldFileName} → {sentinel.NewFileName}");
                    }
                }

                TryDeleteFile(sentinelPath);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Storage] Sentinel recovery failed for {Path.GetFileName(sentinelPath)}: {ex.Message}");
                TryDeleteFile(sentinelPath);
            }
        }

        if (dirty) PersistManifest();
    }

    private static void TryDeleteFile(string path)
    {
        try
        {
            if (File.Exists(path)) File.Delete(path);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Storage] Failed to delete {path}: {ex.Message}");
        }
    }

    private void PersistManifest()
    {
        try
        {
            var json = JsonSerializer.Serialize(_entries, JsonOptions);
            File.WriteAllText(_manifestPath, json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Storage] Failed to persist manifest: {ex.Message}");
        }
    }

    private static string SanitizePhoneNumber(string phone)
    {
        return Regex.Replace(phone, @"[^\d+]", "");
    }
}

public class RecordingEntry
{
    [JsonPropertyName("recordingId")]
    public string? RecordingId { get; set; }

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("phoneNumber")]
    public string PhoneNumber { get; set; } = "";

    [JsonPropertyName("startTime")]
    public DateTime StartTime { get; set; }

    [JsonPropertyName("durationSeconds")]
    public int DurationSeconds { get; set; }

    [JsonPropertyName("fileSizeBytes")]
    public long FileSizeBytes { get; set; }

    /// <summary>
    /// Set to true once the WAV → MP3 conversion has fully written and closed
    /// the MP3 file on disk. Uploads must wait on this: LameMP3FileWriter holds
    /// the file open during conversion, and uploading the in-progress file
    /// produces a truncated, corrupt MP3 on the server.
    /// </summary>
    [JsonPropertyName("conversionComplete")]
    public bool ConversionComplete { get; set; }

    [JsonPropertyName("uploaded")]
    public bool Uploaded { get; set; }

    [JsonPropertyName("uploadedAt")]
    public DateTime? UploadedAt { get; set; }

    [JsonPropertyName("pocketbaseRecordingId")]
    public string? PocketbaseRecordingId { get; set; }

    [JsonPropertyName("callLogId")]
    public string? CallLogId { get; set; }

    [JsonPropertyName("retryCount")]
    public int RetryCount { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("clientCallId")]
    public string? ClientCallId { get; set; }
}

internal sealed class RenameSentinel
{
    [JsonPropertyName("oldFileName")]
    public string OldFileName { get; set; } = "";

    [JsonPropertyName("newFileName")]
    public string NewFileName { get; set; } = "";

    [JsonPropertyName("callLogId")]
    public string CallLogId { get; set; } = "";
}
