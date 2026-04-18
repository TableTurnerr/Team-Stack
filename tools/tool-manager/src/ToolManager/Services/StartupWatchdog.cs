using System.Diagnostics;

namespace ToolManager.Services;

/// <summary>
/// Periodically re-applies the Tool Manager's auto-start preference so the
/// Run-key entry stays in sync with the current exe path. Repairs drift caused
/// by external cleanup utilities or Task Manager's startup toggle while the
/// manager is running. Respects the user's AutoStartEnabled setting — if the
/// user has disabled it, the watchdog will keep it disabled.
/// </summary>
public class StartupWatchdog : IDisposable
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);

    private readonly SettingsService _settings;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    public StartupWatchdog(SettingsService settings)
    {
        _settings = settings;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
    }

    private async Task Loop(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(CheckInterval, ct);
                if (_settings.ApplyAutoStart(_settings.Settings.AutoStartEnabled))
                    Debug.WriteLine("[StartupWatchdog] Run key drifted — re-applied.");
            }
        }
        catch (OperationCanceledException) { }
    }

    public void Dispose()
    {
        _cts?.Cancel();
        try { _loopTask?.Wait(3000); } catch { }
        _cts?.Dispose();
    }
}
