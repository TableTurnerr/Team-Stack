namespace ToolManager.Models;

/// <summary>
/// Represents a single release version of a tool from GitHub Releases.
/// Used to support installing older versions and viewing release history.
/// </summary>
public class ReleaseVersion
{
    public Version Version { get; set; } = new(0, 0, 0);
    public string DownloadUrl { get; set; } = "";
    public string? ReleaseBody { get; set; }
    public DateTime? PublishedAt { get; set; }
    public string TagName { get; set; } = "";
}
