namespace ToolManager.Models;

/// <summary>
/// Progress update during install/update/uninstall operations.
/// Percent is 0-100 during download, -1 for indeterminate phases (extracting, installing).
/// </summary>
public record InstallProgress(string Status, int Percent = -1);
