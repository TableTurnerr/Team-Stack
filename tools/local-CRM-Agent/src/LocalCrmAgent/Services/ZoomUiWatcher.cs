using System.Diagnostics;
using LocalCrmAgent.Models;

namespace LocalCrmAgent.Services;

/// <summary>
/// UIAutomation-based per-device watcher for Zoom's Phone UI.
///
/// NOTE (disabled-by-default): In the agent process, the Zoom Workplace
/// UIA provider becomes pathologically slow under repeated cross-process
/// queries — a single tree walk can take 40+ seconds while blocking
/// Zoom's own UI thread, making the Phone dialer unusable. Because the
/// agent scans on a 500 ms cadence this quickly cascades into a frozen
/// Zoom app. Until we have a safe way to read the tree (e.g. out-of-
/// process via the zoom-uia-probe binary, or via the native
/// IUIAutomation COM interface with proper apartment isolation), this
/// watcher runs as a no-op: it never queries UIA, so it cannot hurt
/// Zoom. <see cref="CallStateFusion"/> falls back to WASAPI audio-flow
/// detection, which is sufficient to know when THIS device is on a
/// Zoom call (peak audio only flows during an actual call).
///
/// This stub still emits an empty <see cref="ZoomUiState"/> so the rest
/// of the system (fusion, WebSocket envelope, call-ownership context)
/// keeps the same contract it had when UIA was the primary signal.
/// </summary>
public class ZoomUiWatcher : IDisposable
{
    private readonly ZoomUiState _emptyState = new();

    public event Action<ZoomUiState>? StateChanged;

    public ZoomUiState CurrentState => _emptyState;

    public void Start()
    {
        Debug.WriteLine("[ZoomUi] watcher DISABLED (UIA stub — see ZoomUiWatcher.cs header)");
    }

    public void Stop() { }

    public void Dispose() { }
}
