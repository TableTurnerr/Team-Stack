namespace CallRecorder.Core.Models;

/// <summary>
/// Represents a window that can be captured
/// </summary>
public class WindowInfo
{
    public IntPtr Handle { get; set; }
    public string Title { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public int ProcessId { get; set; }
    public bool IsVisible { get; set; }
    public bool IsMinimized { get; set; }
    
    public override string ToString() => $"{Title} ({ProcessName})";
}
