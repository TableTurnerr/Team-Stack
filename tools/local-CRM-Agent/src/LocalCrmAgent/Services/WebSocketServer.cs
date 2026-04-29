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
    private MicrophoneManager? _micManager;
    private ZoomWindowSuppressor? _zoomSuppressor;
    private ZoomCallController? _callController;
    private ZoomPhoneApiService? _zoomApi;
    private DialIntentTracker? _intentTracker;
    private AgentConfig? _config;
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
        _recorder.RecordingConverted += OnRecordingConverted;
        _uploader.UploadCompleted += OnUploadCompleted;
        _uploader.UploadProgress += OnUploadProgress;
    }

    /// <summary>
    /// Set zoom window suppressor for keep-minimized toggle.
    /// </summary>
    public void SetZoomSuppressor(ZoomWindowSuppressor suppressor)
    {
        _zoomSuppressor = suppressor;
    }

    /// <summary>
    /// Set call controller for dial/end/answer commands.
    /// </summary>
    public void SetCallController(ZoomCallController controller)
    {
        _callController = controller;
    }

    public void SetZoomApi(ZoomPhoneApiService api)
    {
        _zoomApi = api;
    }

    /// <summary>
    /// Wire the dial-intent tracker so dashboard-issued intents can be
    /// correlated to the Zoom UI active-call appearance during fusion.
    /// </summary>
    public void SetDialIntentTracker(DialIntentTracker tracker)
    {
        _intentTracker = tracker;
    }

    /// <summary>
    /// Wire the persisted agent config so command handlers can save toggle
    /// + auth changes back to disk for survival across restarts.
    /// </summary>
    public void SetAgentConfig(AgentConfig config)
    {
        _config = config;
    }

    /// <summary>
    /// Set microphone manager for device selection and alerts.
    /// </summary>
    public void SetMicrophoneManager(MicrophoneManager micManager)
    {
        _micManager = micManager;

        _micManager.DeviceSwitched += info =>
        {
            var msg = new MicrophoneChangedMessage
            {
                Device = ToDto(info),
                Reason = micManager.IsManualSelection ? "manual" : "auto",
            };
            Broadcast(msg);
        };

        _micManager.MicAlert += alertMessage =>
        {
            var msg = new MicrophoneAlertMessage { Message = alertMessage };
            Broadcast(msg);
        };

        _micManager.DeviceListChanged += () =>
        {
            BroadcastMicrophoneList();
        };
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
                case "forceStartRecording":
                    HandleForceStartRecording(doc.RootElement);
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
                case "linkRecordingByClientId":
                    HandleLinkRecordingByClientId(doc.RootElement);
                    break;
                case "uploadRecording":
                    HandleUploadRecording(doc.RootElement);
                    break;
                case "cancelPendingUploads":
                    HandleCancelPendingUploads(doc.RootElement);
                    break;
                case "retryAllUploads":
                    HandleRetryAllUploads();
                    break;
                case "getFailedUploads":
                    HandleGetFailedUploads(client);
                    break;
                case "setUploadConfig":
                    HandleSetUploadConfig(doc.RootElement);
                    break;
                case "getMicrophones":
                    HandleGetMicrophones(client);
                    break;
                case "setMicrophone":
                    HandleSetMicrophone(doc.RootElement);
                    break;
                case "setKeepZoomMinimized":
                    HandleSetKeepZoomMinimized(doc.RootElement);
                    break;
                case "getKeepZoomMinimized":
                    HandleGetKeepZoomMinimized(client);
                    break;
                case "dial":
                    await HandleDial(doc.RootElement, client);
                    break;
                case "dialIntent":
                    HandleDialIntent(doc.RootElement);
                    break;
                case "getDeviceId":
                    HandleGetDeviceId(client);
                    break;
                case "endCall":
                    await HandleEndCall(client);
                    break;
                case "setZoomApiConfig":
                    HandleSetZoomApiConfig(doc.RootElement);
                    break;
                case "getLocalRecording":
                    HandleGetLocalRecording(doc.RootElement, client);
                    break;
                case "getUnlinkedRecordings":
                    HandleGetUnlinkedRecordings(client);
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

    private void HandleForceStartRecording(JsonElement root)
    {
        if (_recorder == null) return;
        var phone = root.TryGetProperty("phoneNumber", out var p) ? p.GetString() ?? "" : "";
        var (success, error) = _recorder.StartRecording(phone);
        Debug.WriteLine($"[WS] forceStartRecording: success={success} error={error}");
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

        if (_config != null)
        {
            _config.AutoRecordEnabled = _recorder.AutoRecordEnabled;
            _config.RecordOnRinging = _recorder.RecordOnRinging;
            _config.Save();
        }
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
        var recordingId = root.TryGetProperty("recordingId", out var r) ? r.GetString() : null;
        if (callLogId != null && (fileName != null || recordingId != null))
            _uploader.LinkRecording(fileName, callLogId, recordingId);
    }

    // Preferred linking path: dashboard sends the per-call clientCallId it
    // generated at dial time, agent finds the matching recording (stamped
    // with the same id) and links it. Eliminates the global-latest-recording
    // race that mis-attributes recordings when MP3 conversion lags.
    private void HandleLinkRecordingByClientId(JsonElement root)
    {
        if (_uploader == null) return;
        var clientCallId = root.TryGetProperty("clientCallId", out var c) ? c.GetString() : null;
        var callLogId = root.TryGetProperty("callLogId", out var l) ? l.GetString() : null;
        if (!string.IsNullOrEmpty(clientCallId) && !string.IsNullOrEmpty(callLogId))
            _uploader.LinkRecordingByClientCallId(clientCallId!, callLogId!);
    }

    private void HandleUploadRecording(JsonElement root)
    {
        if (_uploader == null) return;
        var fileName = root.TryGetProperty("fileName", out var f) ? f.GetString() : null;
        if (fileName != null)
            _uploader.EnqueueUpload(fileName);
    }

    private void HandleRetryAllUploads()
    {
        if (_uploader == null) return;
        _uploader.RetryAll();
        Debug.WriteLine("[WS] retryAllUploads: reset all failed entries");
        BroadcastUploadQueueStatus();
    }

    private void HandleGetFailedUploads(IWebSocketConnection client)
    {
        var msg = new FailedUploadsMessage();
        if (_uploader == null) { SendTo(client, msg); return; }

        foreach (var e in _uploader.GetFailedUploads())
        {
            msg.Uploads.Add(new FailedUploadDto
            {
                FileName = e.FileName,
                PhoneNumber = e.PhoneNumber,
                Error = e.Error,
                RetryCount = e.RetryCount,
                CallLogId = e.CallLogId,
            });
        }
        SendTo(client, msg);
    }

    private void HandleCancelPendingUploads(JsonElement root)
    {
        if (_storage == null) return;

        List<string>? callLogIds = null;
        if (root.TryGetProperty("callLogIds", out var idsProp) && idsProp.ValueKind == JsonValueKind.Array)
        {
            callLogIds = new List<string>();
            foreach (var item in idsProp.EnumerateArray())
            {
                var id = item.GetString();
                if (!string.IsNullOrEmpty(id)) callLogIds.Add(id);
            }
        }

        var count = _storage.CancelPending(callLogIds);
        Debug.WriteLine($"[WS] cancelPendingUploads: cancelled {count} entries (filter={(callLogIds == null || callLogIds.Count == 0 ? "all" : $"{callLogIds.Count} ids")})");

        // Push updated queue state immediately so the UI reflects the cancellation
        // without waiting for the 10-second broadcast tick.
        BroadcastUploadQueueStatus();
    }

    private void HandleSetUploadConfig(JsonElement root)
    {
        if (_uploader == null) return;
        var url = root.TryGetProperty("pocketbaseUrl", out var u) ? u.GetString() : null;
        var token = root.TryGetProperty("authToken", out var t) ? t.GetString() : null;
        var uploader = root.TryGetProperty("uploaderId", out var i) ? i.GetString() : null;
        if (url != null && token != null && uploader != null)
        {
            _uploader.SetAuth(url, token, uploader);
            _config?.SetAuth(url, token, uploader);
            _config?.Save();
        }
    }

    // ─── Microphone command handlers ────────────────────────────────────────

    private void HandleGetMicrophones(IWebSocketConnection client)
    {
        if (_micManager == null) return;
        var devices = _micManager.GetDevices();
        var msg = new MicrophoneListMessage
        {
            Devices = devices.Select(ToDto).ToList(),
        };
        SendTo(client, msg);
    }

    private void HandleSetMicrophone(JsonElement root)
    {
        if (_micManager == null) return;

        // null or empty deviceId = revert to system default
        string? deviceId = root.TryGetProperty("deviceId", out var d) ? d.GetString() : null;
        if (string.IsNullOrEmpty(deviceId)) deviceId = null;

        _micManager.SetDevice(deviceId);
        Debug.WriteLine($"[WS] setMicrophone: {deviceId ?? "(default)"}");
    }

    // ─── Zoom suppressor command handlers ──────────────────────────────────

    private void HandleSetKeepZoomMinimized(JsonElement root)
    {
        if (_zoomSuppressor == null) return;
        if (root.TryGetProperty("enabled", out var enabled))
        {
            _zoomSuppressor.Enabled = enabled.GetBoolean();
            Debug.WriteLine($"[WS] setKeepZoomMinimized: {_zoomSuppressor.Enabled}");
        }
    }

    private void HandleGetKeepZoomMinimized(IWebSocketConnection client)
    {
        var msg = new KeepZoomMinimizedMessage
        {
            Enabled = _zoomSuppressor?.Enabled ?? false,
        };
        SendTo(client, msg);
    }

    /// <summary>Broadcast the current microphone device list to all clients.</summary>
    public void BroadcastMicrophoneList()
    {
        if (_micManager == null) return;
        var devices = _micManager.GetDevices();
        var msg = new MicrophoneListMessage
        {
            Devices = devices.Select(ToDto).ToList(),
        };
        Broadcast(msg);
    }

    private static MicDeviceDto ToDto(MicDeviceInfo info) => new()
    {
        DeviceId = info.DeviceId,
        Name = info.Name,
        IsDefault = info.IsDefault,
        IsSelected = info.IsSelected,
        PeakLevel = info.PeakLevel,
    };

    // ─── Recording event handlers → broadcast ─────────────────────────────

    private void OnRecordingStateChanged(RecordingState state, string? error)
    {
        var msg = BuildRecordingStateMessage();
        Broadcast(msg);
    }

    private void OnRecordingCompleted(string recordingId, string fileName, string phoneNumber, int duration, long fileSize, DateTime startTime, string? clientCallId)
    {
        var msg = new RecordingCompletedMessage
        {
            RecordingId = recordingId,
            FileName = fileName,
            PhoneNumber = phoneNumber,
            Duration = duration,
            FileSizeBytes = fileSize,
            StartTime = startTime.ToString("yyyy-MM-ddTHH:mm:ss.fffZ"),
            ClientCallId = clientCallId,
        };
        Broadcast(msg);
    }

    private void OnRecordingConverted(string recordingId, string fileName, int duration, long fileSize)
    {
        var msg = new RecordingConvertedMessage
        {
            RecordingId = recordingId,
            FileName = fileName,
            Duration = duration,
            FileSizeBytes = fileSize,
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

    // Throttle progress broadcasts so we don't flood clients on small files —
    // only emit when the file changes, every ~250ms, or on completion.
    private readonly object _progressLock = new();
    private string? _lastProgressFile;
    private DateTime _lastProgressAt = DateTime.MinValue;

    private void OnUploadProgress(string fileName, long bytesSent, long bytesTotal)
    {
        bool shouldEmit;
        lock (_progressLock)
        {
            var now = DateTime.UtcNow;
            shouldEmit = fileName != _lastProgressFile
                || (bytesTotal > 0 && bytesSent >= bytesTotal)
                || (now - _lastProgressAt).TotalMilliseconds >= 250;
            if (shouldEmit)
            {
                _lastProgressFile = fileName;
                _lastProgressAt = now;
            }
        }
        if (!shouldEmit) return;

        var msg = new UploadProgressMessage
        {
            FileName = fileName,
            BytesSent = bytesSent,
            BytesTotal = bytesTotal,
        };
        Broadcast(msg);
    }

    private RecordingStateMessage BuildRecordingStateMessage()
    {
        return new RecordingStateMessage
        {
            State = _recorder?.CurrentState.ToString().ToLowerInvariant() ?? "idle",
            RecordingId = _recorder?.CurrentRecordingId,
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

    // ─── Call controller command handlers ───────────────────────────────────

    private async Task HandleDial(JsonElement root, IWebSocketConnection client)
    {
        if (_callController == null)
        {
            SendTo(client, new DialResultMessage { Success = false, Error = "Call controller not available" });
            return;
        }

        var phoneNumber = root.TryGetProperty("phoneNumber", out var p) ? p.GetString() ?? "" : "";
        if (string.IsNullOrWhiteSpace(phoneNumber))
        {
            SendTo(client, new DialResultMessage { Success = false, Error = "Phone number required" });
            return;
        }

        var (success, error) = await _callController.DialAsync(phoneNumber);
        SendTo(client, new DialResultMessage { Success = success, Error = error, PhoneNumber = phoneNumber });
    }

    private async Task HandleEndCall(IWebSocketConnection client)
    {
        if (_callController == null)
        {
            SendTo(client, new EndCallResultMessage { Success = false, Error = "Call controller not available" });
            return;
        }

        // Pass the current phone number so the API can match the right call
        var currentPhone = _fusion.CurrentState.PhoneNumber;
        var (success, error) = await _callController.EndCallAsync(currentPhone);
        SendTo(client, new EndCallResultMessage { Success = success, Error = error });
    }

    // Stream a local recording file back to the requesting client as base64.
    // Used for previewing recordings that haven't been uploaded to PocketBase
    // yet (e.g. before the call has been saved, so there's no call_log to link).
    // Path-traversal is blocked by restricting to a plain file name and
    // resolving against the recordings directory only.
    private void HandleGetLocalRecording(JsonElement root, IWebSocketConnection client)
    {
        var fileName = root.TryGetProperty("fileName", out var f) ? f.GetString() : null;
        var msg = new LocalRecordingMessage { FileName = fileName ?? "" };

        if (_storage == null || string.IsNullOrWhiteSpace(fileName))
        {
            msg.Error = "No file name";
            SendTo(client, msg);
            return;
        }

        // Reject anything that isn't a bare file name — no separators, no "..".
        var bare = Path.GetFileName(fileName);
        if (bare != fileName || fileName.Contains("..", StringComparison.Ordinal))
        {
            msg.Error = "Invalid file name";
            SendTo(client, msg);
            return;
        }

        // Accept either the base name the dashboard remembers (pre-link) or the
        // renamed `..._cl-{id}.mp3` form (post-link). If the exact name is
        // missing, look up the manifest by prefix.
        var recordingsDir = _storage.RecordingsDirectory;
        var directPath = Path.Combine(recordingsDir, fileName);
        string? resolvedPath = File.Exists(directPath) ? directPath : null;

        if (resolvedPath == null)
        {
            var baseName = Path.GetFileNameWithoutExtension(fileName);
            try
            {
                var match = Directory.EnumerateFiles(recordingsDir, $"{baseName}*.mp3")
                    .FirstOrDefault();
                if (match != null) resolvedPath = match;
            }
            catch { /* ignore — fall through to not-found */ }
        }

        if (resolvedPath == null)
        {
            msg.Error = "Recording file not found on disk";
            SendTo(client, msg);
            return;
        }

        try
        {
            var bytes = File.ReadAllBytes(resolvedPath);
            msg.Data = Convert.ToBase64String(bytes);
            msg.FileName = Path.GetFileName(resolvedPath);
            msg.Success = true;
        }
        catch (Exception ex)
        {
            msg.Error = ex.Message;
        }
        SendTo(client, msg);
    }

    // Snapshot of on-disk recordings that haven't been linked to a CRM call log.
    // Lets the dashboard repopulate the "Recorded but unsubmitted" state after
    // a page refresh — the live recordingCompleted event only fires once per
    // recording, so without this the UI forgets the recording on reload.
    private void HandleGetUnlinkedRecordings(IWebSocketConnection client)
    {
        var msg = new UnlinkedRecordingsMessage();
        if (_storage == null) { SendTo(client, msg); return; }

        foreach (var e in _storage.GetUnlinkedRecordings())
        {
            msg.Recordings.Add(new UnlinkedRecordingDto
            {
                RecordingId = e.RecordingId ?? "",
                FileName = e.FileName,
                PhoneNumber = e.PhoneNumber,
                Duration = e.DurationSeconds,
                FileSizeBytes = e.FileSizeBytes,
                StartTime = e.StartTime.ToString("o"),
                ClientCallId = e.ClientCallId,
            });
        }
        SendTo(client, msg);
    }

    private void HandleSetZoomApiConfig(JsonElement root)
    {
        if (_zoomApi == null) return;
        var accountId = root.TryGetProperty("accountId", out var a) ? a.GetString() : null;
        var clientId = root.TryGetProperty("clientId", out var c) ? c.GetString() : null;
        var clientSecret = root.TryGetProperty("clientSecret", out var s) ? s.GetString() : null;
        var zoomUserId = root.TryGetProperty("zoomUserId", out var u) ? u.GetString() : null;
        if (accountId != null && clientId != null && clientSecret != null && zoomUserId != null)
            _zoomApi.SetCredentials(accountId, clientId, clientSecret, zoomUserId);
    }

    // Dashboard records a dial "intent" the instant the user clicks Call.
    // The agent keeps it briefly so that when the Zoom UI active-call panel
    // lights up with the same phone number, the fusion can mark this
    // device/user as the unambiguous outbound owner — even if other
    // teammates on the shared account see the iframe update.
    private void HandleDialIntent(JsonElement root)
    {
        if (_intentTracker == null) return;
        var intentId = root.TryGetProperty("intentId", out var i) ? i.GetString() : null;
        var phone = root.TryGetProperty("phoneNumber", out var p) ? p.GetString() : null;
        var userId = root.TryGetProperty("userId", out var u) ? u.GetString() : null;
        var sessionId = root.TryGetProperty("sessionId", out var s) ? s.GetString() : null;
        var clientCallId = root.TryGetProperty("clientCallId", out var c) ? c.GetString() : null;
        if (string.IsNullOrWhiteSpace(intentId) || string.IsNullOrWhiteSpace(phone)) return;
        _intentTracker.Add(intentId!, phone!, userId ?? "", sessionId, clientCallId);
    }

    private void HandleGetDeviceId(IWebSocketConnection client)
    {
        var payload = new
        {
            type = "deviceId",
            deviceId = DeviceIdentity.DeviceId,
            hostname = DeviceIdentity.Hostname,
        };
        var json = JsonSerializer.Serialize(payload, _jsonOptions);
        try { client.Send(json); } catch { }
    }


    public void Stop()
    {
        _fusion.StateChanged -= OnStateChanged;
        if (_recorder != null)
        {
            _recorder.StateChanged -= OnRecordingStateChanged;
            _recorder.RecordingCompleted -= OnRecordingCompleted;
            _recorder.RecordingConverted -= OnRecordingConverted;
        }
        if (_uploader != null)
        {
            _uploader.UploadCompleted -= OnUploadCompleted;
            _uploader.UploadProgress -= OnUploadProgress;
        }
        _micManager = null;

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
