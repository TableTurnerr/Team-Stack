using System.Diagnostics;
using Microsoft.Win32;
using ToolManager.Models;

namespace ToolManager.Services.Handlers;

/// <summary>
/// Handles install/uninstall for windows-app type tools.
/// </summary>
public class WindowsAppHandler : IToolTypeHandler
{
    public string TypeName => "windows-app";

    public async Task Install(string stagingPath, string installPath, ToolManifest manifest)
    {
        // 1. Kill existing process(es) and let the OS release file handles.
        //    A running self-contained app (e.g. the CRM agent) keeps its exe/DLLs
        //    locked; Windows can hold those handles for a moment after the process
        //    exits, so give it a beat before copying (see CopyFileWithRetry).
        if (!string.IsNullOrEmpty(manifest.ProcessName))
        {
            foreach (var proc in Process.GetProcessesByName(manifest.ProcessName))
            {
                using (proc)
                {
                    try { proc.Kill(); proc.WaitForExit(5000); } catch { }
                }
            }
            await Task.Delay(1500);
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
                if (manifest.RegistryAutoStart.Args != null)
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

                // Escape single quotes for PowerShell
                var psShortcut = shortcutPath.Replace("'", "''");
                var psExe = exePath.Replace("'", "''");
                var psName = (manifest.Name ?? "").Replace("'", "''");
                var psInstall = installPath.Replace("'", "''");

                using var ps = Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -Command \"$ws = New-Object -ComObject WScript.Shell; " +
                        $"$s = $ws.CreateShortcut('{psShortcut}'); " +
                        $"$s.TargetPath = '{psExe}'; " +
                        $"$s.Description = '{psName}'; " +
                        $"$s.WorkingDirectory = '{psInstall}'; " +
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

        // 6. Launch the executable (with the same args it auto-starts with, e.g. --background)
        if (exePath != null && File.Exists(exePath))
        {
            try
            {
                var psi = new ProcessStartInfo { FileName = exePath, UseShellExecute = true };
                if (!string.IsNullOrEmpty(manifest.RegistryAutoStart?.Args))
                    psi.Arguments = manifest.RegistryAutoStart.Args;
                using var _ = Process.Start(psi);
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
                using (proc)
                {
                    try { proc.Kill(); proc.WaitForExit(3000); } catch { }
                }
            }
            await Task.Delay(1000);
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
            CopyFileWithRetry(file, Path.Combine(dest, Path.GetFileName(file)));
        foreach (var dir in Directory.GetDirectories(source))
            CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
    }

    /// <summary>
    /// Copy a file, retrying briefly if the destination is locked. When updating a
    /// running app, Windows can keep the old exe/DLL handles open for a moment after
    /// the process exits; a single File.Copy would throw and abort the whole update,
    /// leaving the tool half-replaced. Mirrors the retry the agent's own updater uses.
    /// </summary>
    private static void CopyFileWithRetry(string source, string dest, int attempts = 6)
    {
        for (int attempt = 1; ; attempt++)
        {
            try
            {
                File.Copy(source, dest, true);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException && attempt < attempts)
            {
                Debug.WriteLine($"[WindowsApp] Copy locked ({Path.GetFileName(dest)}), retry {attempt}: {ex.Message}");
                Thread.Sleep(500);
            }
        }
    }
}
