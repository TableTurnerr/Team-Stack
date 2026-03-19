using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using LocalCrmAgent.Models;
using LocalCrmAgent.Services;

namespace LocalCrmAgent.UI;

/// <summary>
/// System tray icon with status indicator and context menu.
/// </summary>
public class TrayIconManager : IDisposable
{
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    private readonly NotifyIcon _notifyIcon;
    private readonly AgentService _agent;
    private readonly CallStateFusion _fusion;
    private readonly ZoomAudioMonitor _audioMonitor;
    private readonly AudioRecorderService? _recorder;
    private readonly RecordingStorageManager? _storage;
    private readonly ToolStripMenuItem _statusItem;
    private readonly ToolStripMenuItem _connectionsItem;
    private readonly ToolStripMenuItem _zoomItem;
    private readonly ToolStripMenuItem _recordingItem;
    private readonly ToolStripMenuItem _uploadItem;
    private readonly System.Windows.Forms.Timer _updateTimer;
    private readonly AutoUpdateService _autoUpdater;
    private readonly ToolStripMenuItem _updateItem;

    public TrayIconManager(AgentService agent, CallStateFusion fusion, ZoomAudioMonitor audioMonitor, AutoUpdateService autoUpdater,
        AudioRecorderService? recorder = null, RecordingStorageManager? storage = null)
    {
        _agent = agent;
        _fusion = fusion;
        _audioMonitor = audioMonitor;
        _autoUpdater = autoUpdater;
        _recorder = recorder;
        _storage = storage;

        _statusItem = new ToolStripMenuItem("Call: Idle") { Enabled = false };
        _connectionsItem = new ToolStripMenuItem("CRM Clients: 0") { Enabled = false };
        _zoomItem = new ToolStripMenuItem("Zoom: Checking...") { Enabled = false };
        _recordingItem = new ToolStripMenuItem("Recording: Idle") { Enabled = false };
        _uploadItem = new ToolStripMenuItem("Uploads: None pending") { Enabled = false };
        _updateItem = new ToolStripMenuItem("Check for Updates", null, OnUpdateClick);

        var contextMenu = new ContextMenuStrip();
        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        var versionLabel = version != null ? $"CRM Agent v{version.Major}.{version.Minor}.{version.Build}" : "CRM Agent";
        contextMenu.Items.Add(new ToolStripMenuItem(versionLabel) { Enabled = false, Font = new Font(contextMenu.Font, FontStyle.Bold) });
        contextMenu.Items.Add(new ToolStripSeparator());
        contextMenu.Items.Add(_statusItem);
        contextMenu.Items.Add(_recordingItem);
        contextMenu.Items.Add(_connectionsItem);
        contextMenu.Items.Add(_zoomItem);
        contextMenu.Items.Add(_uploadItem);
        if (_storage != null)
        {
            contextMenu.Items.Add(new ToolStripMenuItem("Open Recordings Folder", null, (_, _) =>
            {
                try { System.Diagnostics.Process.Start("explorer.exe", _storage.RecordingsDirectory); } catch { }
            }));
        }
        contextMenu.Items.Add(new ToolStripSeparator());
        contextMenu.Items.Add(_updateItem);
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
        _autoUpdater.UpdateFound += OnUpdateFound;
        _autoUpdater.StatusChanged += OnUpdateStatusChanged;

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

            SetIcon(color);
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
            var zoomRunning = _audioMonitor.IsZoomRunning();
            _zoomItem.Text = zoomRunning ? "Zoom: Detected" : "Zoom: Not found";

            // Update recording status
            if (_recorder != null)
            {
                _recordingItem.Text = _recorder.CurrentState == Services.RecordingState.Recording
                    ? $"Recording: Active ({_recorder.DurationSeconds}s)"
                    : "Recording: Idle";
            }

            // Update upload status
            if (_storage != null)
            {
                var pending = _storage.PendingCount;
                var failed = _storage.FailedCount;
                _uploadItem.Text = pending > 0 || failed > 0
                    ? $"Uploads: {pending} pending, {failed} failed"
                    : "Uploads: None pending";
            }
        }
        catch { }
    }

    private void OnUpdateClick(object? sender, EventArgs e)
    {
        if (_autoUpdater.UpdateAvailable)
        {
            _ = _autoUpdater.ApplyUpdate();
        }
        else
        {
            _updateItem.Enabled = false;
            _updateItem.Text = "Checking...";
            _ = Task.Run(async () =>
            {
                await _autoUpdater.CheckForUpdate();
                try
                {
                    if (!_autoUpdater.UpdateAvailable)
                    {
                        _updateItem.Text = "Check for Updates";
                        _updateItem.Enabled = true;
                    }
                }
                catch { }
            });
        }
    }

    private void OnUpdateFound(Version version)
    {
        try
        {
            _updateItem.Text = $"Install Update (v{version.ToString(3)})";
            _updateItem.Enabled = true;
            _notifyIcon.ShowBalloonTip(5000, "CRM Agent Update",
                $"Version {version.ToString(3)} is available.\nRight-click tray icon to install.",
                ToolTipIcon.Info);
        }
        catch { }
    }

    private void OnUpdateStatusChanged(string status)
    {
        try
        {
            if (_autoUpdater.IsUpdating)
            {
                _updateItem.Text = status;
                _updateItem.Enabled = false;
            }
            else if (_autoUpdater.UpdateAvailable)
            {
                _updateItem.Text = $"Install Update (v{_autoUpdater.LatestVersion!.ToString(3)})";
                _updateItem.Enabled = true;
            }
            else
            {
                // "Up to date", "Check failed", etc. — revert to default
                _updateItem.Text = "Check for Updates";
                _updateItem.Enabled = true;
            }
        }
        catch { }
    }

    /// <summary>
    /// Replace the tray icon, properly disposing the old one to prevent
    /// GDI handle leaks. Each icon involves a Bitmap + native HICON.
    /// </summary>
    private void SetIcon(Color color)
    {
        var oldIcon = _notifyIcon.Icon;
        _notifyIcon.Icon = CreateDotIcon(color);
        if (oldIcon != null)
        {
            DestroyIcon(oldIcon.Handle);
            oldIcon.Dispose();
        }
    }

    private static Icon CreateDotIcon(Color color)
    {
        using var bmp = new Bitmap(16, 16);
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
        // Clone the icon so we own the lifetime; the HICON from GetHicon()
        // is freed when the Bitmap is disposed (via the using above).
        var icon = (Icon)Icon.FromHandle(hIcon).Clone();
        DestroyIcon(hIcon);
        return icon;
    }

    public void Dispose()
    {
        _updateTimer.Stop();
        _updateTimer.Dispose();
        _fusion.StateChanged -= OnStateChanged;
        _agent.ConnectionCountChanged -= OnConnectionCountChanged;
        _autoUpdater.UpdateFound -= OnUpdateFound;
        _autoUpdater.StatusChanged -= OnUpdateStatusChanged;
        _notifyIcon.Visible = false;
        _notifyIcon.Dispose();
    }
}
