namespace ToolManager.Models;

/// <summary>
/// Represents a discovered tool from GitHub Releases — used as the display model for the UI.
/// </summary>
public class ToolInfo
{
    public string TagPrefix { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string? Description { get; set; }
    public string ToolType { get; set; } = "unknown";
    public Version LatestVersion { get; set; } = new(0, 0, 0);
    public string LatestDownloadUrl { get; set; } = "";
    public string? ReleaseBody { get; set; }
    public bool IsInstalled { get; set; }
    public Version? InstalledVersion { get; set; }
    public string? InstallPath { get; set; }
    public bool UpdateAvailable => IsInstalled && InstalledVersion != null && LatestVersion > InstalledVersion;
}
