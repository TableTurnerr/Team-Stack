using System.Diagnostics;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace LocalCrmAgent.Services;

/// <summary>
/// Monitors Windows audio sessions (WASAPI) to detect whether Zoom has an
/// active audio stream. This is the primary ground-truth signal: an active
/// audio session means a call is in progress, regardless of network state.
/// </summary>
public class ZoomAudioMonitor
{
    private static readonly string[] ZoomProcessNames =
        ["zoom", "cpthost", "zoomphone", "zoom phone"];

    public class AudioSessionInfo
    {
        public bool SessionExists { get; set; }
        public bool IsActive { get; set; }
        public float PeakLevel { get; set; }
        public int ProcessId { get; set; }
        public string ProcessName { get; set; } = "";
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
    /// Quick check: is any Zoom process currently running?
    /// </summary>
    public bool IsZoomRunning()
    {
        try
        {
            foreach (var proc in Process.GetProcesses())
            {
                try
                {
                    if (IsZoomProcess(proc.ProcessName))
                    {
                        proc.Dispose();
                        return true;
                    }
                    proc.Dispose();
                }
                catch { }
            }
        }
        catch { }
        return false;
    }

    private static bool IsZoomProcess(string processName)
    {
        return ZoomProcessNames.Any(z =>
            processName.Contains(z, StringComparison.OrdinalIgnoreCase));
    }
}
