using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace LocalCrmAgent.Services;

/// <summary>
/// When enabled, continuously monitors for Zoom windows and forces them
/// to stay minimized. This prevents the Zoom dialer from stealing focus
/// when calls are initiated from the CRM dashboard.
/// </summary>
public class ZoomWindowSuppressor : IDisposable
{
    // ── Win32 P/Invoke ──────────────────────────────────────────────

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    private const int SW_MINIMIZE = 6;

    private static readonly string[] ZoomProcessNames =
        ["zoom", "cpthost", "zoomphone"];

    private readonly System.Threading.Timer _pollTimer;
    private volatile bool _enabled;
    private bool _disposed;

    public bool Enabled
    {
        get => _enabled;
        set
        {
            if (_enabled == value) return;
            _enabled = value;
            Debug.WriteLine($"[ZoomSuppressor] {(value ? "Enabled" : "Disabled")}");
            EnabledChanged?.Invoke(value);
        }
    }

    public event Action<bool>? EnabledChanged;

    public ZoomWindowSuppressor()
    {
        // Poll every 500ms — fast enough to catch Zoom before user notices
        _pollTimer = new System.Threading.Timer(PollAndMinimize, null, Timeout.Infinite, Timeout.Infinite);
    }

    public void Start()
    {
        _pollTimer.Change(0, 500);
    }

    private void PollAndMinimize(object? state)
    {
        if (!_enabled) return;

        try
        {
            EnumWindows((hWnd, _) =>
            {
                if (!IsWindowVisible(hWnd)) return true;
                if (IsIconic(hWnd)) return true; // already minimized

                GetWindowThreadProcessId(hWnd, out uint pid);
                if (pid == 0) return true;

                string processName;
                try
                {
                    using var proc = Process.GetProcessById((int)pid);
                    processName = proc.ProcessName;
                }
                catch { return true; }

                if (!ZoomProcessNames.Any(z =>
                    processName.Contains(z, StringComparison.OrdinalIgnoreCase)))
                    return true;

                // Skip windows without a title (invisible helper windows)
                int len = GetWindowTextLength(hWnd);
                if (len <= 0) return true;

                ShowWindow(hWnd, SW_MINIMIZE);
                Debug.WriteLine($"[ZoomSuppressor] Minimized Zoom window (pid={pid})");

                return true; // continue enumeration
            }, IntPtr.Zero);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomSuppressor] Poll error: {ex.Message}");
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _pollTimer.Change(Timeout.Infinite, Timeout.Infinite);
        _pollTimer.Dispose();
    }
}
