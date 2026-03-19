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

    public CallStateMessage() => Type = "callState";

    public static CallStateMessage From(CallStateInfo info) => new()
    {
        State = info.State.ToString().ToLowerInvariant(),
        PhoneNumber = info.PhoneNumber,
        Direction = info.Direction,
        Duration = info.DurationSeconds,
        Confidence = info.Confidence.ToString().ToLowerInvariant(),
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
    public string Version { get; set; } = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

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
