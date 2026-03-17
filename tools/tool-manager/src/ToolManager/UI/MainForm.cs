using System.Drawing;
using ToolManager.Models;
using ToolManager.Services;

namespace ToolManager.UI;

public class MainForm : Form
{
    private readonly GitHubReleaseService _github;
    private readonly InstallService _installer;
    private readonly InstalledToolsRegistry _registry;
    private readonly UpdateScheduler _scheduler;
    private readonly SelfUpdateService _selfUpdater;

    private readonly Panel _headerPanel;
    private readonly Panel _actionBar;
    private readonly FlowLayoutPanel _toolList;
    private readonly Label _statusLabel;
    private readonly Button _checkAllButton;
    private bool _isLoading;

    public MainForm(
        GitHubReleaseService github,
        InstallService installer,
        InstalledToolsRegistry registry,
        UpdateScheduler scheduler,
        SelfUpdateService selfUpdater)
    {
        _github = github;
        _installer = installer;
        _registry = registry;
        _scheduler = scheduler;
        _selfUpdater = selfUpdater;

        Text = "TableTurnerr Tool Manager";
        MinimumSize = new Size(550, 400);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(240, 242, 245);
        Font = new Font("Segoe UI", 9f);

        // ── Header ───────────────────────────────────────────
        _headerPanel = new Panel
        {
            Dock = DockStyle.Top,
            Height = 56,
            BackColor = Color.White,
            Padding = new Padding(20, 0, 20, 0),
        };
        _headerPanel.Paint += (_, e) =>
        {
            using var pen = new Pen(Color.FromArgb(226, 229, 235));
            e.Graphics.DrawLine(pen, 0, _headerPanel.Height - 1, _headerPanel.Width, _headerPanel.Height - 1);
        };

        var titleLabel = new Label
        {
            Text = "TableTurnerr Tool Manager",
            Font = new Font("Segoe UI", 14f, FontStyle.Bold),
            ForeColor = Color.FromArgb(32, 33, 36),
            AutoSize = true,
            Location = new Point(20, 16),
        };

        var versionLabel = new Label
        {
            Text = $"v{_selfUpdater.CurrentVersion.ToString(3)}",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(128, 134, 139),
            AutoSize = true,
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
        };
        versionLabel.Location = new Point(_headerPanel.Width - versionLabel.Width - 24, 20);
        _headerPanel.Resize += (_, _) =>
            versionLabel.Location = new Point(_headerPanel.Width - versionLabel.Width - 24, 20);

        _headerPanel.Controls.Add(titleLabel);
        _headerPanel.Controls.Add(versionLabel);

        // ── Action bar ───────────────────────────────────────
        _actionBar = new Panel
        {
            Dock = DockStyle.Top,
            Height = 44,
            BackColor = Color.White,
            Padding = new Padding(20, 8, 20, 8),
        };
        _actionBar.Paint += (_, e) =>
        {
            using var pen = new Pen(Color.FromArgb(226, 229, 235));
            e.Graphics.DrawLine(pen, 0, _actionBar.Height - 1, _actionBar.Width, _actionBar.Height - 1);
        };

        _checkAllButton = new Button
        {
            Text = "Check for Updates",
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            BackColor = Color.FromArgb(26, 115, 232),
            ForeColor = Color.White,
            Size = new Size(150, 28),
            Location = new Point(20, 8),
            Cursor = Cursors.Hand,
        };
        _checkAllButton.FlatAppearance.BorderSize = 0;
        _checkAllButton.Click += async (_, _) => await CheckAll();

        _statusLabel = new Label
        {
            Text = "Loading...",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(128, 134, 139),
            AutoSize = true,
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
        };
        _statusLabel.Location = new Point(_actionBar.Width - _statusLabel.Width - 24, 14);
        _actionBar.Resize += (_, _) =>
            _statusLabel.Location = new Point(_actionBar.Width - _statusLabel.Width - 24, 14);

        _actionBar.Controls.Add(_checkAllButton);
        _actionBar.Controls.Add(_statusLabel);

        // ── Scrollable tool list ─────────────────────────────
        _toolList = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true,
            Padding = new Padding(8, 8, 8, 8),
        };

        Controls.Add(_toolList);
        Controls.Add(_actionBar);
        Controls.Add(_headerPanel);

        // Set size AFTER _toolList is initialized (OnResize fires when Size is set)
        Size = new Size(680, 520);

        // Refresh UI when the background scheduler finishes
        _scheduler.UpdatesChecked += () =>
        {
            try { BeginInvoke(() => _ = LoadTools()); } catch { }
        };
        _scheduler.UpdatesApplied += results =>
        {
            try { BeginInvoke(() => _ = LoadTools(forceRefresh: true)); } catch { }
        };

        // Load on shown
        Shown += async (_, _) => await LoadTools();
    }

    /// <summary>
    /// "Check for Updates" button: checks tools + manager itself, auto-applies
    /// updates for installed tools, and shows self-update notification.
    /// </summary>
    private async Task CheckAll()
    {
        _checkAllButton.Enabled = false;
        _statusLabel.Text = "Checking everything...";

        try
        {
            // Check and auto-update installed tools
            await _scheduler.CheckAndUpdateInstalled();

            // Check for manager self-update
            await _selfUpdater.CheckNow();

            _github.InvalidateCache();
            await LoadTools(forceRefresh: true);
            _statusLabel.Text = "All checks complete";
        }
        catch (Exception ex)
        {
            _statusLabel.Text = $"Error: {ex.Message}";
        }
        finally
        {
            _checkAllButton.Enabled = true;
        }
    }

    public async Task LoadTools(bool forceRefresh = false)
    {
        if (_isLoading) return;
        _isLoading = true;
        _checkAllButton.Enabled = false;

        try
        {
            _registry.Load();
            var tools = await _github.FetchToolsAsync(forceRefresh);

            _toolList.SuspendLayout();
            _toolList.Controls.Clear();

            // ── Manager self-update card (always first) ──────
            AddManagerCard();

            // ── Tool cards ───────────────────────────────────
            foreach (var tool in tools)
            {
                var card = new ToolCard(tool)
                {
                    Width = _toolList.ClientSize.Width - 30,
                };
                card.InstallRequested += OnInstall;
                card.UninstallRequested += OnUninstall;
                _toolList.Controls.Add(card);
            }

            if (tools.Count == 0)
            {
                var emptyLabel = new Label
                {
                    Text = "No tools found in GitHub Releases.\nPush a version to the release branch to get started.",
                    Font = new Font("Segoe UI", 10f),
                    ForeColor = Color.FromArgb(128, 134, 139),
                    TextAlign = ContentAlignment.MiddleCenter,
                    Dock = DockStyle.Top,
                    Height = 60,
                    AutoSize = false,
                };
                _toolList.Controls.Add(emptyLabel);
            }

            _toolList.ResumeLayout();

            var elapsed = DateTime.UtcNow - _scheduler.LastCheckTime;
            _statusLabel.Text = _scheduler.LastCheckTime == default
                ? "Ready"
                : $"Last checked: {(elapsed.TotalMinutes < 1 ? "just now" : $"{(int)elapsed.TotalMinutes} min ago")}";
        }
        catch (Exception ex)
        {
            _statusLabel.Text = $"Error: {ex.Message}";
        }
        finally
        {
            _isLoading = false;
            _checkAllButton.Enabled = true;
        }
    }

    private void AddManagerCard()
    {
        var panel = new Panel
        {
            Height = 70,
            Dock = DockStyle.Top,
            Margin = new Padding(12, 0, 12, 8),
            Padding = new Padding(14),
            BackColor = Color.FromArgb(232, 240, 254),
            Width = _toolList.ClientSize.Width - 30,
        };
        panel.Paint += (_, e) =>
        {
            using var pen = new Pen(Color.FromArgb(180, 200, 230), 1);
            e.Graphics.DrawRectangle(pen, 0, 0, panel.Width - 1, panel.Height - 1);
        };

        var nameLabel = new Label
        {
            Text = "Tool Manager (this app)",
            Font = new Font("Segoe UI", 10f, FontStyle.Bold),
            ForeColor = Color.FromArgb(26, 115, 232),
            AutoSize = true,
            Location = new Point(14, 10),
        };

        var currentVer = _selfUpdater.CurrentVersion.ToString(3);
        var statusText = _selfUpdater.UpdateAvailable
            ? $"v{currentVer}  ->  v{_selfUpdater.LatestVersion!.ToString(3)} available"
            : $"v{currentVer}  ·  Up to date";
        var statusColor = _selfUpdater.UpdateAvailable
            ? Color.FromArgb(234, 136, 0)
            : Color.FromArgb(52, 168, 83);

        var statusLabel = new Label
        {
            Text = statusText,
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = statusColor,
            AutoSize = true,
            Location = new Point(14, 34),
        };

        panel.Controls.Add(nameLabel);
        panel.Controls.Add(statusLabel);

        if (_selfUpdater.UpdateAvailable)
        {
            var updateBtn = new Button
            {
                Text = $"Update to v{_selfUpdater.LatestVersion!.ToString(3)}",
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
                BackColor = Color.FromArgb(26, 115, 232),
                ForeColor = Color.White,
                Height = 28,
                Width = 130,
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right,
            };
            updateBtn.FlatAppearance.BorderSize = 0;
            updateBtn.Location = new Point(panel.Width - updateBtn.Width - 20, 20);
            updateBtn.Click += async (_, _) =>
            {
                updateBtn.Enabled = false;
                updateBtn.Text = "Updating...";
                await _selfUpdater.ApplyUpdate();
            };
            panel.Controls.Add(updateBtn);
            panel.Resize += (_, _) => updateBtn.Location = new Point(panel.Width - updateBtn.Width - 20, 20);
        }

        _toolList.Controls.Add(panel);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        if (_toolList == null) return;
        foreach (Control c in _toolList.Controls)
        {
            if (c is ToolCard or Panel)
                c.Width = _toolList.ClientSize.Width - 30;
        }
    }

    private async Task OnInstall(ToolInfo tool)
    {
        _statusLabel.Text = $"{tool.DisplayName}: Installing...";
        var status = new Progress<string>(s => _statusLabel.Text = $"{tool.DisplayName}: {s}");
        await _installer.InstallOrUpdate(tool, status);
        _github.InvalidateCache();
        await LoadTools(forceRefresh: true);
    }

    private async Task OnUninstall(ToolInfo tool)
    {
        _statusLabel.Text = $"{tool.DisplayName}: Uninstalling...";
        var status = new Progress<string>(s => _statusLabel.Text = $"{tool.DisplayName}: {s}");
        await _installer.Uninstall(tool.TagPrefix, status);
        _github.InvalidateCache();
        await LoadTools(forceRefresh: true);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
        }
        else
        {
            base.OnFormClosing(e);
        }
    }
}
