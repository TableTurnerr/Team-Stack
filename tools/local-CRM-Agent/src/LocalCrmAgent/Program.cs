using System.Diagnostics;
using LocalCrmAgent.Services;
using LocalCrmAgent.UI;

namespace LocalCrmAgent;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Self-heal the Run key + protocol handler on every launch, *before*
        // the single-instance gate. Running the exe a second time is the
        // user's natural way to repair a broken install (e.g. after the Run
        // entry was removed by a cleanup utility), so this must work even
        // when another instance already holds the mutex.
        StartupRegistrar.EnsureAutoStart();
        StartupRegistrar.EnsureProtocolHandler();

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

        // ── Create services ────────────────────────────────────────
        var audioMonitor = new ZoomAudioMonitor();
        var windowMonitor = new ZoomWindowMonitor();
        var networkMonitor = new NetworkMonitor();
        var uiWatcher = new ZoomUiWatcher();
        var intentTracker = new DialIntentTracker();
        var fusion = new CallStateFusion(audioMonitor, windowMonitor, uiWatcher, intentTracker);
        var micManager = new MicrophoneManager(fusion);
        var storageManager = new RecordingStorageManager();
        var recorder = new AudioRecorderService(storageManager, fusion, micManager, intentTracker);
        var uploader = new RecordingUploadService(storageManager);
        var zoomSuppressor = new ZoomWindowSuppressor();
        var zoomApi = new ZoomPhoneApiService();
        var callController = new ZoomCallController(zoomSuppressor, windowMonitor);
        callController.SetApiService(zoomApi);
        var wsServer = new AgentWebSocketServer(fusion, networkMonitor, audioMonitor);
        wsServer.SetDialIntentTracker(intentTracker);
        wsServer.SetRecordingServices(recorder, uploader, storageManager);
        wsServer.SetMicrophoneManager(micManager);
        wsServer.SetZoomSuppressor(zoomSuppressor);
        wsServer.SetCallController(callController);
        wsServer.SetZoomApi(zoomApi);
        var agent = new AgentService(fusion, wsServer, networkMonitor, audioMonitor, recorder, uploader, micManager);
        var autoUpdater = new AutoUpdateService();
        var startupWatchdog = new StartupWatchdog();

        // ── Load persisted config and apply ────────────────────────
        var config = AgentConfig.Load();
        recorder.AutoRecordEnabled = config.AutoRecordEnabled;
        recorder.RecordOnRinging = config.RecordOnRinging;

        var savedToken = config.GetUnprotectedAuthToken();
        if (!string.IsNullOrEmpty(config.LastPocketbaseUrl) && !string.IsNullOrEmpty(savedToken) && !string.IsNullOrEmpty(config.LastUploaderId))
        {
            uploader.SetAuth(config.LastPocketbaseUrl, savedToken, config.LastUploaderId);
        }
        wsServer.SetAgentConfig(config);

        // ── Start agent ────────────────────────────────────────────
        agent.Start();
        zoomSuppressor.Start();
        autoUpdater.Start();
        startupWatchdog.Start();
        Debug.WriteLine("[Main] Agent started, entering message loop...");

        // ── Create tray icon (must be on STA/UI thread) ────────────
        using var trayManager = new TrayIconManager(agent, fusion, audioMonitor, autoUpdater, recorder, storageManager, micManager, zoomSuppressor);

        // ── Run WinForms message loop (blocks until Exit) ──────────
        Application.Run();

        // ── Cleanup ────────────────────────────────────────────────
        startupWatchdog.Dispose();
        autoUpdater.Dispose();
        agent.Stop();
        zoomSuppressor.Dispose();
        networkMonitor.Dispose();
        micManager.Dispose();
        Debug.WriteLine("[Main] Agent stopped, exiting.");
    }
}
