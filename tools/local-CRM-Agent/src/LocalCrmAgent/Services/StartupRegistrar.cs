using System.Diagnostics;
using Microsoft.Win32;

namespace LocalCrmAgent.Services;

/// <summary>
/// Idempotently registers the agent for Windows login startup and as the
/// crm-agent:// protocol handler. Safe to call repeatedly — only writes when
/// the existing value is missing or points to a different exe.
/// </summary>
public static class StartupRegistrar
{
    public const string RunValueName = "LocalCrmAgent";
    public const string ProtocolScheme = "crm-agent";

    private const string RunKeyPath = @"Software\Microsoft\Windows\CurrentVersion\Run";

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
}
