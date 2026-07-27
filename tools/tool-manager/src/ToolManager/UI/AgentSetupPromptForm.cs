using System.Drawing;
using ToolManager.Services;

namespace ToolManager.UI;

/// <summary>
/// Popup shown when the Local CRM Agent is installed but has never been
/// provisioned with the rep's personal settings. Asks the rep to locate the
/// Setup-CRM-Agent-&lt;TheirName&gt;.bat their admin sent them via a file picker,
/// then applies it (env vars + config patch + agent relaunch) without the rep
/// having to run anything.
/// </summary>
public class AgentSetupPromptForm : Form
{
    private readonly AgentProvisioningService _provisioning;
    private readonly Label _lblStatus;
    private readonly Button _btnBrowse;

    public AgentSetupPromptForm(AgentProvisioningService provisioning)
    {
        _provisioning = provisioning;

        Text = "CRM Agent Setup";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        StartPosition = FormStartPosition.CenterScreen;
        MaximizeBox = false;
        MinimizeBox = false;
        TopMost = true;
        ClientSize = new Size(480, 250);

        var lblHeader = new Label
        {
            Text = "One more step — your CRM Agent needs your setup file",
            Font = new Font(Font.FontFamily, 11, FontStyle.Bold),
            Location = new Point(20, 18),
            AutoSize = true,
        };

        var lblBody = new Label
        {
            Text = "Your CRM Agent is installed, but it doesn't know who you are yet,\n" +
                   "so your calls can't be credited to you.\n\n" +
                   "Your admin sent you a file named  Setup-CRM-Agent-<YourName>.bat\n" +
                   "(check Downloads, your Desktop, or the chat where you received it).\n\n" +
                   "Click the button below and select that file — that's all.",
            Location = new Point(20, 50),
            AutoSize = true,
        };

        _btnBrowse = new Button
        {
            Text = "Select my setup file…",
            Font = new Font(Font.FontFamily, 10, FontStyle.Bold),
            Location = new Point(20, 175),
            Size = new Size(200, 34),
        };
        _btnBrowse.Click += (_, _) => BrowseAndApply();

        var btnLater = new Button
        {
            Text = "Remind me later",
            Location = new Point(360, 180),
            Size = new Size(100, 28),
            DialogResult = DialogResult.Cancel,
        };

        _lblStatus = new Label
        {
            Text = "",
            Location = new Point(20, 218),
            AutoSize = true,
            ForeColor = Color.Gray,
        };

        Controls.AddRange(new Control[] { lblHeader, lblBody, _btnBrowse, btnLater, _lblStatus });
        CancelButton = btnLater;
    }

    private void BrowseAndApply()
    {
        using var dialog = new OpenFileDialog
        {
            Title = "Select your Setup-CRM-Agent-<YourName>.bat file",
            Filter = "CRM Agent setup file (Setup-CRM-Agent-*.bat)|Setup-CRM-Agent-*.bat|Batch files (*.bat)|*.bat|All files (*.*)|*.*",
            InitialDirectory = GetDownloadsFolder(),
            CheckFileExists = true,
        };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;

        Dictionary<string, string> vars;
        try
        {
            vars = AgentProvisioningService.ParseSetupBat(dialog.FileName);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Couldn't read that file:\n{ex.Message}", "CRM Agent Setup",
                MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // The rep key is the one value that must come from the rep's own file.
        if (!vars.ContainsKey("CRM_AGENT_REP_KEY"))
        {
            MessageBox.Show(this,
                "That file doesn't look like a CRM Agent setup file.\n\n" +
                "Please pick the file named  Setup-CRM-Agent-<YourName>.bat\n" +
                "that your admin sent you. If you can't find it, ask your admin\n" +
                "to send it again.",
                "CRM Agent Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        _btnBrowse.Enabled = false;
        _lblStatus.Text = "Applying your settings and restarting the agent…";
        _lblStatus.ForeColor = Color.Gray;
        Refresh();

        try
        {
            _provisioning.Apply(vars);
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[AgentSetup] Apply failed: {ex}");
            _btnBrowse.Enabled = true;
            _lblStatus.Text = "";
            MessageBox.Show(this, $"Something went wrong applying the settings:\n{ex.Message}\n\nPlease tell your admin.",
                "CRM Agent Setup", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        MessageBox.Show(this,
            "All set! The CRM Agent is now configured for your account.\n" +
            "You can delete the setup file if you like.",
            "CRM Agent Setup", MessageBoxButtons.OK, MessageBoxIcon.Information);
        DialogResult = DialogResult.OK;
        Close();
    }

    private static string GetDownloadsFolder()
    {
        var downloads = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
        return Directory.Exists(downloads)
            ? downloads
            : Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
    }
}
