using System.Diagnostics;
using System.Text;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace LocalCrmAgent.Services;

/// <summary>
/// Detects Zoom <b>web-phone</b> calls (the Chrome web dialer) by watching for a
/// Chrome microphone-capture session across the machine's capture devices.
///
/// <para>Why not the extension? The Chrome extension's WebSocket-lifecycle
/// heuristic cannot separate individual web calls: Zoom web phone keeps a single
/// signaling socket open for the whole tab session, so the socket opens once (at
/// dialer init) and only closes when the tab closes. That gives at most one
/// START per tab and no per-call boundaries.</para>
///
/// <para>Instead we ride the same WASAPI signal that makes desktop detection
/// rock-solid, but on Chrome's <i>capture</i> (microphone) session: Chrome only
/// streams the mic while a WebRTC call (the Zoom web dialer) is actually live.
/// We <b>poll</b> every active capture device once a second rather than rely on
/// the per-device session-created COM event — Chrome does not consistently use
/// the <i>communications</i> default endpoint (it usually opens the console/
/// multimedia default), and the capture-side OnSessionCreated event proved
/// unreliable. A 1 Hz scan across all active capture endpoints is deterministic
/// and immune to which device Chrome picks.</para>
///
/// <para>Signal semantics:
/// <list type="bullet">
/// <item><b>Start</b> = a Chrome capture session reaches the <i>Active</i> state
/// (mic streaming). WebRTC keeps streaming through talk-silence, so this rides
/// through both parties going quiet.</item>
/// <item><b>End</b> = no Chrome capture session is Active for <see cref="EndGraceSeconds"/>
/// seconds (the call hung up and Chrome released / stopped streaming the mic).
/// A short grace absorbs renegotiation blips and gives back-to-back calls clean
/// separation.</item>
/// </list></para>
/// </summary>
public sealed class ChromeCallMonitor : IDisposable
{
    // Chrome's main process name is "chrome" (Chromium Edge is "msedge").
    private static readonly string[] BrowserProcessNames = ["chrome", "msedge"];

    private const int PollIntervalMs = 1000;

    // No Chrome mic session Active for this long => the web call ended. Long
    // enough to ride app-level renegotiation blips, short enough to free the
    // state machine quickly for a back-to-back call.
    private const double EndGraceSeconds = 4.0;

    /// <summary>Fired when a Chrome web-phone call becomes live (mic streaming).</summary>
    public event Action? WebCallStarted;

    /// <summary>Fired when the live Chrome web-phone call has ended (mic released).</summary>
    public event Action? WebCallEnded;

    private Thread? _pollThread;
    private volatile bool _running;
    private bool _disposed;
    private readonly object _lock = new();

    private bool _webCallActive;
    private DateTime _lastActiveSeen = DateTime.MinValue;
    private string _lastSignature = "";

    public bool IsWebCallActive { get { lock (_lock) return _webCallActive; } }

    public void StartWatching()
    {
        lock (_lock)
        {
            if (_disposed || _running) return;
            _running = true;
            _pollThread = new Thread(PollLoop)
            {
                IsBackground = true,
                Name = "ChromeCallMonitor",
            };
            _pollThread.Start();
            FileLogger.Write("[ChromeCall] Polling capture devices for Chrome web-phone calls");
        }
    }

    private void PollLoop()
    {
        while (_running)
        {
            try { Scan(); }
            catch (Exception ex) { FileLogger.Write($"[ChromeCall] Scan error: {ex.Message}"); }
            Thread.Sleep(PollIntervalMs);
        }
    }

    private void Scan()
    {
        bool anyActive = false;
        var sig = new StringBuilder();

        using (var enumerator = new MMDeviceEnumerator())
        {
            var devices = enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);
            foreach (var device in devices)
            {
                try
                {
                    var sessions = device.AudioSessionManager.Sessions;
                    if (sessions == null) continue;
                    for (int i = 0; i < sessions.Count; i++)
                    {
                        try
                        {
                            var session = sessions[i];
                            var pid = (int)session.GetProcessID;
                            if (pid == 0 || !IsBrowserPid(pid)) continue;

                            var state = session.State;
                            if (state == AudioSessionState.AudioSessionStateActive)
                                anyActive = true;

                            // Record into the change-signature so we only log on
                            // transitions, not every poll.
                            sig.Append(device.FriendlyName).Append(':').Append(pid)
                               .Append(':').Append(state).Append(';');
                        }
                        catch { /* session vanished mid-scan */ }
                    }
                }
                catch { /* device may not support session enumeration */ }
                finally { try { device.Dispose(); } catch { } }
            }
        }

        Evaluate(anyActive, sig.ToString());
    }

    private void Evaluate(bool anyActive, string signature)
    {
        Action? toFire = null;

        lock (_lock)
        {
            if (_disposed) return;

            if (signature != _lastSignature)
            {
                _lastSignature = signature;
                FileLogger.Write($"[ChromeCall] Chrome mic sessions: {(string.IsNullOrEmpty(signature) ? "(none)" : signature)}");
            }

            var now = DateTime.UtcNow;
            if (anyActive) _lastActiveSeen = now;

            if (!_webCallActive)
            {
                if (anyActive)
                {
                    _webCallActive = true;
                    FileLogger.Write("[ChromeCall] Web call STARTED (Chrome mic streaming)");
                    toFire = WebCallStarted;
                }
            }
            else
            {
                var quietFor = (now - _lastActiveSeen).TotalSeconds;
                if (!anyActive && quietFor >= EndGraceSeconds)
                {
                    _webCallActive = false;
                    FileLogger.Write($"[ChromeCall] Web call ENDED (no Chrome mic stream for {quietFor:F1}s)");
                    toFire = WebCallEnded;
                }
            }
        }

        if (toFire != null)
        {
            try { toFire.Invoke(); }
            catch (Exception ex) { FileLogger.Write($"[ChromeCall] handler error: {ex.Message}"); }
        }
    }

    private static bool IsBrowserPid(int pid)
    {
        try
        {
            using var proc = Process.GetProcessById(pid);
            return BrowserProcessNames.Any(n =>
                string.Equals(proc.ProcessName, n, StringComparison.OrdinalIgnoreCase));
        }
        catch { return false; }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
            _running = false;
        }
        try { _pollThread?.Join(1500); } catch { }
    }
}
