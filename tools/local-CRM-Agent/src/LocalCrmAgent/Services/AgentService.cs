using System.Diagnostics;
using LocalCrmAgent.Models;

namespace LocalCrmAgent.Services;

/// <summary>
/// Main orchestrator: runs the polling loop for audio/window/network
/// monitoring and coordinates WebSocket broadcasts.
/// </summary>
public class AgentService : IDisposable
{
    private readonly CallStateFusion _fusion;
    private readonly AgentWebSocketServer _wsServer;
    private readonly NetworkMonitor _networkMonitor;
    private readonly ZoomAudioMonitor _audioMonitor;
    private readonly AudioRecorderService? _recorder;
    private readonly RecordingUploadService? _uploader;
    private readonly MicrophoneManager? _micManager;

    private CancellationTokenSource? _cts;
    private Task? _broadcastTask;
    private Task? _networkTask;
    private readonly DateTime _startTime = DateTime.UtcNow;

    public event Action<int>? ConnectionCountChanged;

    public int ConnectionCount => _wsServer.ConnectionCount;
    public CallStateInfo CurrentState => _fusion.CurrentState;
    public bool IsRunning { get; private set; }

    public AgentService(
        CallStateFusion fusion,
        AgentWebSocketServer wsServer,
        NetworkMonitor networkMonitor,
        ZoomAudioMonitor audioMonitor,
        AudioRecorderService? recorder = null,
        RecordingUploadService? uploader = null,
        MicrophoneManager? micManager = null)
    {
        _fusion = fusion;
        _wsServer = wsServer;
        _networkMonitor = networkMonitor;
        _audioMonitor = audioMonitor;
        _recorder = recorder;
        _uploader = uploader;
        _micManager = micManager;

        _wsServer.ConnectionCountChanged += count =>
            ConnectionCountChanged?.Invoke(count);
    }

    public void Start()
    {
        if (IsRunning) return;
        IsRunning = true;
        _cts = new CancellationTokenSource();

        // Start core components
        _fusion.Start();
        _wsServer.Start();
        _uploader?.Start();
        _micManager?.StartMonitoring();

        // Start periodic broadcast (state updates + heartbeat)
        _broadcastTask = Task.Run(() => BroadcastLoop(_cts.Token));

        // Start network monitoring on separate cadence
        _networkTask = Task.Run(() => NetworkLoop(_cts.Token));

        Debug.WriteLine("[Agent] Service started");
    }

    /// <summary>
    /// Broadcasts call state every 1s (for duration updates) and
    /// heartbeat every 5s.
    /// </summary>
    private async Task BroadcastLoop(CancellationToken ct)
    {
        int tick = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Every second: broadcast current call state (for live duration)
                if (_fusion.CurrentState.State == CallState.Connected)
                    _wsServer.BroadcastCurrentState();

                // Every second: broadcast recording state (for live duration)
                _wsServer.BroadcastRecordingState();

                // Every 5 seconds: heartbeat
                if (tick % 5 == 0)
                {
                    var uptime = (int)(DateTime.UtcNow - _startTime).TotalSeconds;
                    var zoomDetected = _audioMonitor.IsZoomRunning();
                    _wsServer.BroadcastHeartbeat(uptime, zoomDetected);
                }

                // Every 10 seconds: upload queue status
                if (tick % 10 == 0 && _wsServer.ConnectionCount > 0)
                    _wsServer.BroadcastUploadQueueStatus();

                tick++;
                await Task.Delay(1000, ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Agent] Broadcast error: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Network quality measurement every 3 seconds, broadcast every 10s.
    /// </summary>
    private async Task NetworkLoop(CancellationToken ct)
    {
        int tick = 0;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                _networkMonitor.Measure();

                // Broadcast network quality every 10 seconds
                if (tick % 3 == 0 && _wsServer.ConnectionCount > 0)
                    _wsServer.BroadcastNetworkQuality();

                tick++;
                await Task.Delay(3000, ct);
            }
            catch (OperationCanceledException) { break; }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Agent] Network monitor error: {ex.Message}");
            }
        }
    }

    public void Stop()
    {
        if (!IsRunning) return;
        IsRunning = false;

        _cts?.Cancel();
        try { Task.WhenAll(_broadcastTask ?? Task.CompletedTask, _networkTask ?? Task.CompletedTask).Wait(3000); }
        catch { }

        _micManager?.Dispose();
        _recorder?.Dispose();
        _uploader?.Stop();
        _wsServer.Stop();
        _fusion.Stop();
        _cts?.Dispose();
        _cts = null;

        Debug.WriteLine("[Agent] Service stopped");
    }

    public void Dispose() => Stop();
}
