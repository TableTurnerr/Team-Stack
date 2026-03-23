using System.Diagnostics;
using LocalCrmAgent.Models;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;

namespace LocalCrmAgent.Services;

/// <summary>
/// Manages microphone device enumeration, selection, level monitoring,
/// and automatic switching. During active calls, detects when the selected
/// mic is silent and auto-switches to a mic that has audio. Switches back
/// to the default device once it starts producing audio again, unless the
/// user has manually overridden the selection.
/// </summary>
public class MicrophoneManager : IDisposable, IMMNotificationClient
{
    private readonly CallStateFusion _fusion;
    private readonly object _lock = new();
    private readonly MMDeviceEnumerator _enumerator;

    // Current selection
    private string? _selectedDeviceId;       // null = use system default
    private bool _isManualSelection;         // true if user explicitly chose a mic
    private string? _activeDeviceId;         // device currently in use for recording
    private string? _systemDefaultDeviceId;  // OS-level default communications device

    // Level monitoring
    private Thread? _monitorThread;
    private volatile bool _isMonitoring;
    private int _silentSeconds;
    private const int SilentThresholdSeconds = 5;   // alert after 5s of silence during a call
    private const float AudioThreshold = 0.005f;    // peak level below this = silent
    private const int MonitorIntervalMs = 1000;      // check levels every second
    private bool _alertSent;                          // avoid spamming alerts

    // Events
    public event Action<MicDeviceInfo>? DeviceSwitched;     // fired when active mic changes
    public event Action<string>? MicAlert;                   // fired when mic appears silent during call
    public event Action? DeviceListChanged;                  // fired when available devices change

    public MicrophoneManager(CallStateFusion fusion)
    {
        _fusion = fusion;
        _enumerator = new MMDeviceEnumerator();

        // Track the system default
        try
        {
            var defaultDevice = _enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
            _systemDefaultDeviceId = defaultDevice.ID;
        }
        catch
        {
            _systemDefaultDeviceId = null;
        }

        // Listen for device add/remove/default changes
        _enumerator.RegisterEndpointNotificationCallback(this);
    }

    /// <summary>Start the background mic-level monitoring thread.</summary>
    public void StartMonitoring()
    {
        if (_isMonitoring) return;
        _isMonitoring = true;
        _monitorThread = new Thread(MonitorLoop) { IsBackground = true, Name = "MicMonitor" };
        _monitorThread.Start();
        Debug.WriteLine("[MicMgr] Monitoring started");
    }

    /// <summary>Stop the background monitoring thread.</summary>
    public void StopMonitoring()
    {
        _isMonitoring = false;
        _monitorThread?.Join(2000);
        _monitorThread = null;
    }

    // ─── Device enumeration ──────────────────────────────────────────────

    /// <summary>List all active capture (microphone) devices.</summary>
    public List<MicDeviceInfo> GetDevices()
    {
        var devices = new List<MicDeviceInfo>();
        try
        {
            var collection = _enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);
            foreach (var device in collection)
            {
                devices.Add(new MicDeviceInfo
                {
                    DeviceId = device.ID,
                    Name = device.FriendlyName,
                    IsDefault = device.ID == _systemDefaultDeviceId,
                    IsSelected = device.ID == GetEffectiveDeviceId(),
                    PeakLevel = GetDevicePeakLevel(device),
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[MicMgr] Error enumerating devices: {ex.Message}");
        }
        return devices;
    }

    /// <summary>Get info about the currently active mic device.</summary>
    public MicDeviceInfo? GetActiveDevice()
    {
        try
        {
            var device = ResolveDevice(GetEffectiveDeviceId());
            if (device == null) return null;
            return new MicDeviceInfo
            {
                DeviceId = device.ID,
                Name = device.FriendlyName,
                IsDefault = device.ID == _systemDefaultDeviceId,
                IsSelected = true,
                PeakLevel = GetDevicePeakLevel(device),
            };
        }
        catch { return null; }
    }

    /// <summary>
    /// Select a specific microphone. Pass null to revert to system default.
    /// </summary>
    public void SetDevice(string? deviceId)
    {
        lock (_lock)
        {
            if (deviceId == null)
            {
                // Revert to default
                _selectedDeviceId = null;
                _isManualSelection = false;
                Debug.WriteLine("[MicMgr] Reverted to system default mic");
            }
            else
            {
                _selectedDeviceId = deviceId;
                _isManualSelection = true;
                Debug.WriteLine($"[MicMgr] User selected mic: {deviceId}");
            }

            _activeDeviceId = GetEffectiveDeviceId();
            _silentSeconds = 0;
            _alertSent = false;
        }

        var info = GetActiveDevice();
        if (info != null) DeviceSwitched?.Invoke(info);
    }

    /// <summary>
    /// Get the MMDevice that should be used for recording.
    /// Called by AudioRecorderService when starting a recording.
    /// </summary>
    public MMDevice? GetRecordingDevice()
    {
        return ResolveDevice(GetEffectiveDeviceId());
    }

    /// <summary>Whether the user has manually selected a specific mic.</summary>
    public bool IsManualSelection
    {
        get { lock (_lock) return _isManualSelection; }
    }

    // ─── Monitoring loop ─────────────────────────────────────────────────

    private void MonitorLoop()
    {
        while (_isMonitoring)
        {
            try
            {
                var callState = _fusion.CurrentState.State;
                if (callState == CallState.Connected || callState == CallState.Ringing)
                {
                    CheckMicDuringCall();
                }
                else
                {
                    // Reset silence tracking when not on a call
                    lock (_lock)
                    {
                        _silentSeconds = 0;
                        _alertSent = false;
                    }
                }

                Thread.Sleep(MonitorIntervalMs);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[MicMgr] Monitor error: {ex.Message}");
                Thread.Sleep(MonitorIntervalMs);
            }
        }
    }

    private void CheckMicDuringCall()
    {
        string? effectiveId;
        bool isManual;
        lock (_lock)
        {
            effectiveId = GetEffectiveDeviceId();
            isManual = _isManualSelection;
        }

        // Check current mic's level
        float currentLevel = GetPeakLevelById(effectiveId);

        if (currentLevel >= AudioThreshold)
        {
            // Current mic has audio — all good
            lock (_lock)
            {
                _silentSeconds = 0;
                _alertSent = false;
            }
            return;
        }

        // Current mic is silent
        lock (_lock) _silentSeconds++;

        int silentSecs;
        lock (_lock) silentSecs = _silentSeconds;

        if (silentSecs < SilentThresholdSeconds) return;

        // Mic has been silent for too long during a call
        if (!isManual)
        {
            // Auto-switch: find a mic that IS producing audio
            var candidate = FindActiveMic(effectiveId);
            if (candidate != null)
            {
                lock (_lock)
                {
                    _activeDeviceId = candidate.DeviceId;
                    _silentSeconds = 0;
                    _alertSent = false;
                }
                Debug.WriteLine($"[MicMgr] Auto-switched to active mic: {candidate.Name}");
                DeviceSwitched?.Invoke(candidate);

                // Also start watching for default mic to come back
                return;
            }
        }

        // Send alert (once per silence episode)
        bool shouldAlert;
        lock (_lock)
        {
            shouldAlert = !_alertSent;
            _alertSent = true;
        }

        if (shouldAlert)
        {
            var deviceName = "Unknown";
            try
            {
                var device = ResolveDevice(effectiveId);
                if (device != null) deviceName = device.FriendlyName;
            }
            catch { }

            var message = isManual
                ? $"No audio detected from your selected microphone \"{deviceName}\". Please check your mic or select a different one."
                : $"No audio detected from microphone \"{deviceName}\". No other active microphone found. Please check your mic settings.";

            Debug.WriteLine($"[MicMgr] Alert: {message}");
            MicAlert?.Invoke(message);
        }
    }

    /// <summary>
    /// Check if the default mic has come back to life and switch to it
    /// (only when auto-switched away from default, not manual selection).
    /// Called from MonitorLoop when we're on a non-default device.
    /// </summary>
    private void CheckDefaultMicRecovery()
    {
        lock (_lock)
        {
            if (_isManualSelection) return;
            if (_activeDeviceId == _systemDefaultDeviceId) return;
            if (_systemDefaultDeviceId == null) return;
        }

        float defaultLevel = GetPeakLevelById(_systemDefaultDeviceId);
        if (defaultLevel >= AudioThreshold)
        {
            // Default mic is producing audio again — switch back
            lock (_lock)
            {
                _activeDeviceId = _systemDefaultDeviceId;
                _silentSeconds = 0;
                _alertSent = false;
            }

            var info = GetActiveDevice();
            if (info != null)
            {
                Debug.WriteLine($"[MicMgr] Default mic recovered, switching back: {info.Name}");
                DeviceSwitched?.Invoke(info);
            }
        }
    }

    /// <summary>Find a mic (other than excludeId) that is producing audio.</summary>
    private MicDeviceInfo? FindActiveMic(string? excludeId)
    {
        try
        {
            var collection = _enumerator.EnumerateAudioEndPoints(DataFlow.Capture, DeviceState.Active);
            MicDeviceInfo? best = null;
            float bestLevel = 0;

            foreach (var device in collection)
            {
                if (device.ID == excludeId) continue;

                float level = GetDevicePeakLevel(device);
                if (level >= AudioThreshold && level > bestLevel)
                {
                    best = new MicDeviceInfo
                    {
                        DeviceId = device.ID,
                        Name = device.FriendlyName,
                        IsDefault = device.ID == _systemDefaultDeviceId,
                        IsSelected = true,
                        PeakLevel = level,
                    };
                    bestLevel = level;
                }
            }

            return best;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[MicMgr] Error finding active mic: {ex.Message}");
            return null;
        }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────

    /// <summary>
    /// Returns the device ID that should be used. Priority:
    /// 1. Auto-switched active device (during call)
    /// 2. User-selected device
    /// 3. System default
    /// </summary>
    private string? GetEffectiveDeviceId()
    {
        // If we auto-switched to a different device, use that
        if (_activeDeviceId != null) return _activeDeviceId;
        // If user selected a device, use that
        if (_selectedDeviceId != null) return _selectedDeviceId;
        // Fall back to system default
        return _systemDefaultDeviceId;
    }

    private MMDevice? ResolveDevice(string? deviceId)
    {
        try
        {
            if (deviceId != null)
                return _enumerator.GetDevice(deviceId);

            return _enumerator.GetDefaultAudioEndpoint(DataFlow.Capture, Role.Communications);
        }
        catch
        {
            return null;
        }
    }

    private static float GetDevicePeakLevel(MMDevice device)
    {
        try
        {
            return device.AudioMeterInformation.MasterPeakValue;
        }
        catch
        {
            return 0f;
        }
    }

    private float GetPeakLevelById(string? deviceId)
    {
        try
        {
            var device = ResolveDevice(deviceId);
            return device != null ? GetDevicePeakLevel(device) : 0f;
        }
        catch
        {
            return 0f;
        }
    }

    // ─── IMMNotificationClient — device hotplug events ───────────────────

    public void OnDeviceStateChanged(string deviceId, DeviceState newState)
    {
        Debug.WriteLine($"[MicMgr] Device state changed: {deviceId} → {newState}");
        DeviceListChanged?.Invoke();
    }

    public void OnDeviceAdded(string pwstrDeviceId)
    {
        Debug.WriteLine($"[MicMgr] Device added: {pwstrDeviceId}");
        DeviceListChanged?.Invoke();
    }

    public void OnDeviceRemoved(string deviceId)
    {
        Debug.WriteLine($"[MicMgr] Device removed: {deviceId}");

        // If the removed device was our selected one, revert to default
        lock (_lock)
        {
            if (_selectedDeviceId == deviceId || _activeDeviceId == deviceId)
            {
                _activeDeviceId = null;
                if (_selectedDeviceId == deviceId)
                {
                    _selectedDeviceId = null;
                    _isManualSelection = false;
                }
            }
        }

        DeviceListChanged?.Invoke();
    }

    public void OnDefaultDeviceChanged(DataFlow flow, Role role, string defaultDeviceId)
    {
        if (flow != DataFlow.Capture) return;

        Debug.WriteLine($"[MicMgr] Default capture device changed: {defaultDeviceId}");
        lock (_lock)
        {
            _systemDefaultDeviceId = defaultDeviceId;

            // If not manually selected, follow the new default
            if (!_isManualSelection)
            {
                _activeDeviceId = null; // will resolve to new default
                _silentSeconds = 0;
                _alertSent = false;
            }
        }

        DeviceListChanged?.Invoke();
    }

    public void OnPropertyValueChanged(string pwstrDeviceId, PropertyKey key)
    {
        // Not needed — ignore property changes
    }

    public void Dispose()
    {
        StopMonitoring();
        try { _enumerator.UnregisterEndpointNotificationCallback(this); } catch { }
        _enumerator.Dispose();
    }
}

/// <summary>Info about a single microphone device.</summary>
public class MicDeviceInfo
{
    public string DeviceId { get; set; } = "";
    public string Name { get; set; } = "";
    public bool IsDefault { get; set; }
    public bool IsSelected { get; set; }
    public float PeakLevel { get; set; }
}
