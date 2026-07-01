using System.Drawing;
using System.Windows.Forms;

namespace LocalCrmAgent.UI;

/// <summary>
/// One-time setup dialog shown on first run when the agent has no upload token.
/// Captures the shared agent token (the only secret the agent needs — Zoom creds
/// are then pulled from the worker) and an optional rep GHL user id for call
/// attribution. The worker URL is pre-filled with the team default and rarely
/// needs changing.
/// </summary>
public sealed class SetupForm : Form
{
    private readonly TextBox _tokenBox;
    private readonly TextBox _repBox;
    private readonly TextBox _workerBox;

    public string WorkerUrl => _workerBox.Text.Trim();
    public string AgentToken => _tokenBox.Text.Trim();
    public string? RepUserId => string.IsNullOrWhiteSpace(_repBox.Text) ? null : _repBox.Text.Trim();

    private SetupForm(string defaultWorkerUrl, string? existingRepUserId)
    {
        Text = "CRM Agent — Setup";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        ShowInTaskbar = true;
        ClientSize = new Size(440, 250);
        TopMost = true;
        Font = new Font("Segoe UI", 9f);

        var intro = new Label
        {
            Text = "Enter your team's CRM Agent token to enable call recording upload. "
                 + "Ask your admin for it. Everything else is configured automatically.",
            Location = new Point(14, 12),
            Size = new Size(412, 40),
        };

        var tokenLabel = new Label { Text = "Agent token (required)", Location = new Point(14, 58), AutoSize = true };
        _tokenBox = new TextBox { Location = new Point(14, 78), Size = new Size(412, 24), UseSystemPasswordChar = true };

        var repLabel = new Label { Text = "Rep GHL user id (optional, for attribution)", Location = new Point(14, 108), AutoSize = true };
        _repBox = new TextBox { Location = new Point(14, 128), Size = new Size(412, 24), Text = existingRepUserId ?? "" };

        var workerLabel = new Label { Text = "Worker URL", Location = new Point(14, 158), AutoSize = true };
        _workerBox = new TextBox { Location = new Point(14, 178), Size = new Size(412, 24), Text = defaultWorkerUrl };

        var ok = new Button { Text = "Save", Location = new Point(270, 212), Size = new Size(75, 28), DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", Location = new Point(351, 212), Size = new Size(75, 28), DialogResult = DialogResult.Cancel };

        // Block OK when the required token is empty.
        ok.Click += (_, e) =>
        {
            if (string.IsNullOrWhiteSpace(_tokenBox.Text))
            {
                MessageBox.Show(this, "The agent token is required.", "Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                DialogResult = DialogResult.None;
            }
        };

        Controls.AddRange(new Control[] { intro, tokenLabel, _tokenBox, repLabel, _repBox, workerLabel, _workerBox, ok, cancel });
        AcceptButton = ok;
        CancelButton = cancel;
    }

    /// <summary>
    /// Show the dialog modally. Returns the captured values, or null if the user
    /// cancelled (agent then runs unprovisioned and re-prompts next launch).
    /// </summary>
    public static (string workerUrl, string token, string? repUserId)? Prompt(
        string defaultWorkerUrl, string? existingRepUserId)
    {
        using var form = new SetupForm(defaultWorkerUrl, existingRepUserId);
        return form.ShowDialog() == DialogResult.OK
            ? (form.WorkerUrl, form.AgentToken, form.RepUserId)
            : null;
    }
}
