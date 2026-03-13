namespace LocalCrmAgent.Models;

public enum CallState
{
    Idle,
    Ringing,
    Connected,
    Ended
}

public enum SignalConfidence
{
    Low,    // Window title only (no audio confirmation)
    Medium, // Audio session exists but no peak audio
    High    // Audio session active with audio flowing
}

public class CallStateInfo
{
    public CallState State { get; set; } = CallState.Idle;
    public string? PhoneNumber { get; set; }
    public string? Direction { get; set; }
    public SignalConfidence Confidence { get; set; } = SignalConfidence.Low;
    public DateTime? StartTime { get; set; }
    public DateTime? ConnectTime { get; set; }
    public DateTime? EndTime { get; set; }
    public int DurationSeconds { get; set; }
}
