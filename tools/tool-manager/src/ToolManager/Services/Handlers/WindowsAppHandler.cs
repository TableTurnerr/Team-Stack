using System.Diagnostics;
using Microsoft.Win32;
using ToolManager.Models;

namespace ToolManager.Services.Handlers;

/// <summary>
/// Handles install/uninstall for windows-app type tools.
/// Mirrors the logic from install.bat / uninstall.bat.
/// </summary>
public class WindowsAppHandler : IToolTypeHandler
{
    public string TypeName => "windows-app";

    public async Task Install(string stagingPath, string installPath, ToolManifest manifest)
    {
        // 1. Kill existing process
        if (!string.IsNullOrEmpty(manifest.ProcessName))
        {
            foreach (var proc in Process.GetProcessesByName(manifest.ProcessName))
            {
                try { proc.Kill(); } catch { }
            }
            await Task.Delay(2000);
        }

        // 2. Copy files to install path
        Directory.CreateDirectory(installPath);
        CopyDirectory(stagingPath, installPath);

        var exePath = !string.IsNullOrEmpty(manifest.Executable)
            ? Path.Combine(installPath, manifest.Executable)
            : null;

        // 3. Register auto-start
        if (manifest.AutoStart && manifest.RegistryAutoStart != null && exePath != null)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true);
                var value = $"\"{exePath}\"";
                if (!string.IsNullOrEmpty(manifest.RegistryAutoStart.Args))
                    value += $" {manifest.RegistryAutoStart.Args}";
                key?.SetValue(manifest.RegistryAutoStart.Key, value);
                Debug.WriteLine($"[WindowsApp] Registered auto-start: {manifest.RegistryAutoStart.Key}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WindowsApp] Auto-start failed: {ex.Message}");
            }
        }

        // 4. Register protocol handler
        if (!string.IsNullOrEmpty(manifest.ProtocolHandler) && exePath != null)
        {
            try
            {
                using var key = Registry.CurrentUser.CreateSubKey(
                    $@"Software\Classes\{manifest.ProtocolHandler}");
                key.SetValue("", $"URL:{manifest.ProtocolHandler} Protocol");
                key.SetValue("URL Protocol", "");

                using var iconKey = key.CreateSubKey("DefaultIcon");
                iconKey.SetValue("", $"\"{exePath}\",0");

                using var cmdKey = key.CreateSubKey(@"shell\open\command");
                cmdKey.SetValue("", $"\"{exePath}\" \"%1\"");

                Debug.WriteLine($"[WindowsApp] Registered protocol: {manifest.ProtocolHandler}://");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WindowsApp] Protocol handler failed: {ex.Message}");
            }
        }

        // 5. Create Start Menu shortcut
        if (!string.IsNullOrEmpty(manifest.StartMenuFolder)
            && !string.IsNullOrEmpty(manifest.StartMenuName)
            && exePath != null)
        {
            try
            {
                var startMenu = Environment.GetFolderPath(Environment.SpecialFolder.StartMenu);
                var shortcutDir = Path.Combine(startMenu, "Programs", manifest.StartMenuFolder);
                Directory.CreateDirectory(shortcutDir);
                var shortcutPath = Path.Combine(shortcutDir, $"{manifest.StartMenuName}.lnk");

                var ps = Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -Command \"$ws = New-Object -ComObject WScript.Shell; " +
                        $"$s = $ws.CreateShortcut('{shortcutPath}'); " +
                        $"$s.TargetPath = '{exePath}'; " +
                        $"$s.Description = '{manifest.Name}'; " +
                        $"$s.WorkingDirectory = '{installPath}'; " +
                        $"$s.Save()\"",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
                ps?.WaitForExit(5000);
                Debug.WriteLine($"[WindowsApp] Created Start Menu shortcut: {shortcutPath}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WindowsApp] Start Menu shortcut failed: {ex.Message}");
            }
        }

        // 6. Launch the executable
        if (exePath != null && File.Exists(exePath))
        {
            try
            {
                Process.Start(new ProcessStartInfo { FileName = exePath, UseShellExecute = true });
                Debug.WriteLine($"[WindowsApp] Launched: {exePath}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[WindowsApp] Launch failed: {ex.Message}");
            }
        }
    }

    public async Task Uninstall(InstalledTool tool)
    {
        var manifest = tool.Manifest;

        // 1. Kill process
        if (manifest?.ProcessName != null)
        {
            foreach (var proc in Process.GetProcessesByName(manifest.ProcessName))
            {
                try { proc.Kill(); } catch { }
            }
            await Task.Delay(2000);
        }

        // 2. Remove auto-start
        if (manifest?.RegistryAutoStart != null)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run", true);
                key?.DeleteValue(manifest.RegistryAutoStart.Key, false);
            }
            catch { }
        }

        // 3. Remove protocol handler
        if (manifest?.ProtocolHandler != null)
        {
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(
                    $@"Software\Classes\{manifest.ProtocolHandler}", false);
            }
            catch { }
        }

        // 4. Remove Start Menu shortcut
        if (manifest?.StartMenuFolder != null && manifest?.StartMenuName != null)
        {
            try
            {
                var startMenu = Environment.GetFolderPath(Environment.SpecialFolder.StartMenu);
                var shortcutPath = Path.Combine(startMenu, "Programs",
                    manifest.StartMenuFolder, $"{manifest.StartMenuName}.lnk");
                if (File.Exists(shortcutPath)) File.Delete(shortcutPath);

                var dir = Path.Combine(startMenu, "Programs", manifest.StartMenuFolder);
                if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any())
                    Directory.Delete(dir);
            }
            catch { }
        }

        // 5. Delete install directory
        if (Directory.Exists(tool.InstallPath))
        {
            try { Directory.Delete(tool.InstallPath, true); }
            catch { }
        }
    }

    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
        foreach (var dir in Directory.GetDirectories(source))
            CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
    }
}
