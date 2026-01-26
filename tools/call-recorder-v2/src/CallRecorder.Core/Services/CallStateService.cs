using System.Drawing;
using CallRecorder.Core.Models;

namespace CallRecorder.Core.Services;

/// <summary>
/// Service for detecting and tracking call state changes
/// </summary>
public class CallStateService : IDisposable
{
    private readonly ScreenCaptureService _captureService;
    private readonly OcrService _ocrService;
    private readonly WindowService _windowService;
    
    private CallStateInfo _currentState = CallStateInfo.Idle;
    private IntPtr _targetWindow;
    private CancellationTokenSource? _monitorTokenSource;
    private bool _isMonitoring;
    
    // Detection settings
    private readonly int _captureIntervalMs = 500;
    private readonly int _ocrTopHeight = 200;
    
    public event EventHandler<CallStateInfo>? StateChanged;
    public event EventHandler<string>? DebugMessage;
    
    public CallStateInfo CurrentState => _currentState;
    public bool IsMonitoring => _isMonitoring;
    
    public CallStateService(
        ScreenCaptureService captureService,
        OcrService ocrService,
        WindowService windowService)
    {
        _captureService = captureService;
        _ocrService = ocrService;
        _windowService = windowService;
    }
    
    /// <summary>
    /// Sets the target window to monitor
    /// </summary>
    public void SetTargetWindow(IntPtr windowHandle)
    {
        _targetWindow = windowHandle;
        _captureService.SetTargetWindow(windowHandle);
    }
    
    /// <summary>
    /// Starts monitoring for call state changes
    /// </summary>
    public void StartMonitoring()
    {
        if (_isMonitoring || _targetWindow == IntPtr.Zero)
            return;
        
        if (!_ocrService.Initialize())
        {
            DebugMessage?.Invoke(this, "Failed to initialize OCR engine");
            return;
        }
        
        _isMonitoring = true;
        _monitorTokenSource = new CancellationTokenSource();
        
        Task.Run(async () =>
        {
            DebugMessage?.Invoke(this, "Started call state monitoring");
            
            while (!_monitorTokenSource.Token.IsCancellationRequested)
            {
                try
                {
                    await MonitorCycleAsync();
                    await Task.Delay(_captureIntervalMs, _monitorTokenSource.Token);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    DebugMessage?.Invoke(this, $"Monitor error: {ex.Message}");
                }
            }
        }, _monitorTokenSource.Token);
    }
    
    /// <summary>
    /// Stops monitoring
    /// </summary>
    public void StopMonitoring()
    {
        _isMonitoring = false;
        _monitorTokenSource?.Cancel();
        _monitorTokenSource?.Dispose();
        _monitorTokenSource = null;
        DebugMessage?.Invoke(this, "Stopped call state monitoring");
    }
    
    private async Task MonitorCycleAsync()
    {
        // Check if window is still valid
        if (!_windowService.IsWindowValid(_targetWindow))
        {
            if (_currentState.State != CallState.Idle)
            {
                UpdateState(CreateEndedState());
            }
            return;
        }
        
        // Check if window is minimized
        bool isMinimized = _windowService.IsWindowMinimized(_targetWindow);
        if (isMinimized && _currentState.State == CallState.Active)
        {
            // Keep the same state but mark as minimized
            var updatedState = new CallStateInfo
            {
                State = _currentState.State,
                PhoneNumber = _currentState.PhoneNumber,
                Duration = _currentState.Duration,
                StartTime = _currentState.StartTime,
                IsMinimized = true
            };
            
            if (!_currentState.IsMinimized)
            {
                _currentState = updatedState;
                StateChanged?.Invoke(this, _currentState);
            }
            return;
        }
        
        // Capture the top portion of the window for OCR
        using var frame = _captureService.CaptureTopPortion(_ocrTopHeight);
        if (frame == null)
            return;
        
        // Analyze the image
        var ocrResult = _ocrService.AnalyzeImage(frame);
        
        // Determine state based on OCR results
        var newState = DetermineState(ocrResult);
        
        // Check for state change
        if (HasStateChanged(newState))
        {
            var previousState = _currentState;
            _currentState = newState;
            
            DebugMessage?.Invoke(this, $"State: {previousState.State} -> {newState.State} | Phone: {newState.PhoneNumber}");
            StateChanged?.Invoke(this, _currentState);
        }
    }
    
    private CallStateInfo DetermineState(OcrResult ocrResult)
    {
        // Priority order for state detection:
        // 1. Timer present = Active call
        // 2. "Calling" text = Calling/Dialing
        // 3. Phone number + no timer/calling = Number entered
        // 4. Idle placeholder = Idle
        // 5. Default = maintain previous state
        
        if (ocrResult.Timer != null)
        {
            return new CallStateInfo
            {
                State = CallState.Active,
                PhoneNumber = ocrResult.PhoneNumber ?? _currentState.PhoneNumber,
                Duration = ocrResult.Timer,
                StartTime = _currentState.StartTime ?? DateTime.Now,
                IsMinimized = false
            };
        }
        
        if (ocrResult.IsCallingTextPresent)
        {
            return new CallStateInfo
            {
                State = CallState.Calling,
                PhoneNumber = ocrResult.PhoneNumber ?? _currentState.PhoneNumber,
                StartTime = _currentState.State == CallState.Calling ? _currentState.StartTime : DateTime.Now,
                IsMinimized = false
            };
        }
        
        if (!string.IsNullOrEmpty(ocrResult.PhoneNumber))
        {
            // If we were in Active state and now see a phone but no timer,
            // the call has ended
            if (_currentState.State == CallState.Active)
            {
                return CreateEndedState();
            }
            
            return new CallStateInfo
            {
                State = CallState.NumberEntered,
                PhoneNumber = ocrResult.PhoneNumber,
                IsMinimized = false
            };
        }
        
        if (ocrResult.IsIdlePlaceholder)
        {
            // If we were in a call, transition to Ended first
            if (_currentState.State == CallState.Active || _currentState.State == CallState.Calling)
            {
                return CreateEndedState();
            }
            
            return CallStateInfo.Idle;
        }
        
        // If we were in Active state and can't detect anything useful,
        // the call might have ended
        if (_currentState.State == CallState.Active && 
            ocrResult.Timer == null && 
            !ocrResult.IsCallingTextPresent &&
            string.IsNullOrEmpty(ocrResult.RawText.Trim()))
        {
            return CreateEndedState();
        }
        
        // Maintain current state if uncertain
        return _currentState;
    }
    
    private CallStateInfo CreateEndedState()
    {
        return new CallStateInfo
        {
            State = CallState.Ended,
            PhoneNumber = _currentState.PhoneNumber,
            Duration = _currentState.Duration,
            StartTime = _currentState.StartTime,
            EndTime = DateTime.Now,
            IsMinimized = false
        };
    }
    
    private bool HasStateChanged(CallStateInfo newState)
    {
        // State changed
        if (newState.State != _currentState.State)
            return true;
        
        // Phone number changed (and new one is not null)
        if (!string.IsNullOrEmpty(newState.PhoneNumber) && 
            newState.PhoneNumber != _currentState.PhoneNumber)
            return true;
        
        // Minimized state changed
        if (newState.IsMinimized != _currentState.IsMinimized)
            return true;
        
        return false;
    }
    
    /// <summary>
    /// Performs a single detection cycle and returns the result (for testing)
    /// </summary>
    public async Task<CallStateInfo> DetectStateOnceAsync()
    {
        if (_targetWindow == IntPtr.Zero)
            return CallStateInfo.Idle;
        
        if (!_ocrService.Initialize())
            return CallStateInfo.Idle;
        
        using var frame = _captureService.CaptureTopPortion(_ocrTopHeight);
        if (frame == null)
            return CallStateInfo.Idle;
        
        var ocrResult = _ocrService.AnalyzeImage(frame);
        return DetermineState(ocrResult);
    }
    
    public void Dispose()
    {
        StopMonitoring();
    }
}
