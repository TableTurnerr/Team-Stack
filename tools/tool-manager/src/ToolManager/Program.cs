using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using ToolManager.Models;
using ToolManager.Services;
using ToolManager.UI;

namespace ToolManager;

static class Program
{
    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    private const int SW_HIDE = 0;
    private const int SW_SHOW = 5;

    [STAThread]
    static async Task Main(string[] args)
    {
        bool isInteractive = args.Contains("--interactive");
        bool isBackground = args.Contains("--background");

        // Single instance only for the tray/background process, not for interactive CLI sessions
        Mutex? mutex = null;
        if (!isInteractive)
        {
            mutex = new Mutex(true, @"Global\TableTurnerr_ToolManager", out bool createdNew);
            if (!createdNew)
            {
                // If tray is running and user double-clicks the exe, open interactive CLI
                LaunchInteractive();
                return;
            }
        }
        using var _ = mutex;

        EnsureAutoStart();

        // Create services
        var registry = new InstalledToolsRegistry();
        var github = new GitHubReleaseService(registry);
        var downloadService = new DownloadService();
        var installer = new InstallService(registry, downloadService);
        var scheduler = new UpdateScheduler(github, installer, registry);
        var selfUpdater = new SelfUpdateService(github, downloadService);

        // ── Interactive CLI mode ──────────────────────────────
        if (isInteractive)
        {
            var cli = new CliApp(github, installer, registry, scheduler, selfUpdater);
            await cli.RunAsync();
            return;
        }

        // ── Background mode: single check + exit ─────────────
        if (isBackground)
        {
            Debug.WriteLine("[Main] Running background update check...");
            try
            {
                await scheduler.CheckAndUpdateInstalled();
                await selfUpdater.CheckNow();
                if (selfUpdater.UpdateAvailable)
                    await selfUpdater.ApplyUpdate();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Background] Error: {ex.Message}");
            }
            return;
        }

        // ── Tray mode (default): hide console, show tray icon ─
        HideConsole();

        scheduler.Start();
        selfUpdater.Start();
        Debug.WriteLine("[Main] Services started (tray mode)");

        Application.EnableVisualStyles();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);

        using var tray = new TrayIconManager(scheduler, selfUpdater);
        Application.Run();

        // Cleanup
        selfUpdater.Dispose();
        scheduler.Dispose();
        Debug.WriteLine("[Main] Exiting");
    }

    /// <summary>
    /// Launch an interactive CLI session in a new console window.
    /// </summary>
    internal static void LaunchInteractive()
    {
        var exePath = Environment.ProcessPath;
        if (exePath == null) return;

        Process.Start(new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c \"\"{exePath}\" --interactive\"",
            UseShellExecute = true,
        });
    }

    private static void HideConsole()
    {
        var hwnd = GetConsoleWindow();
        if (hwnd != IntPtr.Zero)
            ShowWindow(hwnd, SW_HIDE);
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
