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
    /// </summary>
    public void ApplyAutoStart(bool enabled)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run", true);
            if (key == null) return;

            if (enabled)
            {
                var exePath = Environment.ProcessPath;
                if (exePath == null) return;
                var desired = $"\"{exePath}\"";
                var existing = key.GetValue("ToolManager") as string;
                if (!string.Equals(existing, desired, StringComparison.OrdinalIgnoreCase))
                {
                    key.SetValue("ToolManager", desired);
                    Debug.WriteLine("[Settings] Registered auto-start");
                }
            }
            else
            {
                if (key.GetValue("ToolManager") != null)
                {
                    key.DeleteValue("ToolManager", false);
                    Debug.WriteLine("[Settings] Removed auto-start");
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Settings] Auto-start toggle failed: {ex.Message}");
        }
    }
}
