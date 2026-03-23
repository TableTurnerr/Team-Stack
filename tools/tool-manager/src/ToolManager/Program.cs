using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using ToolManager.Models;
using ToolManager.Services;
using ToolManager.UI;

namespace ToolManager;

static class Program
{
    [DllImport("kernel32.dll")]
    private static extern bool AllocConsole();

    [DllImport("kernel32.dll")]
    private static extern bool FreeConsole();

    [DllImport("kernel32.dll")]
    private static extern bool SetConsoleOutputCP(uint codepage);

    [DllImport("kernel32.dll")]
    private static extern bool SetConsoleCP(uint codepage);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    private const uint CP_UTF8 = 65001;
    private const uint WM_SETICON = 0x0080;
    private static readonly IntPtr ICON_SMALL = IntPtr.Zero;
    private static readonly IntPtr ICON_BIG = new(1);

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

        // Create services
        var settingsService = new SettingsService();
        settingsService.ApplyAutoStart(settingsService.Settings.AutoStartEnabled);

        var registry = new InstalledToolsRegistry();
        var github = new GitHubReleaseService(registry);
        var downloadService = new DownloadService();
        var installer = new InstallService(registry, downloadService);
        var scheduler = new UpdateScheduler(github, installer, registry, settingsService);
        var selfUpdater = new SelfUpdateService(github, downloadService);

        // ── Interactive CLI mode ──────────────────────────────
        if (isInteractive)
        {
            // WinExe has no console — allocate one for the CLI
            AllocConsole();
            SetConsoleOutputCP(CP_UTF8);
            SetConsoleCP(CP_UTF8);
            Console.OutputEncoding = System.Text.Encoding.UTF8;
            Console.InputEncoding = System.Text.Encoding.UTF8;
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true });
            Console.SetIn(new StreamReader(Console.OpenStandardInput()));
            Console.SetError(new StreamWriter(Console.OpenStandardError()) { AutoFlush = true });
            Console.Title = "TableTurnerr Tool Manager";
            SetConsoleWindowIcon();

            var cli = new CliApp(github, installer, registry, scheduler, selfUpdater, settingsService);
            await cli.RunAsync();

            FreeConsole();
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

        // ── Tray mode (default): no console, just tray icon ──
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
    /// Set the console window icon to the embedded TableTurnerr logo.
    /// </summary>
    private static void SetConsoleWindowIcon()
    {
        try
        {
            var hwnd = GetConsoleWindow();
            if (hwnd == IntPtr.Zero) return;

            var stream = typeof(Program).Assembly
                .GetManifestResourceStream("ToolManager.app.ico");
            if (stream == null) return;

            var icon = new Icon(stream);
            SendMessage(hwnd, WM_SETICON, ICON_SMALL, icon.Handle);
            SendMessage(hwnd, WM_SETICON, ICON_BIG, icon.Handle);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Main] Failed to set console icon: {ex.Message}");
        }
    }

    /// <summary>
    /// Launch an interactive CLI session in a new process with its own console.
    /// Uses cmd.exe to avoid SmartScreen/UAC prompts on unsigned executables.
    /// </summary>
    internal static void LaunchInteractive()
    {
        var exePath = Environment.ProcessPath;
        if (exePath == null) return;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"\"{exePath}\" --interactive\"",
                UseShellExecute = false,
                CreateNoWindow = false,
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Main] Failed to launch interactive CLI: {ex.Message}");
        }
    }
}
