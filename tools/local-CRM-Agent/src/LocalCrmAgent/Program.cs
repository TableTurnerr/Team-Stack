using System.Diagnostics;
using LocalCrmAgent.Services;
using LocalCrmAgent.UI;

namespace LocalCrmAgent;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Chrome launched us as a Native Messaging host (the Lead Scraper
        // extension detected a Zoom web-phone call). Run the thin stdio relay
        // that forwards START/STOP to the already-running tray agent, then exit.
        // This must come before the single-instance gate and any UI/service
        // startup — this process is not the tray app.
        if (NativeMessagingHost.IsNativeMessagingLaunch(args))
        {
            NativeMessagingHost.Run();
            return;
        }

        var diagDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "CrmAgent");
        FileLogger.Init(Path.Combine(diagDir, "diagnostic.log"));

        // Self-heal the Run key + protocol handler + native messaging host on
        // every launch, *before* the single-instance gate. Running the exe a
        // second time is the user's natural way to repair a broken install
        // (e.g. after the Run entry was removed by a cleanup utility), so this
        // must work even when another instance already holds the mutex.
        StartupRegistrar.EnsureAutoStart();
        StartupRegistrar.EnsureProtocolHandler();
        StartupRegistrar.EnsureNativeMessagingHost();

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
        var recorder = new AudioRecorderService(storageManager, fusion, micManager, intentTracker, audioMonitor);
        var uploader = new RecordingUploadService(storageManager);
        var zoomSuppressor = new ZoomWindowSuppressor();
        var zoomApi = new ZoomPhoneApiService();
        var callController = new ZoomCallController(zoomSuppressor, windowMonitor);
        callController.SetApiService(zoomApi);
        // Let the uploader resolve the real Zoom call_id + number from call_history
        // (device-IP match) so recordings correlate to the right call exactly.
        uploader.SetZoomApi(zoomApi);
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

        // Restore the GHL worker upload target. Prefer persisted config; fall
        // back to environment variables so a fresh install can be provisioned
        // without the dashboard (no secrets are hardcoded in the binary).
        var workerUrl = !string.IsNullOrEmpty(config.WorkerBaseUrl)
            ? config.WorkerBaseUrl
            : Environment.GetEnvironmentVariable("CRM_AGENT_WORKER_URL");
        var agentToken = config.GetUnprotectedAgentToken()
            ?? Environment.GetEnvironmentVariable("CRM_AGENT_TOKEN");
        // repKey = the rep's GoHighLevel user id (device-provisioned). Accept the
        // new CRM_AGENT_REP_KEY name, falling back to the legacy var.
        var repUserId = !string.IsNullOrEmpty(config.RepUserId)
            ? config.RepUserId
            : (Environment.GetEnvironmentVariable("CRM_AGENT_REP_KEY")
               ?? Environment.GetEnvironmentVariable("CRM_AGENT_REP_USER_ID"));
        if (!string.IsNullOrEmpty(workerUrl) && !string.IsNullOrEmpty(agentToken))
        {
            uploader.SetWorkerConfig(workerUrl, agentToken, repUserId);
            // Persist env-provisioned values so later launches don't depend on
            // the env being set, and so the token is stored DPAPI-encrypted.
            if (string.IsNullOrEmpty(config.WorkerBaseUrl) || string.IsNullOrEmpty(config.AgentTokenProtected))
            {
                config.SetWorkerConfig(workerUrl, agentToken, repUserId);
                config.Save();
            }
        }
        wsServer.SetAgentConfig(config);
        // If a token existed but DPAPI couldn't decrypt it (e.g. profile
        // changed), surface the failure so the dashboard prompts re-auth
        // instead of silently dropping uploads.
        if (config.AuthDecryptionFailed)
        {
            FileLogger.Write("[Main] Saved auth token failed to decrypt — broadcasting auth_required");
            wsServer.SetAuthRequired("decryption_failed");
        }

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
