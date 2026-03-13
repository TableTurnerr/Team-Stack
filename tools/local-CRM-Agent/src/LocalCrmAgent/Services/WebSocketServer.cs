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
