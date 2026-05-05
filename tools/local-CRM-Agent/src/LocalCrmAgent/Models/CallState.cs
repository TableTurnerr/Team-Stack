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

    // Ownership envelope — added so the dashboard can tell whether the call
    // state it's receiving belongs to THIS teammate's device or not.
    public string? DeviceId { get; set; }
    public string? IntentId { get; set; }     // dashboard dial-click correlator
    public string? ClientCallId { get; set; } // stable per-call id from the dashboard
    public string? ZoomCallId { get; set; }   // from webhook once correlated
    public bool UiSeenHere { get; set; }      // true when ZoomUiWatcher saw active/ring on this box
    public bool AudioActiveHere { get; set; } // true when WASAPI reports a live Zoom audio session

    // Negative-confirmation signal: the shared Zoom account shows "On a call"
    // presence but THIS device has no local active/ring UI. That can only
    // mean another teammate on another device is the one actually on the
    // call. Useful for:
    //   (a) reinforcing "I do not own this call" on the dashboard,
    //   (b) showing a "line busy (teammate)" hint so we can act as fallback.
    public bool TeammateOnCall { get; set; }

    // Tentative-end signal: fusion's audio/UI signals went quiet long
    // enough to look like a hangup, but no HARD termination signal (audio
    // session disconnected, UI panel removed, user-confirmed end) has
    // arrived. The dashboard should keep treating the call as live but
    // surface a "Has the call ended?" prompt to the user. See
    // <see cref="SilenceStartedAt"/> for when the silence began — talk-time
    // calculations should clip to that timestamp once the user confirms.
    public bool TentativeEnd { get; set; }
    public DateTime? SilenceStartedAt { get; set; }
}
