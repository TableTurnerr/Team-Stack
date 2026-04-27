using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using ToolManager.Services;

namespace ToolManager.UI;

/// <summary>
/// System tray icon that keeps the Tool Manager running in the background.
/// "Open Manager" launches an interactive CLI session in a new console window.
/// </summary>
public class TrayIconManager : IDisposable
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool DestroyIcon(IntPtr handle);

    private readonly NotifyIcon _trayIcon;
    private readonly UpdateScheduler _scheduler;
    private readonly SelfUpdateService _selfUpdater;
    private readonly SynchronizationContext? _uiContext;
    private DateTime _lastLaunch = DateTime.MinValue;

    public TrayIconManager(UpdateScheduler scheduler, SelfUpdateService selfUpdater)
    {
        _scheduler = scheduler;
        _selfUpdater = selfUpdater;
        // Captured here so background-thread events can marshal NotifyIcon updates
        // back to the UI thread that owns the tray icon's hidden window.
        _uiContext = SynchronizationContext.Current;

        _trayIcon = new NotifyIcon
        {
            Text = "TableTurnerr Tool Manager",
            Visible = true,
            ContextMenuStrip = BuildContextMenu(),
        };

        // Load tray icon from embedded PNG (transparent background, looks best in tray)
        try
        {
            using var pngStream = typeof(TrayIconManager).Assembly
                .GetManifestResourceStream("ToolManager.icon.png");
            if (pngStream != null)
            {
                using var bmp = new Bitmap(pngStream);
                var hIcon = bmp.GetHicon();
                _trayIcon.Icon = Icon.FromHandle(hIcon);
            }
        }
        catch
        {
            _trayIcon.Icon = SystemIcons.Application;
        }

        // Single left-click tray icon → open CLI (with debounce to prevent double-launch)
        _trayIcon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left && (DateTime.UtcNow - _lastLaunch).TotalSeconds > 1)
            {
                _lastLaunch = DateTime.UtcNow;
                Program.LaunchInteractive();
            }
        };

        // Subscribe to update events for balloon notifications
        _scheduler.UpdatingTools += names =>
        {
            ShowBalloon("Updating Tools", string.Join(", ", names), ToolTipIcon.Info);
        };
        _scheduler.UpdatesApplied += results =>
        {
            var summary = string.Join("\n", results.Select(r =>
                r.success ? $"{r.name} → v{r.version}" : $"{r.name}: failed"));
            ShowBalloon("Updates Applied", summary, ToolTipIcon.Info);
        };
        _selfUpdater.UpdateFound += version =>
        {
            ShowBalloon("Manager Update Available",
                $"Tool Manager v{version.ToString(3)} is available.", ToolTipIcon.Info);
        };
    }

    private ContextMenuStrip BuildContextMenu()
    {
        var menu = new ContextMenuStrip();

        var openItem = new ToolStripMenuItem("Open Manager");
        openItem.Font = new Font(openItem.Font, FontStyle.Bold);
        openItem.Click += (_, _) => Program.LaunchInteractive();
        menu.Items.Add(openItem);

        menu.Items.Add(new ToolStripSeparator());

        var checkItem = new ToolStripMenuItem("Check for Updates");
        checkItem.Click += async (_, _) =>
        {
            try
            {
                await _scheduler.CheckAndUpdateInstalled();
                await _selfUpdater.CheckNow();
                ShowBalloon("Check Complete", "All tools checked.", ToolTipIcon.Info);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Tray] Check failed: {ex.Message}");
            }
        };
        menu.Items.Add(checkItem);

        menu.Items.Add(new ToolStripSeparator());

        var exitItem = new ToolStripMenuItem("Exit");
        exitItem.Click += (_, _) =>
        {
            _trayIcon.Visible = false;
            Application.Exit();
        };
        menu.Items.Add(exitItem);

        return menu;
    }

    private void ShowBalloon(string title, string text, ToolTipIcon icon)
    {
        void Show()
        {
            try
            {
                _trayIcon.BalloonTipTitle = title;
                _trayIcon.BalloonTipText = text;
                _trayIcon.BalloonTipIcon = icon;
                _trayIcon.ShowBalloonTip(5000);
            }
            catch { }
        }

        if (_uiContext != null)
            _uiContext.Post(_ => Show(), null);
        else
            Show();
    }

    public void Dispose()
    {
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
    }
}
