using System.Drawing;
using System.Drawing.Drawing2D;
using ToolManager.Models;

namespace ToolManager.UI;

/// <summary>
/// Custom control that displays a single tool's info with install/update/uninstall actions.
/// </summary>
public class ToolCard : UserControl
{
    private readonly ToolInfo _tool;
    private readonly Label _nameLabel;
    private readonly Label _descLabel;
    private readonly Label _infoLabel;
    private readonly Label _versionLabel;
    private readonly Button _actionButton;
    private readonly Button _uninstallButton;
    private readonly Panel _iconPanel;

    public event Func<ToolInfo, Task>? InstallRequested;
    public event Func<ToolInfo, Task>? UninstallRequested;

    public ToolCard(ToolInfo tool)
    {
        _tool = tool;

        Height = 100;
        Margin = new Padding(12, 0, 12, 8);
        Padding = new Padding(14);
        BackColor = Color.White;
        Cursor = Cursors.Default;

        // Icon panel (letter circle)
        _iconPanel = new Panel
        {
            Size = new Size(40, 40),
            Location = new Point(14, 20),
        };
        _iconPanel.Paint += PaintIcon;

        // Tool name
        _nameLabel = new Label
        {
            Text = tool.DisplayName,
            Font = new Font("Segoe UI", 11f, FontStyle.Bold),
            ForeColor = Color.FromArgb(32, 33, 36),
            Location = new Point(64, 14),
            AutoSize = true,
        };

        // Version (top right)
        _versionLabel = new Label
        {
            Text = $"v{tool.LatestVersion.ToString(tool.LatestVersion.Build > 0 ? 3 : 2)}",
            Font = new Font("Segoe UI", 9f),
            ForeColor = Color.FromArgb(128, 134, 139),
            AutoSize = true,
            Anchor = AnchorStyles.Top | AnchorStyles.Right,
        };

        // Description
        _descLabel = new Label
        {
            Text = tool.Description ?? "",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(95, 99, 104),
            Location = new Point(64, 38),
            AutoSize = true,
            MaximumSize = new Size(400, 0),
        };

        // Info line
        var typeLabel = tool.ToolType switch
        {
            "windows-app" => "Windows App",
            "chrome-extension" => "Chrome Extension",
            _ => tool.ToolType,
        };

        var statusText = tool.IsInstalled
            ? $"Installed: v{tool.InstalledVersion?.ToString(tool.InstalledVersion.Build > 0 ? 3 : 2) ?? "?"}"
            : "Not installed";

        _infoLabel = new Label
        {
            Text = $"{statusText}  ·  {typeLabel}",
            Font = new Font("Segoe UI", 8f),
            ForeColor = tool.UpdateAvailable
                ? Color.FromArgb(234, 136, 0)
                : tool.IsInstalled
                    ? Color.FromArgb(52, 168, 83)
                    : Color.FromArgb(128, 134, 139),
            Location = new Point(64, 56),
            AutoSize = true,
        };

        // Action button
        _actionButton = new Button
        {
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 9f, FontStyle.Bold),
            Cursor = Cursors.Hand,
            Height = 30,
            Anchor = AnchorStyles.Bottom | AnchorStyles.Right,
        };
        _actionButton.FlatAppearance.BorderSize = 0;

        if (tool.UpdateAvailable)
        {
            _actionButton.Text = $"Update to v{tool.LatestVersion.ToString(tool.LatestVersion.Build > 0 ? 3 : 2)}";
            _actionButton.BackColor = Color.FromArgb(26, 115, 232);
            _actionButton.ForeColor = Color.White;
            _actionButton.Width = 140;
        }
        else if (tool.IsInstalled)
        {
            _actionButton.Text = "Up to date";
            _actionButton.BackColor = Color.FromArgb(232, 240, 254);
            _actionButton.ForeColor = Color.FromArgb(26, 115, 232);
            _actionButton.Enabled = false;
            _actionButton.Width = 100;
        }
        else
        {
            _actionButton.Text = "Install";
            _actionButton.BackColor = Color.FromArgb(52, 168, 83);
            _actionButton.ForeColor = Color.White;
            _actionButton.Width = 80;
        }

        _actionButton.Click += async (_, _) =>
        {
            if (InstallRequested != null && (_tool.UpdateAvailable || !_tool.IsInstalled))
            {
                _actionButton.Enabled = false;
                _actionButton.Text = _tool.IsInstalled ? "Updating..." : "Installing...";
                await InstallRequested.Invoke(_tool);
            }
        };

        // Uninstall button
        _uninstallButton = new Button
        {
            Text = "Uninstall",
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(234, 67, 53),
            BackColor = Color.White,
            Height = 30,
            Width = 80,
            Visible = tool.IsInstalled,
            Anchor = AnchorStyles.Bottom | AnchorStyles.Right,
        };
        _uninstallButton.FlatAppearance.BorderColor = Color.FromArgb(234, 67, 53);
        _uninstallButton.FlatAppearance.BorderSize = 1;
        _uninstallButton.Click += async (_, _) =>
        {
            if (UninstallRequested != null)
            {
                var result = MessageBox.Show(
                    $"Are you sure you want to uninstall {_tool.DisplayName}?",
                    "Confirm Uninstall",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question);
                if (result == DialogResult.Yes)
                {
                    _uninstallButton.Enabled = false;
                    _uninstallButton.Text = "Removing...";
                    await UninstallRequested.Invoke(_tool);
                }
            }
        };

        Controls.Add(_iconPanel);
        Controls.Add(_nameLabel);
        Controls.Add(_versionLabel);
        Controls.Add(_descLabel);
        Controls.Add(_infoLabel);
        Controls.Add(_actionButton);
        Controls.Add(_uninstallButton);
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        _versionLabel.Location = new Point(Width - _versionLabel.Width - 20, 14);
        _actionButton.Location = new Point(Width - _actionButton.Width - 20, 64);
        _uninstallButton.Location = new Point(Width - _actionButton.Width - _uninstallButton.Width - 28, 64);
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        base.OnPaint(e);
        using var pen = new Pen(Color.FromArgb(226, 229, 235), 1);
        e.Graphics.DrawRectangle(pen, 0, 0, Width - 1, Height - 1);
    }

    private void PaintIcon(object? sender, PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.Clear(BackColor);

        var color = _tool.ToolType switch
        {
            "windows-app" => Color.FromArgb(26, 115, 232),
            "chrome-extension" => Color.FromArgb(52, 168, 83),
            _ => Color.FromArgb(95, 99, 104),
        };

        using var brush = new SolidBrush(color);
        g.FillEllipse(brush, 0, 0, 38, 38);

        var letter = _tool.DisplayName.Length > 0 ? _tool.DisplayName[0].ToString().ToUpper() : "?";
        using var font = new Font("Segoe UI", 14f, FontStyle.Bold);
        using var textBrush = new SolidBrush(Color.White);
        var size = g.MeasureString(letter, font);
        g.DrawString(letter, font, textBrush, (38 - size.Width) / 2, (38 - size.Height) / 2);
    }

    public void SetStatus(string text)
    {
        _actionButton.Text = text;
        _actionButton.Enabled = false;
    }
}
