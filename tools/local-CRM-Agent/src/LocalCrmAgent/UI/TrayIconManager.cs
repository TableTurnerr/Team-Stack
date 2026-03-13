using System.Drawing;
using System.Drawing.Drawing2D;
using LocalCrmAgent.Models;
using LocalCrmAgent.Services;

namespace LocalCrmAgent.UI;

/// <summary>
/// System tray icon with status indicator and context menu.
/// </summary>
public class TrayIconManager : IDisposable
{
    private readonly NotifyIcon _notifyIcon;
    private readonly AgentService _agent;
    private readonly CallStateFusion _fusion;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _connectionsItem;
    private readonly ToolStripMenuItem _zoomItem;
    private readonly System.Windows.Forms.Timer _updateTimer;

    public TrayIconManager(AgentService agent, CallStateFusion fusion)
    {
        _agent = agent;
        _fusion = fusion;

        _statusItem = new ToolStripMenuItem("Call: Idle") { Enabled = false };
        _connectionsItem = new ToolStripMenuItem("CRM Clients: 0") { Enabled = false };
        _zoomItem = new ToolStripMenuItem("Zoom: Checking...") { Enabled = false };

        var contextMenu = new ContextMenuStrip();
        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        var versionLabel = version != null ? $"CRM Agent v{version.Major}.{version.Minor}.{version.Build}" : "CRM Agent";
        contextMenu.Items.Add(new ToolStripMenuItem(versionLabel) { Enabled = false, Font = new Font(contextMenu.Font, FontStyle.Bold) });
        contextMenu.Items.Add(new ToolStripSeparator());
        contextMenu.Items.Add(_statusItem);
        contextMenu.Items.Add(_connectionsItem);
        contextMenu.Items.Add(_zoomItem);
        contextMenu.Items.Add(new ToolStripSeparator());
        contextMenu.Items.Add("Exit", null, (_, _) =>
        {
            _notifyIcon.Visible = false;
            Application.Exit();
        });

        _notifyIcon = new NotifyIcon
        {
            Icon = CreateDotIcon(Color.Gray),
            Text = "CRM Agent — Idle",
            ContextMenuStrip = contextMenu,
            Visible = true,
        };

        _notifyIcon.DoubleClick += (_, _) =>
        {
            // Show a balloon tip with current status
            var state = _fusion.CurrentState;
            _notifyIcon.ShowBalloonTip(
                3000,
                "CRM Agent",
                $"Status: {state.State}\nClients: {_agent.ConnectionCount}",
                ToolTipIcon.Info);
        };

        // Wire events
        _fusion.StateChanged += OnStateChanged;
        _agent.ConnectionCountChanged += OnConnectionCountChanged;

        // Periodic UI refresh (every 2s for zoom detection status)
        _updateTimer = new System.Windows.Forms.Timer { Interval = 2000 };
        _updateTimer.Tick += (_, _) => RefreshStatus();
        _updateTimer.Start();
    }

    private void OnStateChanged(CallStateInfo info)
    {
        // Guard against updates after dispose
        try { _ = _notifyIcon.Visible; } catch { return; }

        try
        {
            var (color, text) = info.State switch
            {
                CallState.Ringing => (Color.Gold, "Ringing"),
                CallState.Connected => (Color.LimeGreen, $"Connected ({info.DurationSeconds}s)"),
                CallState.Ended => (Color.DodgerBlue, "Ended"),
                _ => (Color.Gray, "Idle"),
            };

            _notifyIcon.Icon = CreateDotIcon(color);
            _notifyIcon.Text = $"CRM Agent — {text}";
            _statusItem.Text = $"Call: {text}";

            // Show notification on state transitions
            if (info.State == CallState.Connected)
            {
                _notifyIcon.ShowBalloonTip(2000, "CRM Agent",
                    $"Call connected{(info.PhoneNumber != null ? $": {info.PhoneNumber}" : "")}",
                    ToolTipIcon.Info);
            }
        }
        catch { /* UI may be disposed during shutdown */ }
    }

    private void OnConnectionCountChanged(int count)
    {
        try
        {
            _connectionsItem.Text = $"CRM Clients: {count}";
        }
        catch { }
    }

    private void RefreshStatus()
    {
        try
        {
            var state = _fusion.CurrentState;
            if (state.State == CallState.Connected)
            {
                _statusItem.Text = $"Call: Connected ({state.DurationSeconds}s)";
            }

            // Update zoom detection indicator
            // (done in timer to avoid constant process scanning)
            var zoomRunning = _agent.IsRunning;
            _zoomItem.Text = zoomRunning ? "Zoom: Detected" : "Zoom: Not found";
        }
        catch { }
    }

    private static Icon CreateDotIcon(Color color)
    {
        var bmp = new Bitmap(16, 16);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var brush = new SolidBrush(color);
            g.FillEllipse(brush, 2, 2, 12, 12);
            using var pen = new Pen(Color.FromArgb(180, 255, 255, 255), 1f);
            g.DrawEllipse(pen, 2, 2, 12, 12);
        }
        var hIcon = bmp.GetHicon();
        var icon = Icon.FromHandle(hIcon);
        return icon;
    }

    public void Dispose()
    {
        _updateTimer.Stop();
        _updateTimer.Dispose();
        _fusion.StateChanged -= OnStateChanged;
        _agent.ConnectionCountChanged -= OnConnectionCountChanged;
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
