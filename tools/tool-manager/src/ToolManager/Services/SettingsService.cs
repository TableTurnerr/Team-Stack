using System.Diagnostics;
using Microsoft.Win32;
using ToolManager.Models;

namespace ToolManager.Services;

/// <summary>
/// Manages persistent settings with side-effects (registry, scheduler).
/// </summary>
public class SettingsService
{
    private ToolManagerSettings _settings;

    public ToolManagerSettings Settings => _settings;

    public SettingsService()
    {
        _settings = ToolManagerSettings.Load();
    }

    public void SetAutoStart(bool enabled)
    {
        _settings.AutoStartEnabled = enabled;
        _settings.Save();
        ApplyAutoStart(enabled);
    }

    public void SetAutoUpdate(bool enabled)
    {
        _settings.AutoUpdateEnabled = enabled;
        _settings.Save();
    }

    /// <summary>
    /// Apply the auto-start setting to the Windows registry.
    /// Called on startup and when the setting changes.
    /// Returns true when the registry was touched (added, corrected, or removed).
    /// </summary>
    public bool ApplyAutoStart(bool enabled)
    {
        try
        {
            // CreateSubKey ensures we still succeed on the rare systems where
            // the Run key itself has been deleted. It behaves like OpenSubKey
            // with write access when the key already exists.
            using var key = Registry.CurrentUser.CreateSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run");
            if (key == null) return false;

            if (enabled)
            {
                var exePath = Environment.ProcessPath;
                if (exePath == null) return false;
                var desired = $"\"{exePath}\"";
                if (key.GetValue("ToolManager") is string existing
                    && string.Equals(existing, desired, StringComparison.OrdinalIgnoreCase))
                {
                    return false;
                }
                key.SetValue("ToolManager", desired);
                Debug.WriteLine("[Settings] Registered auto-start");
                return true;
            }

            if (key.GetValue("ToolManager") != null)
            {
                key.DeleteValue("ToolManager", false);
                Debug.WriteLine("[Settings] Removed auto-start");
                return true;
            }
            return false;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Settings] Auto-start toggle failed: {ex.Message}");
            return false;
        }
    }
}
