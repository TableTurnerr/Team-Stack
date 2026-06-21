using System.Diagnostics;
using System.Text.Json;
using Microsoft.Win32;

namespace LocalCrmAgent.Services;

/// <summary>
/// Idempotently registers the agent for Windows login startup, as the
/// crm-agent:// protocol handler, and as the Chrome/Edge Native Messaging host
/// the Lead Scraper extension talks to. Safe to call repeatedly — only writes
/// when the existing value is missing or points to a different exe.
/// </summary>
public static class StartupRegistrar
{
    public const string RunValueName = "LocalCrmAgent";
    public const string ProtocolScheme = "crm-agent";

    // Native Messaging host name the extension's background.js connects to
    // (frozen in the architecture plan §4 / ZOOM_RECORDING_NOTES.md).
    public const string NativeHostName = "com.tableturnerr.crm_agent";

    // Pinned Lead Scraper extension id (derived from the `key` in its
    // manifest.json). Only this origin may launch the host. Not a secret.
    public const string ExtensionId = "jmedgkieldhfccjpjeafmgenaidchbmg";

    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

    // NativeMessagingHosts keys for the Chromium browsers reps may use.
    private static readonly string[] NativeHostKeyPaths =
    [
        @"Software\Google\Chrome\NativeMessagingHosts\" + NativeHostName,
        @"Software\Microsoft\Edge\NativeMessagingHosts\" + NativeHostName,
    ];

    /// <summary>
    /// Ensure the HKCU Run entry points to the current exe.
    /// Returns true if the registry was touched (missing or corrected).
    /// </summary>
    public static bool EnsureAutoStart()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            if (exePath == null) return false;

            // CreateSubKey is used (rather than OpenSubKey) so the call still
            // succeeds on the extremely rare setups where the Run key was
            // deleted entirely. It behaves like OpenSubKey when the key exists.
            using var key = Registry.CurrentUser.CreateSubKey(RunKeyPath);
            if (key == null) return false;

            var desired = $"\"{exePath}\"";
            if (key.GetValue(RunValueName) is string existing
                && string.Equals(existing, desired, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            key.SetValue(RunValueName, desired);
            Debug.WriteLine($"[StartupRegistrar] Registered auto-start: {desired}");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[StartupRegistrar] Auto-start registration failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Ensure the crm-agent:// protocol handler points to the current exe.
    /// </summary>
    public static bool EnsureProtocolHandler()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            if (exePath == null) return false;

            var desiredCommand = $"\"{exePath}\" \"%1\"";
            var desiredIcon = $"\"{exePath}\",0";

            using var root = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ProtocolScheme}");
            using var cmdKey = root.CreateSubKey(@"shell\open\command");
            using var iconKey = root.CreateSubKey("DefaultIcon");

            var existingCmd = cmdKey.GetValue("") as string;
            var existingIcon = iconKey.GetValue("") as string;

            if (string.Equals(existingCmd, desiredCommand, StringComparison.OrdinalIgnoreCase)
                && string.Equals(existingIcon, desiredIcon, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            root.SetValue("", $"URL:CRM Agent Protocol");
            root.SetValue("URL Protocol", "");
            cmdKey.SetValue("", desiredCommand);
            iconKey.SetValue("", desiredIcon);
            Debug.WriteLine($"[StartupRegistrar] Registered {ProtocolScheme}:// protocol handler");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[StartupRegistrar] Protocol handler registration failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Ensure the Chrome/Edge Native Messaging host manifest exists and points at
    /// the current exe, and that the per-browser registry keys point at the
    /// manifest. This is what lets the Lead Scraper extension reach the agent to
    /// start/stop recording on Zoom web-phone calls. Returns true if anything
    /// was written.
    /// </summary>
    public static bool EnsureNativeMessagingHost()
    {
        try
        {
            var exePath = Environment.ProcessPath;
            if (exePath == null) return false;

            // Manifest lives in a stable per-user dir (survives tool updates that
            // replace the install folder). Chrome reads it fresh each connection.
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CrmAgent");
            Directory.CreateDirectory(dir);
            var manifestPath = Path.Combine(dir, NativeHostName + ".json");

            var manifest = new
            {
                name = NativeHostName,
                description = "TableTurnerr CRM Agent native messaging host",
                path = exePath,
                type = "stdio",
                allowed_origins = new[] { $"chrome-extension://{ExtensionId}/" },
            };
            var manifestJson = JsonSerializer.Serialize(
                manifest, new JsonSerializerOptions { WriteIndented = true });

            bool touched = false;

            var existingManifest = File.Exists(manifestPath) ? File.ReadAllText(manifestPath) : null;
            if (!string.Equals(existingManifest, manifestJson, StringComparison.Ordinal))
            {
                File.WriteAllText(manifestPath, manifestJson);
                Debug.WriteLine($"[StartupRegistrar] Wrote native host manifest: {manifestPath}");
                touched = true;
            }

            foreach (var keyPath in NativeHostKeyPaths)
            {
                using var key = Registry.CurrentUser.CreateSubKey(keyPath);
                if (key == null) continue;
                if (key.GetValue("") is string existing
                    && string.Equals(existing, manifestPath, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                key.SetValue("", manifestPath);
                Debug.WriteLine($"[StartupRegistrar] Registered native host key: {keyPath}");
                touched = true;
            }

            return touched;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[StartupRegistrar] Native host registration failed: {ex.Message}");
            return false;
        }
    }
}
