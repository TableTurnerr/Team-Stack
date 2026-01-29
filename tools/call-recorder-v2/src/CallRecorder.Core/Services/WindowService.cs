using System.Diagnostics;
using System.Runtime.InteropServices;
using CallRecorder.Core.Models;

namespace CallRecorder.Core.Services;

/// <summary>
/// Service for enumerating and managing windows
/// </summary>
public class WindowService
{
    #region Win32 API
    
    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);
    
    [DllImport("user32.dll")]
    private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);
    
    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
    
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();
    
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int dwAttribute, out bool pvAttribute, int cbAttribute);
    
    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    
    private const int DWMWA_CLOAKED = 14;
    
    #endregion
    
    /// <summary>
    /// Gets all visible windows that can be captured
    /// </summary>
    public List<WindowInfo> GetAllWindows()
    {
        var windows = new List<WindowInfo>();
        
        EnumWindows((hWnd, lParam) =>
        {
            if (!IsWindowVisible(hWnd))
                return true;
            
            // Skip cloaked windows (UWP apps that are hidden)
            if (DwmGetWindowAttribute(hWnd, DWMWA_CLOAKED, out bool isCloaked, sizeof(int)) == 0 && isCloaked)
                return true;
            
            var titleLength = GetWindowTextLength(hWnd);
            if (titleLength == 0)
                return true;
            
            var titleBuilder = new System.Text.StringBuilder(titleLength + 1);
            GetWindowText(hWnd, titleBuilder, titleBuilder.Capacity);
            var title = titleBuilder.ToString();
            
            // Skip empty titles
            if (string.IsNullOrWhiteSpace(title))
                return true;
            
            // Get process info
            GetWindowThreadProcessId(hWnd, out uint processId);
            string processName = "";
            try
            {
                var process = Process.GetProcessById((int)processId);
                processName = process.ProcessName;
            }
            catch
            {
                // Process may have exited
            }
            
            windows.Add(new WindowInfo
            {
                Handle = hWnd,
                Title = title,
                ProcessName = processName,
                ProcessId = (int)processId,
                IsVisible = true,
                IsMinimized = IsIconic(hWnd)
            });
            
            return true;
        }, IntPtr.Zero);
        
        // Sort by title
        return windows.OrderBy(w => w.Title).ToList();
    }
    
    /// <summary>
    /// Gets windows that could be Zoom Phone
    /// </summary>
    public List<WindowInfo> GetZoomWindows()
    {
        return GetAllWindows()
            .Where(w => w.ProcessName.Contains("Zoom", StringComparison.OrdinalIgnoreCase) ||
                       w.Title.Contains("Zoom", StringComparison.OrdinalIgnoreCase))
            .ToList();
    }
    
    /// <summary>
    /// Checks if a window is still valid and visible
    /// </summary>
    public bool IsWindowValid(IntPtr handle)
    {
        return IsWindowVisible(handle);
    }
    
    /// <summary>
    /// Checks if a window is minimized
    /// </summary>
    public bool IsWindowMinimized(IntPtr handle)
    {
        return IsIconic(handle);
    }
    
    /// <summary>
    /// Gets the currently focused window
    /// </summary>
    public IntPtr GetFocusedWindow()
    {
        return GetForegroundWindow();
    }
}
