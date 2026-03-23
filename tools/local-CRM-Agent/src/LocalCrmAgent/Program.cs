using System.Diagnostics;
using LocalCrmAgent.Services;
using LocalCrmAgent.UI;
using Microsoft.Win32;

namespace LocalCrmAgent;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // ── Single instance enforcement ────────────────────────────
        using var mutex = new Mutex(true, @"Global\LocalCrmAgent_SingleInstance", out bool createdNew);
        if (!createdNew)
        {
            // Already running — exit silently
            return;
        }

        Application.EnableVisualStyles();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.SetCompatibleTextRenderingDefault(false);

        // ── Auto-start registration ────────────────────────────────
        EnsureAutoStart();
        RegisterProtocolHandler();

        // ── Create services ────────────────────────────────────────
        var audioMonitor = new ZoomAudioMonitor();
        var windowMonitor = new ZoomWindowMonitor();
        var networkMonitor = new NetworkMonitor();
        var fusion = new CallStateFusion(audioMonitor, windowMonitor);
        var micManager = new MicrophoneManager(fusion);
        var storageManager = new RecordingStorageManager();
        var recorder = new AudioRecorderService(storageManager, fusion, micManager);
        var uploader = new RecordingUploadService(storageManager);
        var zoomSuppressor = new ZoomWindowSuppressor();
        var wsServer = new AgentWebSocketServer(fusion, networkMonitor, audioMonitor);
        wsServer.SetRecordingServices(recorder, uploader, storageManager);
        wsServer.SetMicrophoneManager(micManager);
        wsServer.SetZoomSuppressor(zoomSuppressor);
        var agent = new AgentService(fusion, wsServer, networkMonitor, audioMonitor, recorder, uploader, micManager);
        var autoUpdater = new AutoUpdateService();

        // ── Start agent ────────────────────────────────────────────
        agent.Start();
        zoomSuppressor.Start();
        autoUpdater.Start();
        Debug.WriteLine("[Main] Agent started, entering message loop...");

        // ── Create tray icon (must be on STA/UI thread) ────────────
        using var trayManager = new TrayIconManager(agent, fusion, audioMonitor, autoUpdater, recorder, storageManager, micManager, zoomSuppressor);

        // ── Run WinForms message loop (blocks until Exit) ──────────
        Application.Run();

        // ── Cleanup ────────────────────────────────────────────────
        autoUpdater.Dispose();
        agent.Stop();
        zoomSuppressor.Dispose();
        networkMonitor.Dispose();
        micManager.Dispose();
        Debug.WriteLine("[Main] Agent stopped, exiting.");
    }

    /// <summary>
    /// Register the agent to auto-start when the user logs into Windows.
    /// </summary>
    private static void EnsureAutoStart()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", true);

            var exePath = Environment.ProcessPath;
            if (key == null || exePath == null) return;

            var desired = $"\"{exePath}\" --background";
            var existing = key.GetValue("LocalCrmAgent") as string;

            // Update if not registered or if the exe path has changed (e.g. dev vs release build)
            if (string.Equals(existing, desired, StringComparison.OrdinalIgnoreCase)) return;

            key.SetValue("LocalCrmAgent", desired);
            Debug.WriteLine("[Main] Registered auto-start");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Main] Auto-start registration failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Register the crm-agent:// protocol handler so the CRM dashboard
    /// can launch the agent from the browser.
    /// </summary>
    private static void RegisterProtocolHandler()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            if (exePath == null) return;

            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\crm-agent");
            key.SetValue("", "URL:CRM Agent Protocol");
            key.SetValue("URL Protocol", "");

            using var iconKey = key.CreateSubKey(@"DefaultIcon");
            iconKey.SetValue("", $"\"{exePath}\",0");

            using var cmdKey = key.CreateSubKey(@"shell\open\command");
            cmdKey.SetValue("", $"\"{exePath}\" \"%1\"");

            Debug.WriteLine("[Main] Registered crm-agent:// protocol handler");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Main] Protocol handler registration failed: {ex.Message}");
        }
    }
}
