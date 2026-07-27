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

        // Diagnostics file (Release: Debug.WriteLine is inert; new code uses FileLogger.Write).
        FileLogger.Init(Path.Combine(Models.InstalledToolsRegistry.BaseDir, "diagnostic.log"));

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

        // Run one-time migrations (safe to run repeatedly)
        if (!isInteractive)
            RunMigrations();

        // Create services
        var settingsService = new SettingsService();
        settingsService.ApplyAutoStart(settingsService.Settings.AutoStartEnabled);

        var registry = new InstalledToolsRegistry();
        var github = new GitHubReleaseService(registry);
        var downloadService = new DownloadService();
        var installer = new InstallService(registry, downloadService);
        var scheduler = new UpdateScheduler(github, installer, registry, settingsService);
        var selfUpdater = new SelfUpdateService(github, downloadService, settingsService);

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
        var startupWatchdog = new StartupWatchdog(settingsService);
        scheduler.Start();
        selfUpdater.Start();
        startupWatchdog.Start();
        Debug.WriteLine("[Main] Services started (tray mode)");

        Application.EnableVisualStyles();
        Application.SetHighDpiMode(HighDpiMode.SystemAware);

        // Install the WinForms SynchronizationContext on the main thread so the
        // tray manager can marshal background-thread events to the UI thread.
        if (SynchronizationContext.Current is not WindowsFormsSynchronizationContext)
            SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());

        using var tray = new TrayIconManager(scheduler, selfUpdater, github,
            new AgentProvisioningService(registry));
        Application.Run();

        // Cleanup
        startupWatchdog.Dispose();
        selfUpdater.Dispose();
        scheduler.Dispose();
        github.Dispose();
        downloadService.Dispose();
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
    /// Run idempotent migrations so that updates (which only swap the exe) also
    /// apply changes to shortcuts, registry entries, etc.
    /// </summary>
    private static void RunMigrations()
    {
        try
        {
            var startMenu = Environment.GetFolderPath(Environment.SpecialFolder.StartMenu);
            var shortcutDir = Path.Combine(startMenu, "Programs", "TableTurnerr");
            var oldShortcut = Path.Combine(shortcutDir, "Tool Manager.lnk");
            var newShortcut = Path.Combine(shortcutDir, "TableTurnerr Tool Manager.lnk");

            // Also check the roaming AppData path used by install.bat
            var roamingDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                @"Microsoft\Windows\Start Menu\Programs\TableTurnerr");
            var oldRoaming = Path.Combine(roamingDir, "Tool Manager.lnk");
            var newRoaming = Path.Combine(roamingDir, "TableTurnerr Tool Manager.lnk");

            // Migrate whichever location has the old shortcut
            MigrateShortcut(oldShortcut, newShortcut, shortcutDir);
            MigrateShortcut(oldRoaming, newRoaming, roamingDir);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Migration] Shortcut migration failed: {ex.Message}");
        }
    }

    private static void MigrateShortcut(string oldPath, string newPath, string shortcutDir)
    {
        // If new shortcut already exists, just clean up the old one
        if (File.Exists(newPath))
        {
            if (File.Exists(oldPath))
            {
                try { File.Delete(oldPath); } catch { }
                Debug.WriteLine("[Migration] Deleted old shortcut (new already exists).");
            }
            return;
        }

        // If old shortcut exists, create the new one and delete the old
        if (File.Exists(oldPath))
        {
            var exePath = Environment.ProcessPath;
            if (exePath == null) return;

            var installDir = Path.GetDirectoryName(exePath) ?? "";
            Directory.CreateDirectory(shortcutDir);

            try
            {
                using var ps = Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -Command \"$ws = New-Object -ComObject WScript.Shell; " +
                        $"$s = $ws.CreateShortcut('{newPath.Replace("'", "''")}'); " +
                        $"$s.TargetPath = '{exePath.Replace("'", "''")}'; " +
                        $"$s.IconLocation = '{exePath.Replace("'", "''")},0'; " +
                        $"$s.Description = 'TableTurnerr Tool Manager - Manage and update TableTurnerr team tools'; " +
                        $"$s.WorkingDirectory = '{installDir.Replace("'", "''")}'; " +
                        $"$s.Save()\"",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
                ps?.WaitForExit(5000);

                File.Delete(oldPath);
                Debug.WriteLine("[Migration] Renamed Start Menu shortcut to 'TableTurnerr Tool Manager'.");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Migration] Shortcut rename failed: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Launch an interactive CLI session in a new process with its own console.
    /// The process is a WinExe so it starts without a console; AllocConsole() in
    /// interactive mode creates exactly one console window.
    /// </summary>
    internal static void LaunchInteractive()
    {
        var exePath = Environment.ProcessPath;
        if (exePath == null) return;

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                Arguments = "--interactive",
                UseShellExecute = false,
                CreateNoWindow = true,
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Main] Failed to launch interactive CLI: {ex.Message}");
        }
    }
}
