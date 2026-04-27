namespace LocalCrmAgent.Models;

/// <summary>
/// Snapshot of what the Zoom desktop app is showing right now as seen by
/// Windows UIAutomation. This is ground truth for "is THIS device on a call?"
/// because `panel_single_channel` only renders on the machine that answered;
/// other teammates on the same shared account see an empty phone panel.
/// </summary>
public class ZoomUiState
{
    // Active call on THIS machine (panel_single_channel present inside
    // PhoneChildWindow). When true, ActivePhoneRaw is what Zoom displays
    // (may be "+1 (925) 259-0082" or "18023599100" depending on whether
    // the number is a saved contact).
    public bool HasActiveCall { get; set; }
    public string? ActivePhoneRaw { get; set; }
    public string? ActiveStatusText { get; set; } // e.g. "1 minute 24 seconds"

    // Incoming ring toast on THIS machine
    // (SipCallNormalIncomingCallWindow top-level window present).
    public bool HasIncomingRing { get; set; }
    public string? IncomingCallerName { get; set; }    // lb_name
    public string? IncomingCallerNumber { get; set; }  // lb_info
    public string? IncomingLineInfo { get; set; }      // lb_call_end_info ("to You - Ext. 800")

    // Account-level presence flag. Zoom pushes presence for the SIP account
    // into the history list's contact avatars. When the shared account is
    // "On a call" and THIS device has no panel_single_channel and no ring
    // window, it can only mean another teammate on another device is the
    // one actually on the call — a reliable negative confirmation that
    // strengthens the iOwnCurrentCall=false determination.
    public bool AccountPresenceOnCall { get; set; }

    public DateTime CapturedAt { get; set; } = DateTime.UtcNow;

    public bool SignalsCallHere => HasActiveCall || HasIncomingRing;
}
