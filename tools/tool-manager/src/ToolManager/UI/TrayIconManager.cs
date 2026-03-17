using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using ToolManager.Services;

namespace ToolManager.UI;

public class TrayIconManager : IDisposable
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private readonly NotifyIcon _notifyIcon;
    private readonly MainForm _mainForm;
    private readonly UpdateScheduler _scheduler;
    private readonly SelfUpdateService _selfUpdater;

    public TrayIconManager(MainForm mainForm, UpdateScheduler scheduler, SelfUpdateService selfUpdater)
    {
        _mainForm = mainForm;
        _scheduler = scheduler;
        _selfUpdater = selfUpdater;

        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        var versionText = version != null ? $"v{version.Major}.{version.Minor}.{version.Build}" : "";

        var contextMenu = new ContextMenuStrip();
        contextMenu.Items.Add(new ToolStripMenuItem($"Tool Manager {versionText}")
        {
            Enabled = false,
            Font = new Font(contextMenu.Font, FontStyle.Bold)
        });
        contextMenu.Items.Add(new ToolStripSeparator());
        contextMenu.Items.Add("Open Manager", null, (_, _) => ShowMainForm());
        contextMenu.Items.Add("Check for Updates", null, async (_, _) =>
        {
            await _scheduler.CheckAndUpdateInstalled();
        });
        contextMenu.Items.Add(new ToolStripSeparator());
        contextMenu.Items.Add("Exit", null, (_, _) =>
        {
            _notifyIcon.Visible = false;
            Application.Exit();
        });

        _notifyIcon = new NotifyIcon
        {
            Icon = CreateTrayIcon(),
            Text = $"TableTurnerr Tool Manager {versionText}",
            ContextMenuStrip = contextMenu,
            Visible = true,
        };

        _notifyIcon.DoubleClick += (_, _) => ShowMainForm();

        // Notification: about to update
        _scheduler.UpdatingTools += names =>
        {
            try
            {
                var list = string.Join(", ", names);
                _notifyIcon.ShowBalloonTip(3000, "TableTurnerr Tools",
                    $"Updating: {list}...",
                    ToolTipIcon.Info);
            }
            catch { }
        };

        // Notification: update results
        _scheduler.UpdatesApplied += results =>
        {
            try
            {
                var succeeded = results.Where(r => r.success).ToList();
                var failed = results.Where(r => !r.success).ToList();

                if (succeeded.Count == 0 && failed.Count == 0) return;

                var lines = new List<string>();
                foreach (var r in succeeded)
                    lines.Add($"{r.name} v{r.version} - Updated");
                foreach (var r in failed)
                    lines.Add($"{r.name} - Failed");

                _notifyIcon.ShowBalloonTip(5000, "TableTurnerr Tools",
                    string.Join("\n", lines),
                    failed.Count > 0 ? ToolTipIcon.Warning : ToolTipIcon.Info);
            }
            catch { }
        };

        // Self-update: apply automatically
        _selfUpdater.UpdateFound += ver =>
        {
            try
            {
                _notifyIcon.ShowBalloonTip(3000, "Tool Manager",
                    $"Updating Tool Manager to v{ver.ToString(3)}...",
                    ToolTipIcon.Info);
                _ = _selfUpdater.ApplyUpdate();
            }
            catch { }
        };
    }

    private void ShowMainForm()
    {
        _mainForm.Show();
        _mainForm.BringToFront();
        if (_mainForm.WindowState == FormWindowState.Minimized)
            _mainForm.WindowState = FormWindowState.Normal;
    }

    private static Icon CreateTrayIcon()
    {
        using var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);

            using var brush = new SolidBrush(Color.FromArgb(26, 115, 232));
            g.FillEllipse(brush, 1, 1, 14, 14);

            using var font = new Font("Segoe UI", 8f, FontStyle.Bold);
            using var textBrush = new SolidBrush(Color.White);
            var size = g.MeasureString("T", font);
            g.DrawString("T", font, textBrush, (16 - size.Width) / 2, (16 - size.Height) / 2);
        }

        var hIcon = bmp.GetHicon();
        var icon = (Icon)Icon.FromHandle(hIcon).Clone();
        DestroyIcon(hIcon);
        return icon;
    }

    public void Dispose()
    {
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
