using System.Diagnostics;
using ToolManager.Models;

namespace ToolManager.Services.Handlers;

/// <summary>
/// Handles install/uninstall for chrome-extension type tools.
/// Silently extracts files — notifications are handled by the scheduler.
/// </summary>
public class ChromeExtensionHandler : IToolTypeHandler
{
    public string TypeName => "chrome-extension";

    public Task Install(string stagingPath, string installPath, ToolManifest manifest)
    {
        Directory.CreateDirectory(installPath);
        CopyDirectory(stagingPath, installPath);
        Debug.WriteLine($"[ChromeExt] Installed {manifest.Name} to {installPath}");
        return Task.CompletedTask;
    }

    public Task Uninstall(InstalledTool tool)
    {
        if (Directory.Exists(tool.InstallPath))
        {
            try { Directory.Delete(tool.InstallPath, true); }
            catch { }
        }
        Debug.WriteLine($"[ChromeExt] Uninstalled {tool.Name}");
        return Task.CompletedTask;
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
