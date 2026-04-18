using System.Diagnostics;

namespace LocalCrmAgent.Services;

/// <summary>
/// Periodically verifies the Run-key and protocol-handler entries still point
/// to this exe. Repairs them if an external process (Task Manager startup tab,
/// group policy, cleanup utility, etc.) removed or changed them while the
/// agent was running.
/// </summary>
public class StartupWatchdog : IDisposable
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);

    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
    }

    private static async Task Loop(CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(CheckInterval, ct);
                if (StartupRegistrar.EnsureAutoStart())
                    Debug.WriteLine("[StartupWatchdog] Run key drifted — re-registered.");
                if (StartupRegistrar.EnsureProtocolHandler())
                    Debug.WriteLine("[StartupWatchdog] Protocol handler drifted — re-registered.");
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
