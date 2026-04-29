using System.Drawing;
using ToolManager.Services;

namespace ToolManager.UI;

/// <summary>
/// Modal-ish dialog shown during a GitHub Device Flow sign-in. Displays the
/// one-time user code and a Cancel button while polling runs in the background.
/// Owns its own CancellationTokenSource so closing the dialog cancels polling.
/// </summary>
public class GitHubSignInForm : Form
{
    private readonly CancellationTokenSource _cts = new();
    public CancellationToken CancellationToken => _cts.Token;

    public GitHubSignInForm(GitHubAuthService.DeviceCodeResponse code)
    {
        Text = "Sign in to GitHub";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ClientSize = new Size(420, 220);

        var lblHeader = new Label
        {
            Text = "Authorize Tool Manager",
            Font = new Font(Font.FontFamily, 11, FontStyle.Bold),
            Location = new Point(20, 18),
            AutoSize = true,
        };

        var lblStep1 = new Label
        {
            Text = "1. A browser has opened to:",
            Location = new Point(20, 50),
            AutoSize = true,
        };
        var lblUri = new Label
        {
            Text = code.VerificationUri,
            Location = new Point(20, 70),
            ForeColor = Color.SteelBlue,
            AutoSize = true,
        };

        var lblStep2 = new Label
        {
            Text = "2. Enter this code (copied to clipboard):",
            Location = new Point(20, 100),
            AutoSize = true,
        };
        var lblCode = new Label
        {
            Text = code.UserCode,
            Font = new Font("Consolas", 16, FontStyle.Bold),
            Location = new Point(20, 122),
            AutoSize = true,
            ForeColor = Color.DarkGoldenrod,
        };

        var lblStatus = new Label
        {
            Text = "Waiting for authorization...",
            Location = new Point(20, 165),
            AutoSize = true,
            ForeColor = Color.Gray,
        };

        var btnCancel = new Button
        {
            Text = "Cancel",
            Location = new Point(320, 180),
            Size = new Size(80, 28),
            DialogResult = DialogResult.Cancel,
        };
        btnCancel.Click += (_, _) => _cts.Cancel();

        Controls.AddRange(new Control[] { lblHeader, lblStep1, lblUri, lblStep2, lblCode, lblStatus, btnCancel });
        CancelButton = btnCancel;

        FormClosed += (_, _) => _cts.Cancel();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) _cts.Dispose();
        base.Dispose(disposing);
    }
}
