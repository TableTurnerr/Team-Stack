using System.Diagnostics;
using LocalCrmAgent.Models;

namespace LocalCrmAgent.Services;

/// <summary>
/// State machine that fuses signals from audio monitoring (primary),
/// window monitoring (supplementary), and network quality into a
/// unified call state.
///
/// Primary: event-driven via ZoomAudioMonitor.ZoomAudioStateChanged
/// (fires instantly when WASAPI session state changes).
/// Secondary: fallback poll every 500ms to catch any missed events.
///
/// Key principle: WASAPI audio session state is ground truth.
/// If Zoom has an active audio session, the call is live — regardless
/// of what the network or Zoom iframe says.
/// </summary>
public class CallStateFusion : IDisposable
{
    private readonly ZoomAudioMonitor _audioMonitor;
    private readonly ZoomWindowMonitor _windowMonitor;

    private CallState _state = CallState.Idle;
    private DateTime? _audioInactiveSince;
    private DateTime? _endedAt;
    private DateTime? _connectedAt;
    private DateTime? _ringingAt;
    private string? _phoneNumber;

    private CancellationTokenSource? _cts;
    private Task? _pollingTask;
    private readonly object _lock = new();

    // How long audio must be inactive before we declare the call ended.
    // With event-driven detection this is just a confirmation threshold —
    // the event fires instantly, and we confirm on the next evaluation.
    private const double AudioInactiveThresholdSeconds = 0.3;

    // How long to stay in "ended" before returning to idle.
    private const double EndedCooldownSeconds = 1.0;

    // How long to stay in "ringing" without audio before giving up.
    private const double RingingTimeoutSeconds = 60.0;

    public event Action<CallStateInfo>? StateChanged;
    public CallStateInfo CurrentState { get; private set; } = new();

    public CallStateFusion(ZoomAudioMonitor audioMonitor, ZoomWindowMonitor windowMonitor)
    {
        _audioMonitor = audioMonitor;
        _windowMonitor = windowMonitor;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();

        // Subscribe to instant WASAPI events
        _audioMonitor.ZoomAudioStateChanged += OnAudioEvent;
        _audioMonitor.StartWatching();

        // Slow fallback poll — catches anything events might miss
        _pollingTask = Task.Run(() => FallbackPollLoop(_cts.Token));
        Debug.WriteLine("[Fusion] Started (event-driven + 500ms fallback poll)");
    }

    public void Stop()
    {
        _audioMonitor.ZoomAudioStateChanged -= OnAudioEvent;
        _cts?.Cancel();
        try { _pollingTask?.Wait(2000); } catch { }
        _cts?.Dispose();
        _cts = null;
        Debug.WriteLine("[Fusion] Stopped");
    }

    /// <summary>
    /// Called instantly by WASAPI when a Zoom audio session changes state.
    /// </summary>
    private void OnAudioEvent(bool isActive)
    {
        Debug.WriteLine($"[Fusion] Audio event: isActive={isActive}");
        Evaluate();
    }

    /// <summary>
    /// Fallback poll — runs every 500ms to catch edge cases where
    /// WASAPI events might not fire (device changes, COM threading, etc).
    /// </summary>
    private async Task FallbackPollLoop(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                Evaluate();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Fusion] Fallback poll error: {ex.Message}");
            }

            try { await Task.Delay(500, ct); }
            catch (OperationCanceledException) { break; }
        }
    }

    /// <summary>
    /// Core state machine evaluation. Called both by events (instant)
    /// and by the fallback poll (every 2s).
    /// </summary>
    private void Evaluate()
    {
        var audio = _audioMonitor.GetZoomAudioState();
        var window = _windowMonitor.GetZoomWindowInfo();

        // Audio signals (ground truth)
        bool audioSessionActive = audio is { IsActive: true };
        bool audioFlowing = audioSessionActive && audio!.PeakLevel > 0.001f;

        // Window signals (supplementary)
        bool windowCalling = window.IsCallingDetected || window.IsRingingDetected;
        bool windowTimer = window.IsTimerDetected;
        bool windowIncoming = window.IsIncomingDetected;

        // Phone number from window title
        if (window.DetectedPhoneNumber != null)
            _phoneNumber = window.DetectedPhoneNumber;

        CallState prevState;
        lock (_lock)
        {
            prevState = _state;

            switch (_state)
            {
                case CallState.Idle:
                    if (audioSessionActive)
                    {
                        // Audio session active = call connected (most reliable signal)
                        TransitionTo(CallState.Connected);
                        _connectedAt = DateTime.UtcNow;
                        _audioInactiveSince = null;
                    }
                    else if (windowCalling)
                    {
                        // Window shows "Calling" but no audio yet = ringing
                        TransitionTo(CallState.Ringing);
                        _ringingAt = DateTime.UtcNow;
                    }
                    break;

                case CallState.Ringing:
                    if (audioSessionActive)
                    {
                        // Call answered — audio started
                        TransitionTo(CallState.Connected);
                        _connectedAt = DateTime.UtcNow;
                        _audioInactiveSince = null;
                    }
                    else if (!windowCalling && !windowTimer)
                    {
                        // Window no longer shows calling and no timer
                        if (_ringingAt.HasValue &&
                            (DateTime.UtcNow - _ringingAt.Value).TotalSeconds > RingingTimeoutSeconds)
                        {
                            TransitionTo(CallState.Ended);
                            _endedAt = DateTime.UtcNow;
                        }
                    }
                    break;

                case CallState.Connected:
                    if (!audioSessionActive)
                    {
                        // Audio session went inactive — start countdown
                        _audioInactiveSince ??= DateTime.UtcNow;

                        if ((DateTime.UtcNow - _audioInactiveSince.Value).TotalSeconds > AudioInactiveThresholdSeconds)
                        {
                            // Sustained inactivity — call genuinely ended
                            TransitionTo(CallState.Ended);
                            _endedAt = DateTime.UtcNow;
                        }
                    }
                    else
                    {
                        // Audio still active — reset inactivity timer
                        _audioInactiveSince = null;
                    }
                    break;

                case CallState.Ended:
                    if (audioSessionActive)
                    {
                        // New call started (or reconnected)
                        TransitionTo(CallState.Connected);
                        _connectedAt = DateTime.UtcNow;
                        _audioInactiveSince = null;
                        _endedAt = null;
                    }
                    else if (_endedAt.HasValue &&
                             (DateTime.UtcNow - _endedAt.Value).TotalSeconds > EndedCooldownSeconds)
                    {
                        // Cooldown elapsed — return to idle
                        TransitionTo(CallState.Idle);
                        _phoneNumber = null;
                        _connectedAt = null;
                        _ringingAt = null;
                        _endedAt = null;
                    }
                    break;
            }
        }

        // Build current state info
        var confidence = audioFlowing ? SignalConfidence.High
                       : audioSessionActive ? SignalConfidence.Medium
                       : SignalConfidence.Low;

        int duration = _connectedAt.HasValue
            ? (int)((_endedAt ?? DateTime.UtcNow) - _connectedAt.Value).TotalSeconds
            : 0;

        string? direction = windowIncoming ? "inbound" : null;

        var info = new CallStateInfo
        {
            State = _state,
            PhoneNumber = _phoneNumber,
            Direction = direction,
            Confidence = confidence,
            StartTime = _ringingAt ?? _connectedAt,
            ConnectTime = _connectedAt,
            EndTime = _endedAt,
            DurationSeconds = duration,
        };

        CurrentState = info;

        if (_state != prevState)
        {
            Debug.WriteLine($"[Fusion] {prevState} → {_state} | phone={_phoneNumber} confidence={confidence}");
            StateChanged?.Invoke(info);
        }
    }

    private void TransitionTo(CallState newState)
    {
        Debug.WriteLine($"[Fusion] Transitioning: {_state} → {newState}");
        _state = newState;
    }

    public void Dispose()
    {
        Stop();
    }
}
