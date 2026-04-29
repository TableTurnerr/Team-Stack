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
    // most recent activity and only declare the call gone when there has
    // been no sign of activity for this many seconds.
    private const double AudioLatchSeconds = 2.0;

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
        _audioMonitor.StartWatching();

        _uiWatcher.StateChanged += OnUiEvent;
        _uiWatcher.Start();

        _pollingTask = Task.Run(() => FallbackPollLoop(_cts.Token));
        Debug.WriteLine("[Fusion] Started (UI primary + audio confirm + 500ms fallback)");
    }

    public void Stop()
    {
        _audioMonitor.ZoomAudioStateChanged -= OnAudioEvent;
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
                    if (effectiveActive)
                    {
                        _state = CallState.Connected;
                        _connectedAt = DateTime.UtcNow;
                        _audioInactiveSince = null;
                        _uiCallGoneSince = null;
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
                    if (!effectiveActive)
                    {
                        _uiCallGoneSince ??= DateTime.UtcNow;
                        if ((DateTime.UtcNow - _uiCallGoneSince.Value).TotalSeconds > UiLossConfirmSeconds)
                        {
                            _state = CallState.Ended;
                            _endedAt = DateTime.UtcNow;
                            // Clear the audio latch on confirmed end so the
                            // Ended-cooldown window cannot be artificially
                            // extended by stale latched activity, and so a
                            // new call's first poll sees a fresh signal.
                            _audioActiveLastSeen = null;
                        }
                    }
                    else
                    {
                        _uiCallGoneSince = null;
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
                        // Reset the audio latch so a brief stale signal
                        // from the prior call cannot trigger Idle→Connected
                        // on the very next poll for a back-to-back call.
                        _audioActiveLastSeen = null;
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

        int duration = _connectedAt.HasValue
            ? (int)Math.Ceiling(((_endedAt ?? DateTime.UtcNow) - _connectedAt.Value).TotalSeconds)
            : 0;

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
        };

        CurrentState = info;

        bool teammateChanged = info.TeammateOnCall != _lastTeammateOnCall;
        _lastTeammateOnCall = info.TeammateOnCall;

        if (_state != prev)
        {
            Debug.WriteLine($"[Fusion] {prev} → {_state} | phone={_phoneNumber} conf={conf} ui={uiActive}/{uiRinging} audio(active={audioActive} flow={audioFlowing} alive={audioAlive}) window(timer={window.IsTimerDetected} calling={window.IsCallingDetected} incoming={window.IsIncomingDetected}) teammate={info.TeammateOnCall}");
            return info;
        }
        if (teammateChanged)
        {
            Debug.WriteLine($"[Fusion] teammateOnCall → {info.TeammateOnCall}");
            return info;
        }
        return null;
    }

    public void Dispose() => Stop();
}
