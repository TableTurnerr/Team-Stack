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

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    // Class of the separate top-level window Zoom shows while an inbound
    // call is ringing. The window title format is:
    //   "nooh@tableturnerr.com 8 0 2  is calling you…"
    // i.e. "{CallerName} {CallerNumberSpaced} is calling you…". We can
    // read it via Win32 GetWindowText without ever touching UIA.
    private const string IncomingRingClassName = "SipCallNormalIncomingCallWindow";

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

        /// <summary>
        /// True when a visible SipCallNormalIncomingCallWindow was seen —
        /// this is the deterministic "this device is ringing" signal.
        /// </summary>
        public bool IncomingRingWindowVisible { get; set; }

        /// <summary>
        /// Raw title of the incoming-ring window (if visible). Format:
        /// "{callerName} {spaced-digits} is calling you…".
        /// </summary>
        public string? IncomingRingWindowTitle { get; set; }

        /// <summary>Phone number parsed out of the incoming-ring window title.</summary>
        public string? IncomingRingCallerNumber { get; set; }
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

                // Read window class so we can special-case the incoming-call
                // ringing window. Win32 class names are cheap and don't
                // involve UIA.
                var clsBuf = new StringBuilder(128);
                GetClassName(hWnd, clsBuf, clsBuf.Capacity);
                string windowClass = clsBuf.ToString();

                int len = GetWindowTextLength(hWnd);
                string title = "";
                if (len > 0)
                {
                    var sb = new StringBuilder(len + 1);
                    GetWindowText(hWnd, sb, sb.Capacity);
                    title = sb.ToString();
                }

                if (string.Equals(windowClass, IncomingRingClassName, StringComparison.OrdinalIgnoreCase))
                {
                    result.IncomingRingWindowVisible = true;
                    result.IncomingRingWindowTitle = title;
                    result.IncomingRingCallerNumber = ExtractIncomingRingNumber(title);
                    result.ZoomWindowFound = true;
                }
                else if (!string.IsNullOrWhiteSpace(title))
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

        // If we saw an incoming-ring window, lift its signals into the
        // legacy flags so existing fusion logic picks them up.
        if (result.IncomingRingWindowVisible)
        {
            result.IsIncomingDetected = true;
            result.IsRingingDetected = true;
            if (!string.IsNullOrEmpty(result.IncomingRingCallerNumber))
                result.DetectedPhoneNumber = result.IncomingRingCallerNumber;
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

    /// <summary>
    /// Parse an incoming-ring window title like:
    ///   "nooh@tableturnerr.com 8 0 2  is calling you…"
    ///   "+1  (6 3 1 ) 7 9 1 -8 3 7 8  is calling you…"
    /// Zoom inserts single spaces between digits in these titles, so the
    /// generic US/international phone regexes don't match. We strip the
    /// "is calling you" trailing phrase, then collect all digits + leading
    /// "+" as the number. If we find ≥3 digits that's the caller number.
    /// </summary>
    internal static string? ExtractIncomingRingNumber(string? title)
    {
        if (string.IsNullOrWhiteSpace(title)) return null;
        // Everything before "is calling" is the caller identity line.
        var idx = title.IndexOf(" is calling", StringComparison.OrdinalIgnoreCase);
        var identity = idx >= 0 ? title[..idx] : title;

        // An identity line can be:
        //   "nooh@tableturnerr.com 8 0 2"  (name + extension digits)
        //   "+1  (6 3 1 ) 7 9 1 -8 3 7 8"  (E.164-ish spaced digits)
        //   "Jane Doe"                     (contact name, no number)
        // We keep only digit characters and a single leading "+".
        var sb = new StringBuilder();
        bool seenPlus = false;
        foreach (var c in identity)
        {
            if (c == '+' && sb.Length == 0 && !seenPlus)
            {
                sb.Append('+');
                seenPlus = true;
            }
            else if (char.IsDigit(c))
            {
                sb.Append(c);
            }
            // Everything else (spaces, punctuation, letters) is dropped.
        }
        // Require at least 3 digits so we don't return noise from name-only identities.
        int digitCount = 0;
        for (int i = 0; i < sb.Length; i++) if (char.IsDigit(sb[i])) digitCount++;
        if (digitCount < 3) return null;
        return sb.ToString();
    }
}
