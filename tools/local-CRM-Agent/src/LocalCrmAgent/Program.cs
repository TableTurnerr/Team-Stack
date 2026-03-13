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
        var wsServer = new AgentWebSocketServer(fusion, networkMonitor, audioMonitor);
        var agent = new AgentService(fusion, wsServer, networkMonitor, audioMonitor);

        // ── Start agent ────────────────────────────────────────────
        agent.Start();
        Debug.WriteLine("[Main] Agent started, entering message loop...");

        // ── Create tray icon (must be on STA/UI thread) ────────────
        using var trayManager = new TrayIconManager(agent, fusion, audioMonitor);

        // ── Run WinForms message loop (blocks until Exit) ──────────
        Application.Run();

        // ── Cleanup ────────────────────────────────────────────────
        agent.Stop();
        networkMonitor.Dispose();
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

            // Only register if not already registered
            var existing = key.GetValue("LocalCrmAgent") as string;
            if (existing != null && existing.Contains("LocalCrmAgent")) return;

            key.SetValue("LocalCrmAgent", $"\"{exePath}\" --background");
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
