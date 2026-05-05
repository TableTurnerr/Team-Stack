using System.Diagnostics;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace LocalCrmAgent.Services;

/// <summary>
/// Monitors Windows audio sessions (WASAPI) to detect whether Zoom has an
/// active audio stream. Uses event-driven callbacks for instant detection
/// (session created/state changed/disconnected) with a slow fallback poll
/// to catch any missed events.
///
/// This is the primary ground-truth signal: an active audio session means
/// a call is in progress, regardless of network state.
/// </summary>
public class ZoomAudioMonitor : IDisposable
{
    // ── Win32 P/Invoke for minimizing Zoom after launch ──────────────

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SW_MINIMIZE = 6;

    // Broad matching for audio session detection — safe because we're only
    // checking processes that already have an active audio session.
    private static readonly string[] ZoomProcessNames =
        ["zoom", "cpthost", "zoomphone", "zoom phone"];

    // Exact-match names for the main Zoom APPLICATION (not background services
    // like ZoomWebHost, ZoomUs, updaters, etc. that persist after closing the app).
    private static readonly string[] ZoomAppProcessNames =
        ["zoom", "zoomphone"];

    public class AudioSessionInfo
    {
        public bool SessionExists { get; set; }
        public bool IsActive { get; set; }
        public float PeakLevel { get; set; }
        public int ProcessId { get; set; }
        public string ProcessName { get; set; } = "";
    }

    /// <summary>
    /// Fired immediately when a Zoom audio session changes state
    /// (created, activated, deactivated, disconnected).
    /// The bool indicates whether Zoom audio is currently active.
    /// </summary>
    public event Action<bool>? ZoomAudioStateChanged;

    /// <summary>
    /// Fired when a tracked Zoom audio session disconnects entirely
    /// (i.e. the underlying COM session went away). Strong signal that
    /// the call really ended — fusion uses this to bypass the audio
    /// latch so Connected→Ended is immediate instead of waiting out
    /// the silence-tolerance window.
    /// </summary>
    public event Action? ZoomAudioSessionGone;

    // Persistent references — must stay alive for callbacks to fire.
    private MMDeviceEnumerator? _enumerator;
    private readonly List<MMDevice> _watchedDevices = new();
    private readonly List<AudioSessionManager> _watchedManagers = new();
    private readonly List<ZoomSessionListener> _sessionListeners = new();
    private readonly List<SessionCreatedWatcher> _sessionWatchers = new();
    private readonly object _lock = new();
    private bool _disposed;

    /// <summary>
    /// Start listening for WASAPI audio session events on render + capture devices.
    /// Call this once at startup.
    /// </summary>
    public void StartWatching()
    {
        lock (_lock)
        {
            StopWatching();

            try
            {
                _enumerator = new MMDeviceEnumerator();
                WatchDevice(DataFlow.Render, Role.Multimedia);
                WatchDevice(DataFlow.Capture, Role.Communications);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[AudioMonitor] Failed to start watching: {ex.Message}");
            }
        }
    }

    private void WatchDevice(DataFlow dataFlow, Role role)
    {
        try
        {
            var device = _enumerator!.GetDefaultAudioEndpoint(dataFlow, role);
            _watchedDevices.Add(device);

            var mgr = device.AudioSessionManager;
            _watchedManagers.Add(mgr);

            // Watch for NEW audio sessions being created (e.g. Zoom starts a call)
            var watcher = new SessionCreatedWatcher(this);
            mgr.OnSessionCreated += watcher.OnSessionCreated;
            _sessionWatchers.Add(watcher);

            // Attach listeners to all EXISTING sessions (in case Zoom is already running)
            AttachToExistingSessions(device);

            Debug.WriteLine($"[AudioMonitor] Watching {dataFlow} device for session events");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AudioMonitor] Could not watch {dataFlow}/{role}: {ex.Message}");
        }
    }

    private void AttachToExistingSessions(MMDevice device)
    {
        try
        {
            var sessions = device.AudioSessionManager.Sessions;
            if (sessions == null) return;

            for (int i = 0; i < sessions.Count; i++)
            {
                try
                {
                    var session = sessions[i];
                    var pid = (int)session.GetProcessID;
                    if (pid == 0) continue;

                    string processName;
                    try
                    {
                        using var proc = Process.GetProcessById(pid);
                        processName = proc.ProcessName;
                    }
                    catch { continue; }

                    if (!IsZoomProcess(processName)) continue;

                    AttachListenerToSession(session, pid);
                }
                catch { continue; }
            }
        }
        catch { /* device may not support session enumeration */ }
    }

    private void AttachListenerToSession(AudioSessionControl session, int pid)
    {
        lock (_lock)
        {
            // Don't attach duplicate listeners for the same PID
            if (_sessionListeners.Any(l => l.ProcessId == pid)) return;

            var listener = new ZoomSessionListener(this, pid);
            session.RegisterEventClient(listener);
            _sessionListeners.Add(listener);
            Debug.WriteLine($"[AudioMonitor] Attached event listener to Zoom session (PID {pid})");
        }
    }

    /// <summary>
    /// Called by session event listeners when state changes.
    /// Re-scans and fires ZoomAudioStateChanged.
    /// </summary>
    internal void OnSessionEvent(string reason)
    {
        Debug.WriteLine($"[AudioMonitor] Session event: {reason}");
        var state = GetZoomAudioState();
        bool isActive = state is { IsActive: true };
        ZoomAudioStateChanged?.Invoke(isActive);
    }

    /// <summary>
    /// Called by a session listener when its underlying session disconnects.
    /// Drops the listener from our tracking list (otherwise stale listeners
    /// from prior calls accumulate over a long power-dial session and can
    /// keep firing spurious events) and notifies fusion that audio is truly
    /// gone so it can short-circuit the silence-tolerance latch.
    /// </summary>
    internal void OnSessionGone(int pid)
    {
        lock (_lock)
        {
            _sessionListeners.RemoveAll(l => l.ProcessId == pid);
        }
        ZoomAudioSessionGone?.Invoke();
        OnSessionEvent($"Disconnected PID={pid} (listener removed)");
    }

    /// <summary>
    /// Check all audio sessions on the default render device for a Zoom process.
    /// Returns the best matching Zoom audio session, or null if none found.
    /// </summary>
    public AudioSessionInfo? GetZoomAudioState()
    {
        try
        {
            using var enumerator = new MMDeviceEnumerator();

            // Check both render (speaker) and capture (mic) devices
            var device = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            var result = ScanDevice(device);
            if (result != null) return result;

            // Also check capture device — some Zoom configs route through capture
            try
            {
                var captureDevice = enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
                return ScanDevice(captureDevice);
            }
            catch
            {
                return null;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AudioMonitor] Error scanning audio sessions: {ex.Message}");
            return null;
        }
    }

    private AudioSessionInfo? ScanDevice(MMDevice device)
    {
        AudioSessionInfo? bestMatch = null;

        try
        {
            var sessions = device.AudioSessionManager.Sessions;
            if (sessions == null) return null;

            for (int i = 0; i < sessions.Count; i++)
            {
                try
                {
                    var session = sessions[i];
                    var pid = (int)session.GetProcessID;
                    if (pid == 0) continue;

                    string processName;
                    try
                    {
                        using var proc = Process.GetProcessById(pid);
                        processName = proc.ProcessName;
                    }
                    catch
                    {
                        continue; // Process already exited
                    }

                    if (!IsZoomProcess(processName)) continue;

                    var sessionState = session.State;
                    float peak = 0f;
                    try
                    {
                        peak = session.AudioMeterInformation.MasterPeakValue;
                    }
                    catch { /* some sessions don't support metering */ }

                    var info = new AudioSessionInfo
                    {
                        SessionExists = true,
                        IsActive = sessionState == AudioSessionState.AudioSessionStateActive,
                        PeakLevel = peak,
                        ProcessId = pid,
                        ProcessName = processName,
                    };

                    // Prefer active sessions, then sessions with higher peak audio
                    if (bestMatch == null
                        || (info.IsActive && !bestMatch.IsActive)
                        || (info.IsActive && bestMatch.IsActive && info.PeakLevel > bestMatch.PeakLevel))
                    {
                        bestMatch = info;
                    }
                }
                catch { continue; }
            }
        }
        catch { /* device may not support session enumeration */ }

        return bestMatch;
    }

    /// <summary>
    /// Quick check: is the main Zoom application currently running?
    /// Uses exact process-name matching to avoid false positives from
    /// Zoom background services (ZoomWebHost, updaters, etc.) that
    /// persist even after the user closes Zoom.
    /// </summary>
    public bool IsZoomRunning()
    {
        try
        {
            var processes = Process.GetProcesses();
            try
            {
                foreach (var proc in processes)
                {
                    try
                    {
                        if (IsZoomAppProcess(proc.ProcessName))
                            return true;
                    }
                    catch { }
                }
            }
            finally
            {
                // Dispose ALL process handles — not just the matched one.
                // Process.GetProcesses() allocates native handles for every
                // process; failing to dispose them all leaks OS handles.
                foreach (var proc in processes)
                    try { proc.Dispose(); } catch { }
            }
        }
        catch { }
        return false;
    }

    /// <summary>
    /// Exact match against known Zoom application process names.
    /// Excludes background services like ZoomWebHost, ZoomUs, etc.
    /// </summary>
    private static bool IsZoomAppProcess(string processName)
    {
        return ZoomAppProcessNames.Any(z =>
            string.Equals(processName, z, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Attempt to launch Zoom if it is not already running.
    /// Returns (success, alreadyRunning, message).
    /// Polls for up to 10 seconds after launch to confirm the process started.
    /// </summary>
    public async Task<(bool Success, bool AlreadyRunning, string Message)> LaunchZoom()
    {
        if (IsZoomRunning())
            return (true, true, "Zoom is already running");

        var exePath = FindZoomExecutable();
        if (exePath == null)
        {
            // Fallback: try the zoommtg:// protocol handler
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "zoommtg://zoom.us/",
                    UseShellExecute = true,
                });
                if (await WaitForZoomProcess())
                {
                    MinimizeZoomWindows();
                    return (true, false, "Zoom launched via protocol handler");
                }
                return (false, false, "Zoom not found — please install or launch manually");
            }
            catch
            {
                return (false, false, "Zoom not found — please install or launch manually");
            }
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Minimized,
            });
            if (await WaitForZoomProcess())
            {
                // Zoom creates its own windows after the initial process starts,
                // so minimize all visible Zoom windows to keep it in the background.
                MinimizeZoomWindows();
                return (true, false, "Zoom launched successfully");
            }
            return (false, false, "Zoom process started but not detected yet");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AudioMonitor] Failed to launch Zoom: {ex.Message}");
            return (false, false, $"Failed to launch Zoom: {ex.Message}");
        }
    }

    /// <summary>
    /// Poll for the main Zoom process for up to 10 seconds (1s intervals).
    /// Zoom can take several seconds to fully start.
    /// </summary>
    private async Task<bool> WaitForZoomProcess()
    {
        for (int i = 0; i < 10; i++)
        {
            await Task.Delay(1000);
            if (IsZoomRunning())
            {
                Debug.WriteLine($"[AudioMonitor] Zoom process detected after {i + 1}s");
                return true;
            }
        }
        return false;
    }

    /// <summary>
    /// Minimize all visible Zoom windows so the app runs in the background
    /// (system tray) without stealing focus from the CRM.
    /// </summary>
    private void MinimizeZoomWindows()
    {
        try
        {
            // Collect PIDs of running Zoom app processes
            var zoomPids = new HashSet<uint>();
            var processes = Process.GetProcesses();
            try
            {
                foreach (var proc in processes)
                {
                    try
                    {
                        if (IsZoomAppProcess(proc.ProcessName))
                            zoomPids.Add((uint)proc.Id);
                    }
                    catch { }
                }
            }
            finally
            {
                foreach (var proc in processes)
                    try { proc.Dispose(); } catch { }
            }

            if (zoomPids.Count == 0) return;

            int minimized = 0;
            EnumWindows((hWnd, _) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                GetWindowThreadProcessId(hWnd, out uint pid);
                if (zoomPids.Contains(pid))
                {
                    ShowWindow(hWnd, SW_MINIMIZE);
                    minimized++;
                }
                return true;
            }, IntPtr.Zero);

            Debug.WriteLine($"[AudioMonitor] Minimized {minimized} Zoom window(s)");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AudioMonitor] Failed to minimize Zoom: {ex.Message}");
        }
    }

    /// <summary>
    /// Search common install locations and registry for Zoom executable.
    /// </summary>
    private static string? FindZoomExecutable()
    {
        // Check registry for Zoom install path
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ZoomUMX");
            var installLoc = key?.GetValue("InstallLocation") as string;
            if (installLoc != null)
            {
                var regPath = Path.Combine(installLoc, "Zoom.exe");
                if (File.Exists(regPath)) return regPath;
            }
        }
        catch { }

        // Check common file paths
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

        string[] candidates =
        [
            Path.Combine(appData, "Zoom", "bin", "Zoom.exe"),
            Path.Combine(localAppData, "Zoom", "bin", "Zoom.exe"),
            Path.Combine(programFiles, "Zoom", "bin", "Zoom.exe"),
            Path.Combine(programFilesX86, "Zoom", "bin", "Zoom.exe"),
            Path.Combine(appData, "Zoom Phone", "bin", "ZoomPhone.exe"),
            Path.Combine(localAppData, "Zoom Phone", "bin", "ZoomPhone.exe"),
        ];

        return candidates.FirstOrDefault(File.Exists);
    }

    private void StopWatching()
    {
        _sessionListeners.Clear();
        _sessionWatchers.Clear();
        _watchedManagers.Clear();
        foreach (var d in _watchedDevices)
        {
            try { d.Dispose(); }
            catch (Exception ex) { FileLogger.Write($"[ZoomAudio] Device dispose failed: {ex.Message}"); }
        }
        _watchedDevices.Clear();
        _enumerator?.Dispose();
        _enumerator = null;
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_disposed) return;
            _disposed = true;
            StopWatching();
        }
    }

    private static bool IsZoomProcess(string processName)
    {
        return ZoomProcessNames.Any(z =>
            processName.Contains(z, StringComparison.OrdinalIgnoreCase));
    }

    // ── WASAPI callback: new session created ─────────────────────────

    private class SessionCreatedWatcher
    {
        private readonly ZoomAudioMonitor _monitor;
        public SessionCreatedWatcher(ZoomAudioMonitor monitor) => _monitor = monitor;

        public void OnSessionCreated(object sender, IAudioSessionControl newSession)
        {
            try
            {
                // Wrap the raw COM interface in NAudio's managed wrapper
                var session = new AudioSessionControl(newSession);
                var pid = (int)session.GetProcessID;
                if (pid == 0) return;

                string processName;
                try
                {
                    using var proc = Process.GetProcessById(pid);
                    processName = proc.ProcessName;
                }
                catch { return; }

                if (!IsZoomProcess(processName)) return;

                Debug.WriteLine($"[AudioMonitor] New Zoom session created (PID {pid})");
                _monitor.AttachListenerToSession(session, pid);
                _monitor.OnSessionEvent($"SessionCreated PID={pid}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[AudioMonitor] Error in OnSessionCreated: {ex.Message}");
            }
        }
    }

    // ── WASAPI callback: session state/disconnect events ────────────

    private class ZoomSessionListener : IAudioSessionEventsHandler
    {
        private readonly ZoomAudioMonitor _monitor;
        public int ProcessId { get; }

        public ZoomSessionListener(ZoomAudioMonitor monitor, int pid)
        {
            _monitor = monitor;
            ProcessId = pid;
        }

        public void OnStateChanged(AudioSessionState state)
        {
            Debug.WriteLine($"[AudioMonitor] Session PID={ProcessId} state → {state}");
            // Expired = the COM session is dead and won't fire further
            // events; treat it as a hard disconnect so we drop the listener
            // and fast-path the fusion's silence latch.
            if (state == AudioSessionState.AudioSessionStateExpired)
                _monitor.OnSessionGone(ProcessId);
            else
                _monitor.OnSessionEvent($"StateChanged PID={ProcessId} state={state}");
        }

        public void OnSessionDisconnected(AudioSessionDisconnectReason disconnectReason)
        {
            Debug.WriteLine($"[AudioMonitor] Session PID={ProcessId} disconnected: {disconnectReason}");
            _monitor.OnSessionGone(ProcessId);
        }

        // Required by interface but not needed for our use case
        public void OnVolumeChanged(float volume, bool isMuted) { }
        public void OnDisplayNameChanged(string displayName) { }
        public void OnIconPathChanged(string iconPath) { }
        public void OnChannelVolumeChanged(uint channelCount, nint newVolumes, uint channelIndex) { }
        public void OnGroupingParamChanged(ref Guid groupingId) { }
    }
}
