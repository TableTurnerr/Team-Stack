namespace ToolManager.Models;

/// <summary>
/// Progress update during install/update/uninstall operations.
/// Percent is 0-100 during download, -1 for indeterminate phases (extracting, installing).
/// BytesDownloaded/TotalBytes are populated only during download phases so the UI
/// can render byte-accurate progress, transfer speed, and ETA.
/// </summary>
public record InstallProgress(
    string Status,
    int Percent = -1,
    long? BytesDownloaded = null,
    long? TotalBytes = null);
