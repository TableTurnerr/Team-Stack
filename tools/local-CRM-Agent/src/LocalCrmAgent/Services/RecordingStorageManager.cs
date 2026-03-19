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
    /// </summary>
    public string GenerateFilePath(string phoneNumber)
    {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
        var sanitized = SanitizePhoneNumber(phoneNumber);
        var fileName = $"{timestamp}_{sanitized}.mp3";
        return Path.Combine(_recordingsDir, fileName);
    }

    /// <summary>
    /// Generate a temp WAV path for recording before MP3 conversion.
    /// </summary>
    public string GenerateTempWavPath(string phoneNumber)
    {
        var timestamp = DateTime.Now.ToString("yyyy-MM-dd_HH-mm-ss-fff");
        var sanitized = SanitizePhoneNumber(phoneNumber);
        return Path.Combine(_recordingsDir, $".tmp_{timestamp}_{sanitized}.wav");
    }

    public RecordingEntry AddEntry(string fileName, string phoneNumber, DateTime startTime)
    {
        var entry = new RecordingEntry
        {
            FileName = fileName,
            PhoneNumber = phoneNumber,
            StartTime = startTime,
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
    /// Get recordings that need uploading (not yet uploaded, no error).
    /// </summary>
    public List<RecordingEntry> GetPendingUploads()
    {
        lock (_lock)
        {
            return _entries
                .Where(e => !e.Uploaded && e.Error == null && e.RetryCount < 10)
                .ToList();
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
                return _entries.Count(e => !e.Uploaded && e.Error == null && e.RetryCount < 10);
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

    private void LoadManifest()
    {
        try
        {
            if (File.Exists(_manifestPath))
            {
                var json = File.ReadAllText(_manifestPath);
                _entries = JsonSerializer.Deserialize<List<RecordingEntry>>(json, JsonOptions) ?? [];
                Debug.WriteLine($"[Storage] Loaded manifest: {_entries.Count} entries");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Storage] Failed to load manifest: {ex.Message}");
            _entries = [];
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
}
