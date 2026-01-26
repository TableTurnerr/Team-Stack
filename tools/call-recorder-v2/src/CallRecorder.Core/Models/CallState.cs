namespace CallRecorder.Core.Models;

/// <summary>
/// Represents the different states a call can be in
/// </summary>
public enum CallState
{
    /// <summary>
    /// No active call, dialer is idle
    /// </summary>
    Idle,

    /// <summary>
    /// Phone number has been entered but call not started
    /// </summary>
    NumberEntered,

    /// <summary>
    /// Call is being placed (ringing)
    /// </summary>
    Calling,

    /// <summary>
    /// Call is active and connected
    /// </summary>
    Active,

    /// <summary>
    /// Call has ended, post-call processing
    /// </summary>
    Ended
}

/// <summary>
/// Contains information about a detected call state
/// </summary>
public class CallStateInfo
{
    public CallState State { get; set; } = CallState.Idle;
    public string? PhoneNumber { get; set; }
    public TimeSpan? Duration { get; set; }
    public DateTime? StartTime { get; set; }
    public DateTime? EndTime { get; set; }
    public bool IsMinimized { get; set; }

    public static CallStateInfo Idle => new() { State = CallState.Idle };
}
