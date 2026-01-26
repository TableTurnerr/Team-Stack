namespace CallRecorder.Core.Models;

/// <summary>
/// Application configuration stored per-user
/// </summary>
public class AppConfig
{
    // Recording settings
    public bool AutoRecordOnCall { get; set; } = false;
    public int PostCallCountdownSeconds { get; set; } = 10;
    
    // Sidebar settings
    public SidebarPosition SidebarPosition { get; set; } = SidebarPosition.Right;
    public bool SidebarDocked { get; set; } = true;
    public double SidebarX { get; set; }
    public double SidebarY { get; set; }
    public double SidebarWidth { get; set; } = 320;
    public double SidebarHeight { get; set; } = 600;
    
    // Audio settings
    public int AudioBitrate { get; set; } = 128;
    public string? SelectedMicrophoneId { get; set; }
    public string? SelectedLoopbackId { get; set; }
    
    // Window settings
    public string? LastSelectedWindowTitle { get; set; }
    
    // Storage
    public string LocalStoragePath { get; set; } = 
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CallRecorder", "Recordings");
    
    // API
    public string? PocketBaseUrl { get; set; }
    public string? AuthToken { get; set; }
    public string? UserId { get; set; }
    public string? UserName { get; set; }
}

public enum SidebarPosition
{
    Left,
    Right,
    Floating
}
