using System.Diagnostics;
using System.Text.Json;
using Fleck;
using LocalCrmAgent.Models;

namespace LocalCrmAgent.Services;

/// <summary>
/// WebSocket server on localhost:9876 that broadcasts call state,
/// network quality, and heartbeat messages to connected CRM clients.
/// </summary>
public class AgentWebSocketServer : IDisposable
{
    private readonly CallStateFusion _fusion;
    private readonly NetworkMonitor _networkMonitor;
    private readonly ZoomAudioMonitor _audioMonitor;
    private AudioRecorderService? _recorder;
    private RecordingUploadService? _uploader;
    private RecordingStorageManager? _storage;
    private WebSocketServer? _server;
    private readonly List<IWebSocketConnection> _clients = [];
    private readonly object _clientLock = new();
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public int Port { get; }
    public int ConnectionCount
    {
        get { lock (_clientLock) return _clients.Count; }
    }

    public event Action<int>? ConnectionCountChanged;

    public AgentWebSocketServer(CallStateFusion fusion, NetworkMonitor networkMonitor, ZoomAudioMonitor audioMonitor, int port = 9876)
    {
        _fusion = fusion;
        _networkMonitor = networkMonitor;
        _audioMonitor = audioMonitor;
        Port = port;
    }

    /// <summary>
    /// Set recording services after construction (avoids circular dependency).
    /// </summary>
    public void SetRecordingServices(AudioRecorderService recorder, RecordingUploadService uploader, RecordingStorageManager storage)
    {
        _recorder = recorder;
        _uploader = uploader;
        _storage = storage;

        // Subscribe to recording events for broadcasting
        _recorder.StateChanged += OnRecordingStateChanged;
        _recorder.RecordingCompleted += OnRecordingCompleted;
        _uploader.UploadCompleted += OnUploadCompleted;
    }

    public void Start()
    {
        _server = new WebSocketServer($"ws://127.0.0.1:{Port}");
        _server.RestartAfterListenError = true;

        _server.Start(socket =>
        {
            socket.OnOpen = () =>
            {
                Debug.WriteLine($"[WS] Client connected: {socket.ConnectionInfo.ClientIpAddress}");
                lock (_clientLock) _clients.Add(socket);
                ConnectionCountChanged?.Invoke(ConnectionCount);

                // Send current state immediately on connect
                var stateMsg = CallStateMessage.From(_fusion.CurrentState);
                var json = JsonSerializer.Serialize(stateMsg, _jsonOptions);
                socket.Send(json);
            };

            socket.OnClose = () =>
            {
                Debug.WriteLine("[WS] Client disconnected");
                lock (_clientLock) _clients.Remove(socket);
                ConnectionCountChanged?.Invoke(ConnectionCount);
            };

            socket.OnError = ex =>
            {
                Debug.WriteLine($"[WS] Socket error: {ex.Message}");
                lock (_clientLock) _clients.Remove(socket);
                ConnectionCountChanged?.Invoke(ConnectionCount);
            };

            socket.OnMessage = msg =>
            {
                Debug.WriteLine($"[WS] Received: {msg}");
                _ = HandleClientMessage(msg, socket);
            };
        });

        // Subscribe to state changes
        _fusion.StateChanged += OnStateChanged;

        Debug.WriteLine($"[WS] Server started on ws://127.0.0.1:{Port}");
    }

    private async Task HandleClientMessage(string message, IWebSocketConnection client)
    {
        try
        {
            using var doc = JsonDocument.Parse(message);
            var type = doc.RootElement.GetProperty("type").GetString();

            switch (type)
            {
                case "launchZoom":
                    await HandleLaunchZoom(client);
                    break;
                case "checkZoom":
                    HandleCheckZoom(client);
                    break;
                case "startRecording":
                    HandleStartRecording(doc.RootElement);
                    break;
                case "stopRecording":
                    HandleStopRecording();
                    break;
                case "discardRecording":
                    HandleDiscardRecording();
                    break;
                case "setAutoRecord":
                    HandleSetAutoRecord(doc.RootElement);
                    break;
                case "getRecordingStatus":
                    HandleGetRecordingStatus(client);
                    break;
                case "linkRecording":
                    HandleLinkRecording(doc.RootElement);
                    break;
                case "uploadRecording":
                    HandleUploadRecording(doc.RootElement);
                    break;
                case "setUploadConfig":
                    HandleSetUploadConfig(doc.RootElement);
                    break;
                default:
                    Debug.WriteLine($"[WS] Unknown command type: {type}");
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WS] Error handling client message: {ex.Message}");
        }
    }

    private async Task HandleLaunchZoom(IWebSocketConnection client)
    {
        var (success, alreadyRunning, msg) = await _audioMonitor.LaunchZoom();
        var response = new ZoomActionMessage
        {
            Action = "launch",
            Success = success,
            ZoomRunning = success || alreadyRunning,
            Message = msg,
        };
        SendTo(client, response);
    }

    private void HandleCheckZoom(IWebSocketConnection client)
    {
        var isRunning = _audioMonitor.IsZoomRunning();
        var response = new ZoomActionMessage
        {
            Action = "check",
            Success = true,
            ZoomRunning = isRunning,
            Message = isRunning ? "Zoom is running" : "Zoom is not running",
        };
        SendTo(client, response);
    }

    // ─── Recording command handlers ───────────────────────────────────────

    private void HandleStartRecording(JsonElement root)
    {
        if (_recorder == null) return;
        var phone = root.TryGetProperty("phoneNumber", out var p) ? p.GetString() ?? "" : "";
        var (success, error) = _recorder.StartRecording(phone);
        Debug.WriteLine($"[WS] startRecording: success={success} error={error}");
    }

    private void HandleStopRecording()
    {
        _recorder?.StopRecording();
    }

    private void HandleDiscardRecording()
    {
        _recorder?.DiscardRecording();
    }

    private void HandleSetAutoRecord(JsonElement root)
    {
        if (_recorder == null) return;
        if (root.TryGetProperty("enabled", out var enabled))
            _recorder.AutoRecordEnabled = enabled.GetBoolean();
        if (root.TryGetProperty("onRinging", out var onRinging))
            _recorder.RecordOnRinging = onRinging.GetBoolean();
        Debug.WriteLine($"[WS] setAutoRecord: enabled={_recorder.AutoRecordEnabled} onRinging={_recorder.RecordOnRinging}");
    }

    private void HandleGetRecordingStatus(IWebSocketConnection client)
    {
        if (_recorder == null) return;
        var msg = BuildRecordingStateMessage();
        SendTo(client, msg);
    }

    private void HandleLinkRecording(JsonElement root)
    {
        if (_uploader == null) return;
        var fileName = root.TryGetProperty("fileName", out var f) ? f.GetString() : null;
        var callLogId = root.TryGetProperty("callLogId", out var c) ? c.GetString() : null;
        if (fileName != null && callLogId != null)
            _uploader.LinkRecording(fileName, callLogId);
    }

    private void HandleUploadRecording(JsonElement root)
    {
        if (_uploader == null) return;
        var fileName = root.TryGetProperty("fileName", out var f) ? f.GetString() : null;
        if (fileName != null)
            _uploader.EnqueueUpload(fileName);
    }

    private void HandleSetUploadConfig(JsonElement root)
    {
        if (_uploader == null) return;
        var url = root.TryGetProperty("pocketbaseUrl", out var u) ? u.GetString() : null;
        var token = root.TryGetProperty("authToken", out var t) ? t.GetString() : null;
        var uploader = root.TryGetProperty("uploaderId", out var i) ? i.GetString() : null;
        if (url != null && token != null && uploader != null)
            _uploader.SetAuth(url, token, uploader);
    }

    // ─── Recording event handlers → broadcast ─────────────────────────────

    private void OnRecordingStateChanged(RecordingState state, string? error)
    {
        var msg = BuildRecordingStateMessage();
        Broadcast(msg);
    }

    private void OnRecordingCompleted(string fileName, string phoneNumber, int duration, long fileSize, DateTime startTime)
    {
        var msg = new RecordingCompletedMessage
        {
            FileName = fileName,
            PhoneNumber = phoneNumber,
            Duration = duration,
            FileSizeBytes = fileSize,
            StartTime = startTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
        };
        Broadcast(msg);
    }

    private void OnUploadCompleted(string fileName, string? recordingId, string? callLogId, bool success, string? error)
    {
        var msg = new RecordingUploadedMessage
        {
            FileName = fileName,
            PocketbaseRecordingId = recordingId,
            CallLogId = callLogId,
            Success = success,
            Error = error,
        };
        Broadcast(msg);
    }

    private RecordingStateMessage BuildRecordingStateMessage()
    {
        return new RecordingStateMessage
        {
            State = _recorder?.CurrentState.ToString().ToLowerInvariant() ?? "idle",
            FileName = _recorder?.CurrentFileName,
            PhoneNumber = _recorder?.CurrentPhoneNumber,
            Duration = _recorder?.DurationSeconds ?? 0,
        };
    }

    /// <summary>
    /// Broadcast recording state — called periodically by AgentService during recording.
    /// </summary>
    public void BroadcastRecordingState()
    {
        if (_recorder?.CurrentState == RecordingState.Recording)
        {
            var msg = BuildRecordingStateMessage();
            Broadcast(msg);
        }
    }

    /// <summary>
    /// Broadcast upload queue status.
    /// </summary>
    public void BroadcastUploadQueueStatus()
    {
        if (_storage == null) return;
        var msg = new UploadQueueStatusMessage
        {
            PendingCount = _storage.PendingCount,
            FailedCount = _storage.FailedCount,
            CurrentUpload = _uploader?.CurrentUpload,
        };
        Broadcast(msg);
    }

    private void SendTo<T>(IWebSocketConnection client, T message) where T : AgentMessage
    {
        try
        {
            if (client.IsAvailable)
            {
                var json = JsonSerializer.Serialize(message, _jsonOptions);
                client.Send(json);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[WS] Error sending to client: {ex.Message}");
        }
    }

    private void OnStateChanged(CallStateInfo info)
    {
        var msg = CallStateMessage.From(info);
        Broadcast(msg);
    }

    /// <summary>
    /// Broadcast the current call state to all connected clients.
    /// Called periodically by AgentService for duration updates.
    /// </summary>
    public void BroadcastCurrentState()
    {
        var msg = CallStateMessage.From(_fusion.CurrentState);
        Broadcast(msg);
    }

    /// <summary>
    /// Broadcast network quality to all connected clients.
    /// </summary>
    public void BroadcastNetworkQuality()
    {
        var msg = _networkMonitor.GetNetworkQuality();
        Broadcast(msg);
    }

    /// <summary>
    /// Broadcast a heartbeat with agent metadata.
    /// </summary>
    public void BroadcastHeartbeat(int uptimeSeconds, bool zoomDetected)
    {
        var msg = new HeartbeatMessage
        {
            Uptime = uptimeSeconds,
            ZoomDetected = zoomDetected,
            ConnectedClients = ConnectionCount,
            IsRecording = _recorder?.CurrentState == RecordingState.Recording,
            RecordingDuration = _recorder?.DurationSeconds ?? 0,
            UploadsPending = _storage?.PendingCount ?? 0,
            UploadsFailed = _storage?.FailedCount ?? 0,
        };
        Broadcast(msg);
    }

    private void Broadcast<T>(T message) where T : AgentMessage
    {
        var json = JsonSerializer.Serialize(message, _jsonOptions);

        List<IWebSocketConnection> snapshot;
        lock (_clientLock) snapshot = [.. _clients];

        foreach (var client in snapshot)
        {
            try
            {
                if (client.IsAvailable)
                    client.Send(json);
            }
            catch
            {
                lock (_clientLock) _clients.Remove(client);
                ConnectionCountChanged?.Invoke(ConnectionCount);
            }
        }
    }

    public void Stop()
    {
        _fusion.StateChanged -= OnStateChanged;
        if (_recorder != null)
        {
            _recorder.StateChanged -= OnRecordingStateChanged;
            _recorder.RecordingCompleted -= OnRecordingCompleted;
        }
        if (_uploader != null)
        {
            _uploader.UploadCompleted -= OnUploadCompleted;
        }

        List<IWebSocketConnection> snapshot;
        lock (_clientLock)
        {
            snapshot = [.. _clients];
            _clients.Clear();
        }
        foreach (var c in snapshot)
            try { c.Close(); } catch { }

        _server?.Dispose();
        _server = null;
        Debug.WriteLine("[WS] Server stopped");
    }

    public void Dispose() => Stop();
}
