using System.Diagnostics;
using LocalCrmAgent.Models;

namespace LocalCrmAgent.Services;

/// <summary>
/// Fuses three signal sources into a unified per-device call state:
///
///   1. <see cref="ZoomUiWatcher"/> (PRIMARY) — UIA sees exactly what the
///      Zoom desktop app is showing on THIS machine. `panel_single_channel`
///      present ⇒ THIS device has an active call.
///      `SipCallNormalIncomingCallWindow` present ⇒ THIS device is ringing.
///   2. <see cref="ZoomAudioMonitor"/> (CONFIRMATION) — a live WASAPI
///      session owned by a Zoom process confirms audio is actually flowing.
///   3. <see cref="ZoomWindowMonitor"/> (LEGACY FALLBACK) — retained only
///      for edge cases where UIA fails (Zoom minimized to tray etc.).
///
/// Previously the fusion relied on window titles + WASAPI, which was
/// fragile for three reasons: (a) Zoom's window title regex varies by
/// version / locale, (b) on a shared account WASAPI alone cannot
/// distinguish whose call is active, and (c) multiple teammates on the
/// same account all see iframe updates. The new UI-first design eliminates
/// those ambiguities because UIA reports per-device ground truth.
/// </summary>
public class CallStateFusion : IDisposable
{
    private readonly ZoomAudioMonitor _audioMonitor;
    private readonly ZoomWindowMonitor _windowMonitor;
    private readonly ZoomUiWatcher _uiWatcher;
    private readonly DialIntentTracker _intentTracker;

    private CallState _state = CallState.Idle;
    private bool _lastTeammateOnCall;
    private DateTime? _audioInactiveSince;
    private DateTime? _audioActiveLastSeen;
    private DateTime? _uiCallGoneSince;
    private DateTime? _endedAt;
    private DateTime? _connectedAt;
    private DateTime? _ringingAt;
    private string? _phoneNumber;
    private string? _direction;
    private string? _intentId;
    private string? _clientCallId;

    // Tentative-end tracking. When fusion's signal sources (audio peak +
    // UIA, both unreliable for hold/mute/long-silence cases) suggest the
    // call ended but no HARD signal (audio session disconnected, UIA
    // reports the active-call panel is gone) confirmed it, we hold the
    // state in Connected and surface a "did the call end?" prompt to the
    // dashboard via TentativeEnd / SilenceStartedAt instead of forcing a
    // hangup. The user can confirm via ConfirmEnd() — endTime/durations
    // get rewound to silenceStartedAt so on-hold time is never billed as
    // talk time.
    private DateTime? _tentativeEndAt;
    private bool _hardEnd;          // last end transition came from a hard signal
    private bool _lastTentative;    // last broadcast tentative-end flag (edge detect)

    // Most recent moment we saw real audio FLOW (peak > noise floor).
    // Tracked separately from _audioActiveLastSeen because Zoom can leave
    // the WASAPI session in IsActive=true for several seconds after a
    // hangup (especially during power-dial bursts) without ever firing
    // ZoomAudioSessionGone. Without this stricter signal the audio latch
    // self-refreshes forever and the tentative-end branch never fires.
    private DateTime? _audioFlowLastSeen;

    // Latched when the user clicks "Yes, the call ended" on the
    // tentative-end prompt. Blocks the Idle→Connected transition until
    // Zoom actually releases its audio session — otherwise fusion would
    // bounce Connected→Ended→Idle→Connected on the very next poll
    // (because IsActive=true keeps refreshing _audioActiveLastSeen),
    // re-locking the dashboard form right after the user confirmed the
    // call ended. Cleared by OnAudioSessionGone, observing audioActive=
    // false, or a fresh dial intent.
    private bool _userConfirmedEnd;

    private CancellationTokenSource? _cts;
    private Task? _pollingTask;
    private readonly object _lock = new();

    // Sustained-loss confirmation: UI can blink for a single poll during
    // Zoom panel refreshes, so require the signal to be absent for a short
    // window before declaring the call ended.
    private const double UiLossConfirmSeconds = 0.6;

    // WASAPI can legitimately pause briefly on device switches — a small
    // grace window prevents spurious End-then-Start transitions.
    private const double AudioInactiveThresholdSeconds = 0.5;

    // Audio-activity latch window. Zoom's audio session flips IsActive↔
    // Inactive and PeakLevel rises/falls to zero during ringback silence
    // gaps (2 s on / 4 s off) and natural conversation pauses. If we
    // treated instantaneous silence as "call ended" the state would flap
    // Connected↔Idle every few seconds during a real call. We latch on the
    // most recent activity and only mark the call as TENTATIVELY ended
    // when there has been no sign of activity for this many seconds — the
    // dashboard then prompts the user to confirm the hangup so silent
    // hold music / mute / long pauses don't terminate a live call.
    private const double AudioLatchSeconds = 2.0;

    // Stricter silence fallback for tentative-end. The session-active
    // latch above can keep effectiveActive=true indefinitely if Zoom
    // doesn't tear down its WASAPI session on hangup, masking the call
    // end. If we go this many seconds without observing peak > noise
    // while in Connected, surface a tentative-end prompt even though
    // effectiveActive is still true. Sized comfortably longer than a
    // natural conversation pause.
    private const double AudioFlowSilenceTentativeSeconds = 6.0;

    private const double EndedCooldownSeconds = 1.0;
    private const double RingingTimeoutSeconds = 60.0;

    public event Action<CallStateInfo>? StateChanged;
    public CallStateInfo CurrentState { get; private set; } = new();

    public CallStateFusion(
        ZoomAudioMonitor audioMonitor,
        ZoomWindowMonitor windowMonitor,
        ZoomUiWatcher uiWatcher,
        DialIntentTracker intentTracker)
    {
        _audioMonitor = audioMonitor;
        _windowMonitor = windowMonitor;
        _uiWatcher = uiWatcher;
        _intentTracker = intentTracker;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();

        _audioMonitor.ZoomAudioStateChanged += OnAudioEvent;
        _audioMonitor.ZoomAudioSessionGone += OnAudioSessionGone;
        _audioMonitor.StartWatching();

        _uiWatcher.StateChanged += OnUiEvent;
        _uiWatcher.Start();

        _pollingTask = Task.Run(() => FallbackPollLoop(_cts.Token));
        Debug.WriteLine("[Fusion] Started (UI primary + audio confirm + 500ms fallback)");
    }

    public void Stop()
    {
        _audioMonitor.ZoomAudioStateChanged -= OnAudioEvent;
        _audioMonitor.ZoomAudioSessionGone -= OnAudioSessionGone;
        _uiWatcher.StateChanged -= OnUiEvent;
        _uiWatcher.Stop();

        _cts?.Cancel();
        try { _pollingTask?.Wait(2000); } catch { }
        _cts?.Dispose();
        _cts = null;
        Debug.WriteLine("[Fusion] Stopped");
    }

    private void OnAudioEvent(bool isActive) => Evaluate();
    private void OnUiEvent(ZoomUiState _) => Evaluate();

    // Hard "audio truly gone" signal from WASAPI: fired when the Zoom audio
    // session disconnects (call really ended). The audio latch exists to
    // ride out brief silence dips, but a session-gone event removes any
    // doubt — clear the latch and mark the next end transition as a HARD
    // end so the fusion bypasses the tentative-end prompt and goes straight
    // to Ended. Without this, after a long power-dial session the
    // dashboard's "Call in progress" tooltip can linger several seconds
    // past the actual hangup.
    private void OnAudioSessionGone()
    {
        lock (_lock)
        {
            _audioActiveLastSeen = null;
            _audioFlowLastSeen = null;
            _hardEnd = true;
            // Session is truly gone — release the user-confirmed-end latch
            // so a brand-new call after this one isn't suppressed.
            _userConfirmedEnd = false;
        }
        Evaluate();
    }

    /// <summary>
    /// User confirmed (via the dashboard's "Has the call ended?" prompt)
    /// that the silence detected by fusion was a real hangup. Forces the
    /// transition to Ended now and rewinds the recorded end time to when
    /// the silence started, so hold-music / mute / long-pause time is
    /// never counted as talk time.
    /// </summary>
    public void ConfirmEnd()
    {
        CallStateInfo? notify;
        lock (_lock)
        {
            if (_state != CallState.Connected && _state != CallState.Ringing)
                return; // already ended/idle; nothing to do

            _hardEnd = true;
            _userConfirmedEnd = true;
            _state = CallState.Ended;
            _endedAt = _tentativeEndAt ?? DateTime.UtcNow;
            _audioActiveLastSeen = null;
            _audioFlowLastSeen = null;
            _uiCallGoneSince = null;
            notify = BuildStateInfoLocked();
            CurrentState = notify;
        }
        StateChanged?.Invoke(notify);
    }

    /// <summary>
    /// User dismissed the "Has the call ended?" prompt — they're still on
    /// the call. Clear the tentative flag and re-arm BOTH audio latches so
    /// a fresh silence window can be detected. Resetting _audioFlowLastSeen
    /// in addition to _audioActiveLastSeen is critical: the new
    /// AudioFlowSilenceTentativeSeconds branch in EvaluateLocked re-fires
    /// _tentativeEndAt the moment it runs again, so without this reset the
    /// prompt instantly snaps back into view and the user can never dismiss
    /// it. Also clears _uiCallGoneSince so the UI-loss confirmation timer
    /// starts over rather than carrying its accumulated grace seconds into
    /// the next silence window.
    /// </summary>
    public void DismissTentativeEnd()
    {
        CallStateInfo? notify = null;
        lock (_lock)
        {
            if (_tentativeEndAt == null) return;
            _tentativeEndAt = null;
            var now = DateTime.UtcNow;
            _audioActiveLastSeen = now;
            _audioFlowLastSeen = now;
            _uiCallGoneSince = null;
            notify = BuildStateInfoLocked();
            CurrentState = notify;
        }
        if (notify != null) StateChanged?.Invoke(notify);
    }

    private async Task FallbackPollLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try { Evaluate(); }
            catch (Exception ex) { Debug.WriteLine($"[Fusion] poll err: {ex.Message}"); }
            try { await Task.Delay(500, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    private void Evaluate()
    {
        // Evaluate runs from three sources (audio event, UI event, polling
        // loop) and must serialize all signal-source reads + state writes —
        // the per-block lock below was insufficient because fields like
        // _audioActiveLastSeen / _phoneNumber / _direction were touched
        // before it. Hold the lock for the whole computation, then release
        // before invoking subscribers (StateChanged) so subscriber code
        // cannot deadlock against fusion state.
        CallStateInfo? notify;
        lock (_lock)
        {
            notify = EvaluateLocked();
        }
        if (notify != null) StateChanged?.Invoke(notify);
    }

    private CallStateInfo? EvaluateLocked()
    {
        var audio = _audioMonitor.GetZoomAudioState();
        var window = _windowMonitor.GetZoomWindowInfo();
        var ui = _uiWatcher.CurrentState;

        bool audioActive = audio is { IsActive: true };
        bool audioFlowing = audioActive && audio!.PeakLevel > 0.001f;
        bool uiActive = ui.HasActiveCall;
        bool uiRinging = ui.HasIncomingRing;

        // Latch the most recent moment we saw ANY Zoom audio signal — either
        // the WASAPI session was in the Active state or the peak meter was
        // above the noise floor. Either edge is strong evidence a call is
        // in progress. See AudioLatchSeconds for why this matters.
        if (audioActive || audioFlowing)
            _audioActiveLastSeen = DateTime.UtcNow;
        if (audioFlowing)
            _audioFlowLastSeen = DateTime.UtcNow;
        bool audioAlive = _audioActiveLastSeen.HasValue
            && (DateTime.UtcNow - _audioActiveLastSeen.Value).TotalSeconds < AudioLatchSeconds;

        // WASAPI audio-flow is the primary "this device is connected on a
        // call" signal. ZoomUiWatcher is currently a no-op (see its header)
        // and modern Zoom Workplace shows "Zoom Workplace" as its only
        // window title regardless of call state, so the legacy title regex
        // is informational at best. Zoom's audio session only carries
        // flowing audio during an actual call (PeakLevel > 0 only during
        // calls), so audioFlowing is a clean single-device "on call"
        // signal.
        //
        // Incoming ring is detected separately via the top-level
        // SipCallNormalIncomingCallWindow — its presence + window title
        // give us both "this device is ringing" and the caller's number
        // without any UIA (read via GetWindowText on a distinct Win32
        // class name).
        bool incomingRingSeen = window.IncomingRingWindowVisible;
        bool windowRingLabel = incomingRingSeen
                               || window.IsIncomingDetected
                               || window.IsRingingDetected;

        // Effective state machine:
        //   - The SipCallNormalIncomingCallWindow being visible means THIS
        //     device is ringing — regardless of audio, because Zoom starts
        //     pumping a ringback tone through the audio session while the
        //     toast is still up. If we gated "active" on audioFlowing alone
        //     we'd jump straight to Connected before the user answers.
        //   - Once the ring window disappears, audioFlowing means the call
        //     was answered (or, for outbound, the remote picked up).
        bool effectiveRinging = uiRinging || incomingRingSeen;
        bool effectiveActive = uiActive || (audioAlive && !incomingRingSeen);

        // Intent-driven fast path: when the dashboard has just issued a
        // dial intent, we don't have to wait for the AudioLatchSeconds
        // window to fully accumulate. Any peek of audio activity combined
        // with a fresh outbound intent is enough to jump straight to
        // Connected, shaving ~2 s off the time-to-Connected for outbound
        // calls. Inbound rings still suppress this so the Ringing state
        // can render before Connected.
        var freshIntent = _intentTracker.MostRecent();
        bool intentDriven = freshIntent != null
                            && (audioActive || audioFlowing)
                            && !incomingRingSeen;
        effectiveActive = effectiveActive || intentDriven;

        // Phone number resolution. UIA is disabled (see ZoomUiWatcher
        // header) so the UI fields are never populated in practice; they
        // remain in the chain for when a safe out-of-process UIA path
        // lands. Everything else comes from window-title parsing or the
        // dial intent tracker.
        string? uiPhone = ui.ActivePhoneRaw ?? ui.IncomingCallerNumber;
        if (!string.IsNullOrWhiteSpace(uiPhone))
            _phoneNumber = uiPhone;
        else if (!string.IsNullOrWhiteSpace(window.IncomingRingCallerNumber))
            _phoneNumber = window.IncomingRingCallerNumber;
        else if (window.DetectedPhoneNumber != null)
            _phoneNumber = window.DetectedPhoneNumber;

        // Direction resolution — driven by the team policy that every
        // outbound call originates from the CRM dialer (which posts a
        // dial intent to the agent immediately on click). That makes
        // "recent intent within the 20 s window" a reliable outbound
        // marker even when UIA is unavailable.
        //
        //   • Incoming-ring window visible       → inbound (always wins;
        //     ring precedes connect)
        //   • Active signal AND fresh intent     → outbound; phone comes
        //     from the intent, direction=outbound
        //   • Active signal AND no fresh intent  → inbound (unattended
        //     pickup / external call we didn't originate)
        if ((incomingRingSeen || uiRinging) && _direction == null)
            _direction = "inbound";

        if ((uiActive || audioAlive) && _direction == null)
        {
            if (freshIntent != null)
            {
                _direction = "outbound";
                _intentId = freshIntent.IntentId;
                _clientCallId = freshIntent.ClientCallId;
                if (string.IsNullOrWhiteSpace(_phoneNumber))
                    _phoneNumber = freshIntent.PhoneE164;
            }
            else
            {
                _direction = "inbound";
            }
        }

        CallState prev = _state;
        switch (_state)
        {
                case CallState.Idle:
                    // If the user just confirmed a tentative-end, suppress
                    // re-entry to Connected until Zoom actually drops the
                    // session (or a fresh dial intent arrives — the user
                    // explicitly wants a new call). Without this, the
                    // lingering IsActive=true from the prior call bounces
                    // us straight back to Connected on the next poll and
                    // re-locks the dashboard form.
                    if (_userConfirmedEnd && freshIntent == null)
                    {
                        if (!audioActive)
                            _userConfirmedEnd = false;
                        break;
                    }
                    _userConfirmedEnd = false;
                    if (effectiveActive)
                    {
                        _state = CallState.Connected;
                        _connectedAt = DateTime.UtcNow;
                        _audioInactiveSince = null;
                        _uiCallGoneSince = null;
                        // Seed the flow latch so the silence fallback below
                        // doesn't fire spuriously before the first peak.
                        _audioFlowLastSeen ??= DateTime.UtcNow;
                    }
                    else if (effectiveRinging)
                    {
                        _state = CallState.Ringing;
                        _ringingAt = DateTime.UtcNow;
                    }
                    break;

                case CallState.Ringing:
                    if (effectiveActive)
                    {
                        _state = CallState.Connected;
                        _connectedAt = DateTime.UtcNow;
                        _audioInactiveSince = null;
                        _uiCallGoneSince = null;
                        _audioFlowLastSeen ??= DateTime.UtcNow;
                    }
                    else if (!effectiveRinging)
                    {
                        // Ring disappeared without this device answering
                        // (the caller gave up, someone else on the shared
                        // account answered, or the user declined).
                        _state = CallState.Ended;
                        _endedAt = DateTime.UtcNow;
                        _audioActiveLastSeen = null;
                    }
                    else if (_ringingAt.HasValue &&
                             (DateTime.UtcNow - _ringingAt.Value).TotalSeconds > RingingTimeoutSeconds)
                    {
                        _state = CallState.Ended;
                        _endedAt = DateTime.UtcNow;
                        _audioActiveLastSeen = null;
                    }
                    break;

                case CallState.Connected:
                    if (_hardEnd)
                    {
                        // Hard end signal (audio session disconnected, UI
                        // panel removed, or user-confirmed silence) — go
                        // straight to Ended. Use the silence start time so
                        // hold-music / mute time isn't billed as talk time.
                        _state = CallState.Ended;
                        _endedAt = _tentativeEndAt ?? _uiCallGoneSince ?? DateTime.UtcNow;
                        _tentativeEndAt = null;
                        _audioActiveLastSeen = null;
                        _hardEnd = false;
                    }
                    else if (!effectiveActive)
                    {
                        _uiCallGoneSince ??= DateTime.UtcNow;
                        if ((DateTime.UtcNow - _uiCallGoneSince.Value).TotalSeconds > UiLossConfirmSeconds)
                        {
                            // Audio-only silence is unreliable — the user
                            // could be on hold, muted, or in a long pause.
                            // Surface a TENTATIVE end to the dashboard so it
                            // can prompt the user to confirm; do NOT force
                            // Ended here. ConfirmEnd() and OnAudioSessionGone
                            // are the only paths that flip _hardEnd=true.
                            _tentativeEndAt ??= _uiCallGoneSince;
                        }
                    }
                    else
                    {
                        // Activity returned — call is clearly still live,
                        // tear down any pending tentative state…
                        _uiCallGoneSince = null;
                        _tentativeEndAt = null;

                        // …UNLESS the only "activity" is the WASAPI session
                        // sitting in IsActive=true with no real audio flow.
                        // Zoom can leave the session armed for several
                        // seconds after a hangup without firing
                        // ZoomAudioSessionGone, which keeps
                        // _audioActiveLastSeen refreshed and prevents the
                        // !effectiveActive branch from ever running. Use a
                        // stricter flow-based silence window as a fallback
                        // so the dashboard still gets the tentative-end
                        // prompt and the user can save the call.
                        bool flowSilenceLong = _audioFlowLastSeen.HasValue
                            && (DateTime.UtcNow - _audioFlowLastSeen.Value).TotalSeconds
                                > AudioFlowSilenceTentativeSeconds;
                        if (flowSilenceLong)
                            _tentativeEndAt = _audioFlowLastSeen;
                    }

                    // Independently track audio dropouts for confidence.
                    if (!audioActive)
                        _audioInactiveSince ??= DateTime.UtcNow;
                    else
                        _audioInactiveSince = null;
                    break;

                case CallState.Ended:
                    // Once Ended is reached we do NOT bounce back to
                    // Connected. Connected→Ended already required
                    // UiLossConfirmSeconds of sustained inactivity, so the
                    // call genuinely ended. Allowing re-entry to Connected
                    // here let a flapping audio session create an
                    // Ended↔Connected loop that reset _endedAt every cycle
                    // and prevented the cleanup transition to Idle from
                    // ever running. A real new call will re-enter through
                    // Idle→Connected once the cooldown expires.
                    if (_endedAt.HasValue &&
                        (DateTime.UtcNow - _endedAt.Value).TotalSeconds > EndedCooldownSeconds)
                    {
                        _state = CallState.Idle;
                        _phoneNumber = null;
                        _direction = null;
                        _intentId = null;
                        _clientCallId = null;
                        _connectedAt = null;
                        _ringingAt = null;
                        _endedAt = null;
                        _tentativeEndAt = null;
                        _hardEnd = false;
                        // Reset the audio latch so a brief stale signal
                        // from the prior call cannot trigger Idle→Connected
                        // on the very next poll for a back-to-back call.
                        _audioActiveLastSeen = null;
                        _audioFlowLastSeen = null;
                        _audioInactiveSince = null;
                        _uiCallGoneSince = null;
                    }
                    break;
        }

        // Confidence tiers:
        //   High   = UI active AND audio flowing (deterministic, both sources agree)
        //   Medium = UI active XOR audio flowing (one strong signal)
        //   Low    = everything else
        SignalConfidence conf;
        if (uiActive && audioFlowing) conf = SignalConfidence.High;
        else if (uiActive || audioFlowing) conf = SignalConfidence.Medium;
        else conf = SignalConfidence.Low;

        // For talk-time, prefer the tentative end timestamp over "now" once
        // silence has been detected — that way a hold/mute/long-pause that
        // the user later confirms ended doesn't keep ticking the duration.
        DateTime durationCutoff = _endedAt ?? _tentativeEndAt ?? DateTime.UtcNow;
        int duration = _connectedAt.HasValue
            ? (int)Math.Ceiling((durationCutoff - _connectedAt.Value).TotalSeconds)
            : 0;

        bool tentative = _state == CallState.Connected && _tentativeEndAt != null;

        var info = new CallStateInfo
        {
            State = _state,
            PhoneNumber = _phoneNumber,
            Direction = _direction,
            Confidence = conf,
            StartTime = _ringingAt ?? _connectedAt,
            ConnectTime = _connectedAt,
            EndTime = _endedAt,
            DurationSeconds = duration,
            DeviceId = DeviceIdentity.DeviceId,
            IntentId = _intentId,
            ClientCallId = _clientCallId,
            UiSeenHere = uiActive || uiRinging,
            AudioActiveHere = audioActive,
            // Teammate-busy: account-wide presence shows "On a call" while
            // THIS device has no active/ring UI — must be another teammate.
            TeammateOnCall = ui.AccountPresenceOnCall && !uiActive && !uiRinging,
            TentativeEnd = tentative,
            SilenceStartedAt = tentative ? _tentativeEndAt : null,
        };

        CurrentState = info;

        bool teammateChanged = info.TeammateOnCall != _lastTeammateOnCall;
        _lastTeammateOnCall = info.TeammateOnCall;

        // Edge-detect tentative-end transitions so the dashboard learns
        // about them even when CallState itself doesn't change (we stay in
        // Connected during a tentative hangup window).
        bool tentativeChanged = tentative != _lastTentative;
        _lastTentative = tentative;

        if (_state != prev)
        {
            Debug.WriteLine($"[Fusion] {prev} → {_state} | phone={_phoneNumber} conf={conf} ui={uiActive}/{uiRinging} audio(active={audioActive} flow={audioFlowing} alive={audioAlive}) window(timer={window.IsTimerDetected} calling={window.IsCallingDetected} incoming={window.IsIncomingDetected}) teammate={info.TeammateOnCall}");
            return info;
        }
        if (tentativeChanged)
        {
            Debug.WriteLine($"[Fusion] tentativeEnd → {tentative} (silenceStartedAt={_tentativeEndAt:o})");
            return info;
        }
        if (teammateChanged)
        {
            Debug.WriteLine($"[Fusion] teammateOnCall → {info.TeammateOnCall}");
            return info;
        }
        return null;
    }

    private CallStateInfo BuildStateInfoLocked()
    {
        // Used by ConfirmEnd / DismissTentativeEnd to surface a fresh state
        // info to subscribers without going through a full Evaluate pass.
        DateTime durationCutoff = _endedAt ?? _tentativeEndAt ?? DateTime.UtcNow;
        int duration = _connectedAt.HasValue
            ? (int)Math.Ceiling((durationCutoff - _connectedAt.Value).TotalSeconds)
            : 0;
        bool tentative = _state == CallState.Connected && _tentativeEndAt != null;
        return new CallStateInfo
        {
            State = _state,
            PhoneNumber = _phoneNumber,
            Direction = _direction,
            Confidence = CurrentState.Confidence,
            StartTime = _ringingAt ?? _connectedAt,
            ConnectTime = _connectedAt,
            EndTime = _endedAt,
            DurationSeconds = duration,
            DeviceId = DeviceIdentity.DeviceId,
            IntentId = _intentId,
            ClientCallId = _clientCallId,
            UiSeenHere = CurrentState.UiSeenHere,
            AudioActiveHere = CurrentState.AudioActiveHere,
            TeammateOnCall = CurrentState.TeammateOnCall,
            TentativeEnd = tentative,
            SilenceStartedAt = tentative ? _tentativeEndAt : null,
        };
    }

    public void Dispose() => Stop();
}
