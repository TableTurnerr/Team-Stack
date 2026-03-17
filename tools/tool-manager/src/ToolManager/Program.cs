using System.Diagnostics;
using Microsoft.Win32;
using ToolManager.Models;
using ToolManager.Services;
using ToolManager.UI;

namespace ToolManager;

static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        // Single instance enforcement
        using var mutex = new Mutex(true, @"Global\TableTurnerr_ToolManager", out bool createdNew);
        if (!createdNew) return;

        Application.EnableVisualStyles();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);
        Application.SetCompatibleTextRenderingDefault(false);

        EnsureAutoStart();

        // Create services
        var registry = new InstalledToolsRegistry();
        var github = new GitHubReleaseService(registry);
        var downloadService = new DownloadService();
        var installer = new InstallService(registry, downloadService);
        var scheduler = new UpdateScheduler(github, installer, registry);
        var selfUpdater = new SelfUpdateService(github, downloadService);

        // Start background services
        scheduler.Start();
        selfUpdater.Start();
        Debug.WriteLine("[Main] Services started");

        // Create UI
        var mainForm = new MainForm(github, installer, registry, scheduler, selfUpdater);
        using var trayManager = new TrayIconManager(mainForm, scheduler, selfUpdater);

        // First launch (no tools installed yet): always show the window so user
        // can pick which tools to install. Subsequent boots with --background stay in tray.
        bool startMinimized = args.Contains("--background") && registry.Tools.Count > 0;
        if (!startMinimized)
            mainForm.Show();

        Application.Run();

        // Cleanup
        selfUpdater.Dispose();
        scheduler.Dispose();
        Debug.WriteLine("[Main] Exiting");
    }

    private static void EnsureAutoStart()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", true);

            var exePath = Environment.ProcessPath;
            if (key == null || exePath == null) return;

            var desired = $"\"{exePath}\" --background";
            var existing = key.GetValue("ToolManager") as string;

            if (string.Equals(existing, desired, StringComparison.OrdinalIgnoreCase)) return;

            key.SetValue("ToolManager", desired);
            Debug.WriteLine("[Main] Registered auto-start");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Main] Auto-start registration failed: {ex.Message}");
        }
    }
}
