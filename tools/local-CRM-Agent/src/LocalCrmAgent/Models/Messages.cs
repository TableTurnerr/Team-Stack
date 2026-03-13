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
    public string Version { get; set; } = "1.0.0";

    [JsonPropertyName("uptime")]
    public int Uptime { get; set; }

    [JsonPropertyName("zoomDetected")]
    public bool ZoomDetected { get; set; }

    [JsonPropertyName("connectedClients")]
    public int ConnectedClients { get; set; }

    public HeartbeatMessage() => Type = "heartbeat";
}
