using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;

namespace LocalCrmAgent.Services;

/// <summary>
/// Controls Zoom Phone calls.
/// Dial: local zoomphonecall: protocol (launches on THIS machine only).
/// End/DTMF: Zoom Phone REST API via ZoomPhoneApiService.
/// Call detection: WASAPI audio (handled by CallStateFusion, not here).
/// Recording: our own WASAPI recorder (not Zoom's recording feature).
/// </summary>
public partial class ZoomCallController
{
    private readonly ZoomWindowSuppressor _suppressor;
    private readonly ZoomWindowMonitor _windowMonitor;
    private ZoomPhoneApiService? _api;

    public ZoomCallController(ZoomWindowSuppressor suppressor, ZoomWindowMonitor windowMonitor)
    {
        _suppressor = suppressor;
        _windowMonitor = windowMonitor;
    }

    public void SetApiService(ZoomPhoneApiService api) => _api = api;

    // ── Dial (local protocol — only triggers on THIS machine) ────────

    private static string? FindZoomExePath()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var standardPath = Path.Combine(appData, "Zoom", "bin", "Zoom.exe");
        if (File.Exists(standardPath))
            return standardPath;

        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                @"Software\Classes\ZoomPbx.zoomphonecall\shell\open\command");
            var cmd = key?.GetValue("") as string;
            if (cmd != null)
            {
                var match = Regex.Match(cmd, "\"([^\"]+)\"");
                if (match.Success && File.Exists(match.Groups[1].Value))
                    return match.Groups[1].Value;
            }
        }
        catch { /* ignore */ }

        return null;
    }

    public async Task<(bool Success, string? Error)> DialAsync(string phoneNumber)
    {
        try
        {
            var cleaned = new string(phoneNumber.Where(c => char.IsDigit(c) || c == '+' || c == '*' || c == '#').ToArray());
            if (cleaned.Length < 3) return (false, "Phone number too short");
            if (!cleaned.StartsWith('+')) cleaned = "+" + cleaned;

            Debug.WriteLine($"[CallController] Dialing: {cleaned}");
            _suppressor.ActivateBurstMode();

            var zoomExe = FindZoomExePath();
            if (zoomExe != null)
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = zoomExe,
                    Arguments = $"--url=zoomphonecall:{cleaned}",
                    UseShellExecute = false,
                });
                Debug.WriteLine($"[CallController] Launched Zoom.exe directly for: {cleaned}");
            }
            else
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = $"zoomphonecall:{cleaned}",
                    UseShellExecute = true,
                });
                Debug.WriteLine($"[CallController] Launched via zoomphonecall: protocol for: {cleaned}");
            }

            await Task.Delay(200);
            return (true, null);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CallController] Dial error: {ex.Message}");
            return (false, ex.Message);
        }
    }

    // ── End Call (Zoom API) ──────────────────────────────────────────

    public async Task<(bool Success, string? Error)> EndCallAsync(string? currentPhoneNumber = null)
    {
        if (_api == null || !_api.IsConfigured)
            return (false, "Zoom API not configured — set credentials in agent config");

        Debug.WriteLine($"[CallController] Ending call via Zoom API (phone: {currentPhoneNumber ?? "unknown"})");
        return await _api.EndCallByPhoneNumberAsync(currentPhoneNumber);
    }

}
