using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace LocalCrmAgent.Services;

/// <summary>
/// Monitors Zoom window titles to extract supplementary call info
/// (phone number, ringing state). Lightweight — no OCR or screenshots,
/// just Win32 GetWindowText.
/// </summary>
public partial class ZoomWindowMonitor
{
    // ── Win32 P/Invoke ──────────────────────────────────────────────

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    // ── Regex patterns ──────────────────────────────────────────────

    [GeneratedRegex(@"\b\+?1?\s*\(?(\d{3})\)?[\s\-\.]*(\d{3})[\s\-\.]*(\d{4})\b")]
    private static partial Regex UsPhoneRegex();

    [GeneratedRegex(@"\+\d{7,15}")]
    private static partial Regex InternationalPhoneRegex();

    [GeneratedRegex(@"\b(\d{1,2}):(\d{2})\b")]
    private static partial Regex TimerRegex();

    [GeneratedRegex(@"\bcalling\b", RegexOptions.IgnoreCase)]
    private static partial Regex CallingRegex();

    [GeneratedRegex(@"\bringing\b", RegexOptions.IgnoreCase)]
    private static partial Regex RingingRegex();

    [GeneratedRegex(@"\bincoming\b", RegexOptions.IgnoreCase)]
    private static partial Regex IncomingRegex();

    private static readonly string[] ZoomProcessNames =
        ["zoom", "cpthost", "zoomphone"];

    // ── Public API ──────────────────────────────────────────────────

    public class WindowInfo
    {
        public bool ZoomWindowFound { get; set; }
        public string WindowTitle { get; set; } = "";
        public bool IsCallingDetected { get; set; }
        public bool IsRingingDetected { get; set; }
        public bool IsIncomingDetected { get; set; }
        public bool IsTimerDetected { get; set; }
        public TimeSpan? DetectedTimer { get; set; }
        public string? DetectedPhoneNumber { get; set; }
    }

    /// <summary>
    /// Scan all visible Zoom windows and extract call-related info from titles.
    /// </summary>
    public WindowInfo GetZoomWindowInfo()
    {
        var result = new WindowInfo();
        var zoomTitles = new List<string>();

        try
        {
            EnumWindows((hWnd, _) =>
            {
                if (!IsWindowVisible(hWnd)) return true;

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

                int len = GetWindowTextLength(hWnd);
                if (len <= 0) return true;

                var sb = new StringBuilder(len + 1);
                GetWindowText(hWnd, sb, sb.Capacity);
                var title = sb.ToString();

                if (!string.IsNullOrWhiteSpace(title))
                {
                    zoomTitles.Add(title);
                    result.ZoomWindowFound = true;
                }

                return true; // continue enumeration
            }, IntPtr.Zero);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WindowMonitor] EnumWindows error: {ex.Message}");
        }

        // Analyze collected titles
        foreach (var title in zoomTitles)
        {
            // Phone number detection
            var usMatch = UsPhoneRegex().Match(title);
            if (usMatch.Success)
            {
                result.DetectedPhoneNumber = usMatch.Value.Trim();
            }
            else
            {
                var intlMatch = InternationalPhoneRegex().Match(title);
                if (intlMatch.Success)
                    result.DetectedPhoneNumber = intlMatch.Value.Trim();
            }

            // Timer detection (MM:SS format = active call)
            var timerMatch = TimerRegex().Match(title);
            if (timerMatch.Success)
            {
                result.IsTimerDetected = true;
                if (int.TryParse(timerMatch.Groups[1].Value, out int min)
                    && int.TryParse(timerMatch.Groups[2].Value, out int sec))
                {
                    result.DetectedTimer = new TimeSpan(0, min, sec);
                }
            }

            // Calling / ringing / incoming detection
            if (CallingRegex().IsMatch(title))
                result.IsCallingDetected = true;

            if (RingingRegex().IsMatch(title))
                result.IsRingingDetected = true;

            if (IncomingRegex().IsMatch(title))
                result.IsIncomingDetected = true;
        }

        return result;
    }
}
