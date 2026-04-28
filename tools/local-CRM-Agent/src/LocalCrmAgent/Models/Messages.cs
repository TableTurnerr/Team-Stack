using System.Reflection;
using System.Text.Json.Serialization;

namespace LocalCrmAgent.Models;

public class AgentMessage
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("timestamp")]
    public long Timestamp { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
}

public class CallStateMessage : AgentMessage
{
    [JsonPropertyName("state")]
    public string State { get; set; } = "idle";

    [JsonPropertyName("phoneNumber")]
    public string? PhoneNumber { get; set; }

    [JsonPropertyName("direction")]
    public string? Direction { get; set; }

    [JsonPropertyName("duration")]
    public int Duration { get; set; }

    [JsonPropertyName("confidence")]
    public string Confidence { get; set; } = "low";

    // Ownership envelope — lets the dashboard decide whether THIS teammate
    // owns the call or whether it's happening on another teammate's machine
    // on the shared Zoom account.
    [JsonPropertyName("deviceId")]
    public string? DeviceId { get; set; }

    [JsonPropertyName("intentId")]
    public string? IntentId { get; set; }

    [JsonPropertyName("zoomCallId")]
    public string? ZoomCallId { get; set; }

    [JsonPropertyName("uiSeenHere")]
    public bool UiSeenHere { get; set; }

    [JsonPropertyName("audioActiveHere")]
    public bool AudioActiveHere { get; set; }

    [JsonPropertyName("teammateOnCall")]
    public bool TeammateOnCall { get; set; }

    public CallStateMessage() => Type = "callState";

    public static CallStateMessage From(CallStateInfo info) => new()
    {
        State = info.State.ToString().ToLowerInvariant(),
        PhoneNumber = info.PhoneNumber,
        Direction = info.Direction,
        Duration = info.DurationSeconds,
        Confidence = info.Confidence.ToString().ToLowerInvariant(),
        DeviceId = info.DeviceId,
        IntentId = info.IntentId,
        ZoomCallId = info.ZoomCallId,
        UiSeenHere = info.UiSeenHere,
        AudioActiveHere = info.AudioActiveHere,
        TeammateOnCall = info.TeammateOnCall,
    };
}

public class NetworkQualityMessage : AgentMessage
{
    [JsonPropertyName("latencyMs")]
    public double LatencyMs { get; set; }

    [JsonPropertyName("jitter")]
    public double Jitter { get; set; }

    [JsonPropertyName("packetLoss")]
    public double PacketLoss { get; set; }

    [JsonPropertyName("isStable")]
    public bool IsStable { get; set; } = true;

    public NetworkQualityMessage() => Type = "networkQuality";
}

public class HeartbeatMessage : AgentMessage
{
    [JsonPropertyName("version")]
    public string Version { get; set; } = System.Reflection.Assembly.GetExecutingAssembly()
        .GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>()
        ?.InformationalVersion
        ?? System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString(3)
        ?? "0.0.0";

    [JsonPropertyName("uptime")]
    public int Uptime { get; set; }

    [JsonPropertyName("zoomDetected")]
    public bool ZoomDetected { get; set; }

    [JsonPropertyName("connectedClients")]
    public int ConnectedClients { get; set; }

    [JsonPropertyName("isRecording")]
    public bool IsRecording { get; set; }

    [JsonPropertyName("recordingDuration")]
    public int RecordingDuration { get; set; }

    [JsonPropertyName("uploadsPending")]
    public int UploadsPending { get; set; }

    [JsonPropertyName("uploadsFailed")]
    public int UploadsFailed { get; set; }

    public HeartbeatMessage() => Type = "heartbeat";
}

public class ZoomActionMessage : AgentMessage
{
    [JsonPropertyName("action")]
    public string Action { get; set; } = "";

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("zoomRunning")]
    public bool ZoomRunning { get; set; }

    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    public ZoomActionMessage() => Type = "zoomAction";
}

// ─── Recording Messages ──────────────────────────────────────────────────────

public class RecordingStateMessage : AgentMessage
{
    [JsonPropertyName("state")]
    public string State { get; set; } = "idle";

    [JsonPropertyName("recordingId")]
    public string? RecordingId { get; set; }

    [JsonPropertyName("fileName")]
    public string? FileName { get; set; }

    [JsonPropertyName("phoneNumber")]
    public string? PhoneNumber { get; set; }

    [JsonPropertyName("duration")]
    public int Duration { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    public RecordingStateMessage() => Type = "recordingState";
}

public class RecordingCompletedMessage : AgentMessage
{
    [JsonPropertyName("recordingId")]
    public string RecordingId { get; set; } = "";

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("phoneNumber")]
    public string PhoneNumber { get; set; } = "";

    [JsonPropertyName("duration")]
    public int Duration { get; set; }

    [JsonPropertyName("fileSizeBytes")]
    public long FileSizeBytes { get; set; }

    [JsonPropertyName("startTime")]
    public string StartTime { get; set; } = "";

    public RecordingCompletedMessage() => Type = "recordingCompleted";
}

/// <summary>
/// Fired after WAV→MP3 conversion completes successfully — carries the
/// final duration / file size that weren't yet known when
/// <see cref="RecordingCompletedMessage"/> was broadcast.
/// </summary>
public class RecordingConvertedMessage : AgentMessage
{
    [JsonPropertyName("recordingId")]
    public string RecordingId { get; set; } = "";

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("duration")]
    public int Duration { get; set; }

    [JsonPropertyName("fileSizeBytes")]
    public long FileSizeBytes { get; set; }

    public RecordingConvertedMessage() => Type = "recordingConverted";
}

public class RecordingUploadedMessage : AgentMessage
{
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("pocketbaseRecordingId")]
    public string? PocketbaseRecordingId { get; set; }

    [JsonPropertyName("callLogId")]
    public string? CallLogId { get; set; }

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    public RecordingUploadedMessage() => Type = "recordingUploaded";
}

/// <summary>
/// Response to a getLocalRecording request — sends the MP3 bytes as base64
/// so the dashboard can preview unsubmitted recordings directly from disk.
/// </summary>
public class LocalRecordingMessage : AgentMessage
{
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("mimeType")]
    public string MimeType { get; set; } = "audio/mpeg";

    /// <summary>Base64-encoded file bytes, or empty if not found.</summary>
    [JsonPropertyName("data")]
    public string Data { get; set; } = "";

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    public LocalRecordingMessage() => Type = "localRecording";
}

/// <summary>
/// Snapshot of recordings that are on disk but not yet linked to a CRM call log.
/// Sent in response to `getUnlinkedRecordings` so the dashboard can repopulate
/// its "Recorded but unsubmitted" pill after a page refresh or reconnect.
/// </summary>
public class UnlinkedRecordingDto
{
    [JsonPropertyName("recordingId")]
    public string RecordingId { get; set; } = "";

    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("phoneNumber")]
    public string PhoneNumber { get; set; } = "";

    [JsonPropertyName("duration")]
    public int Duration { get; set; }

    [JsonPropertyName("fileSizeBytes")]
    public long FileSizeBytes { get; set; }

    [JsonPropertyName("startTime")]
    public string StartTime { get; set; } = "";
}

public class UnlinkedRecordingsMessage : AgentMessage
{
    [JsonPropertyName("recordings")]
    public List<UnlinkedRecordingDto> Recordings { get; set; } = [];

    public UnlinkedRecordingsMessage() => Type = "unlinkedRecordings";
}

public class UploadQueueStatusMessage : AgentMessage
{
    [JsonPropertyName("pendingCount")]
    public int PendingCount { get; set; }

    [JsonPropertyName("failedCount")]
    public int FailedCount { get; set; }

    [JsonPropertyName("currentUpload")]
    public string? CurrentUpload { get; set; }

    public UploadQueueStatusMessage() => Type = "uploadQueueStatus";
}

public class UploadProgressMessage : AgentMessage
{
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("bytesSent")]
    public long BytesSent { get; set; }

    [JsonPropertyName("bytesTotal")]
    public long BytesTotal { get; set; }

    public UploadProgressMessage() => Type = "uploadProgress";
}

public class FailedUploadDto
{
    [JsonPropertyName("fileName")]
    public string FileName { get; set; } = "";

    [JsonPropertyName("phoneNumber")]
    public string PhoneNumber { get; set; } = "";

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("retryCount")]
    public int RetryCount { get; set; }

    [JsonPropertyName("callLogId")]
    public string? CallLogId { get; set; }
}

public class FailedUploadsMessage : AgentMessage
{
    [JsonPropertyName("uploads")]
    public List<FailedUploadDto> Uploads { get; set; } = [];

    public FailedUploadsMessage() => Type = "failedUploads";
}

// ─── Call Controller Messages ────────────────────────────────────────────────

public class DialResultMessage : AgentMessage
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("phoneNumber")]
    public string? PhoneNumber { get; set; }

    public DialResultMessage() => Type = "dialResult";
}

public class EndCallResultMessage : AgentMessage
{
    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    public EndCallResultMessage() => Type = "endCallResult";
}

// ─── Zoom Suppressor Messages ───────────────────────────────────────────────

public class KeepZoomMinimizedMessage : AgentMessage
{
    [JsonPropertyName("enabled")]
    public bool Enabled { get; set; }

    public KeepZoomMinimizedMessage() => Type = "keepZoomMinimized";
}

// ─── Microphone Messages ────────────────────────────────────────────────────

public class MicDeviceDto
{
    [JsonPropertyName("deviceId")]
    public string DeviceId { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("isDefault")]
    public bool IsDefault { get; set; }

    [JsonPropertyName("isSelected")]
    public bool IsSelected { get; set; }

    [JsonPropertyName("peakLevel")]
    public float PeakLevel { get; set; }
}

public class MicrophoneListMessage : AgentMessage
{
    [JsonPropertyName("devices")]
    public List<MicDeviceDto> Devices { get; set; } = [];

    public MicrophoneListMessage() => Type = "microphoneList";
}

public class MicrophoneChangedMessage : AgentMessage
{
    [JsonPropertyName("device")]
    public MicDeviceDto Device { get; set; } = new();

    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "";

    public MicrophoneChangedMessage() => Type = "microphoneChanged";
}

public class MicrophoneAlertMessage : AgentMessage
{
    [JsonPropertyName("message")]
    public string Message { get; set; } = "";

    public MicrophoneAlertMessage() => Type = "microphoneAlert";
}
