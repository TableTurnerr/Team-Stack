using System.Diagnostics;
using LocalCrmAgent.Models;
using NAudio.Lame;
using NAudio.Wave;

namespace LocalCrmAgent.Services;

public enum RecordingState
{
    Idle,
    Recording,
    Stopping,
    Error
}

/// <summary>
/// Records system audio via WASAPI loopback capture, saves as MP3.
/// Integrates with CallStateFusion for auto-record on call state changes.
/// </summary>
public class AudioRecorderService : IDisposable
{
    private readonly RecordingStorageManager _storage;
    private readonly CallStateFusion _fusion;
    private readonly object _lock = new();

    private WasapiLoopbackCapture? _capture;
    private WaveFileWriter? _waveWriter;
    private string? _tempWavPath;
    private string? _targetMp3Path;
    private DateTime _recordingStartTime;
    private string? _currentPhoneNumber;
    private RecordingState _state = RecordingState.Idle;

    // Auto-record configuration
    public bool AutoRecordEnabled { get; set; }
    public bool RecordOnRinging { get; set; }

    // Public state
    public RecordingState CurrentState
    {
        get { lock (_lock) return _state; }
    }

    public string? CurrentPhoneNumber
    {
        get { lock (_lock) return _currentPhoneNumber; }
    }

    public int DurationSeconds
    {
        get
        {
            lock (_lock)
            {
                if (_state == RecordingState.Recording)
                    return (int)(DateTime.UtcNow - _recordingStartTime).TotalSeconds;
                return 0;
            }
        }
    }

    public string? CurrentFileName
    {
        get
        {
            lock (_lock)
            {
                return _targetMp3Path != null ? Path.GetFileName(_targetMp3Path) : null;
            }
        }
    }

    public event Action<RecordingState, string?>? StateChanged;
    public event Action<string, string, int, long, DateTime>? RecordingCompleted;

    public AudioRecorderService(RecordingStorageManager storage, CallStateFusion fusion)
    {
        _storage = storage;
        _fusion = fusion;
        _fusion.StateChanged += OnCallStateChanged;
    }

    /// <summary>
    /// Start recording system audio for the given phone number.
    /// </summary>
    public (bool success, string? error) StartRecording(string phoneNumber)
    {
        lock (_lock)
        {
            if (_state == RecordingState.Recording)
                return (false, "Already recording");

            try
            {
                _currentPhoneNumber = phoneNumber;
                _recordingStartTime = DateTime.UtcNow;

                // Generate file paths
                _tempWavPath = _storage.GenerateTempWavPath(phoneNumber);
                _targetMp3Path = _storage.GenerateFilePath(phoneNumber);

                // Start WASAPI loopback capture (default render device)
                _capture = new WasapiLoopbackCapture();
                _waveWriter = new WaveFileWriter(_tempWavPath, _capture.WaveFormat);

                _capture.DataAvailable += OnDataAvailable;
                _capture.RecordingStopped += OnRecordingStopped;
                _capture.StartRecording();

                _state = RecordingState.Recording;
                Debug.WriteLine($"[Recorder] Started recording: {Path.GetFileName(_targetMp3Path)}");
                StateChanged?.Invoke(_state, null);
                return (true, null);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Recorder] Start failed: {ex.Message}");
                CleanupCapture();
                _state = RecordingState.Error;
                StateChanged?.Invoke(_state, ex.Message);
                return (false, ex.Message);
            }
        }
    }

    /// <summary>
    /// Stop recording and convert to MP3.
    /// </summary>
    public (bool success, string? filePath) StopRecording()
    {
        lock (_lock)
        {
            if (_state != RecordingState.Recording)
                return (false, null);

            _state = RecordingState.Stopping;
            StateChanged?.Invoke(_state, null);
        }

        try
        {
            // Stop capture (triggers OnRecordingStopped callback)
            _capture?.StopRecording();
            return (true, _targetMp3Path);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Recorder] Stop failed: {ex.Message}");
            lock (_lock)
            {
                _state = RecordingState.Error;
                StateChanged?.Invoke(_state, ex.Message);
            }
            return (false, null);
        }
    }

    /// <summary>
    /// Discard the current recording without saving.
    /// </summary>
    public void DiscardRecording()
    {
        lock (_lock)
        {
            if (_state != RecordingState.Recording && _state != RecordingState.Stopping)
                return;

            Debug.WriteLine("[Recorder] Discarding recording");
        }

        try { _capture?.StopRecording(); } catch { }
        CleanupCapture();

        // Delete temp WAV file
        if (_tempWavPath != null)
        {
            try { File.Delete(_tempWavPath); } catch { }
        }

        lock (_lock)
        {
            _state = RecordingState.Idle;
            _tempWavPath = null;
            _targetMp3Path = null;
            _currentPhoneNumber = null;
            StateChanged?.Invoke(_state, null);
        }
    }

    private void OnDataAvailable(object? sender, WaveInEventArgs e)
    {
        try
        {
            _waveWriter?.Write(e.Buffer, 0, e.BytesRecorded);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Recorder] Write error: {ex.Message}");
        }
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        string? tempWav;
        string? targetMp3;
        string? phoneNumber;
        DateTime startTime;

        lock (_lock)
        {
            tempWav = _tempWavPath;
            targetMp3 = _targetMp3Path;
            phoneNumber = _currentPhoneNumber;
            startTime = _recordingStartTime;
        }

        CleanupCapture();

        if (tempWav == null || targetMp3 == null || !File.Exists(tempWav))
        {
            lock (_lock)
            {
                _state = RecordingState.Idle;
                StateChanged?.Invoke(_state, null);
            }
            return;
        }

        // Convert WAV to MP3 on a background thread
        _ = Task.Run(() =>
        {
            try
            {
                ConvertToMp3(tempWav, targetMp3);

                // Delete temp WAV
                try { File.Delete(tempWav); } catch { }

                var fileInfo = new FileInfo(targetMp3);
                var duration = (int)(DateTime.UtcNow - startTime).TotalSeconds;
                var fileName = Path.GetFileName(targetMp3);

                // Add to manifest
                _storage.AddEntry(fileName, phoneNumber ?? "", startTime);
                _storage.UpdateEntry(fileName, e =>
                {
                    e.DurationSeconds = duration;
                    e.FileSizeBytes = fileInfo.Length;
                });

                Debug.WriteLine($"[Recorder] Completed: {fileName} ({duration}s, {fileInfo.Length} bytes)");

                lock (_lock)
                {
                    _state = RecordingState.Idle;
                    _tempWavPath = null;
                    _targetMp3Path = null;
                    _currentPhoneNumber = null;
                }

                StateChanged?.Invoke(RecordingState.Idle, null);
                RecordingCompleted?.Invoke(fileName, phoneNumber ?? "", duration, fileInfo.Length, startTime);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Recorder] MP3 conversion failed: {ex.Message}");
                // Keep the WAV file as fallback
                lock (_lock)
                {
                    _state = RecordingState.Error;
                    StateChanged?.Invoke(_state, ex.Message);
                }
            }
        });
    }

    private static void ConvertToMp3(string wavPath, string mp3Path)
    {
        using var reader = new WaveFileReader(wavPath);
        using var writer = new LameMP3FileWriter(mp3Path, reader.WaveFormat, LAMEPreset.STANDARD);
        reader.CopyTo(writer);
    }

    private void CleanupCapture()
    {
        try
        {
            if (_waveWriter != null)
            {
                _waveWriter.Dispose();
                _waveWriter = null;
            }
        }
        catch { }

        try
        {
            if (_capture != null)
            {
                _capture.DataAvailable -= OnDataAvailable;
                _capture.RecordingStopped -= OnRecordingStopped;
                _capture.Dispose();
                _capture = null;
            }
        }
        catch { }
    }

    /// <summary>
    /// Auto-record integration: respond to CallStateFusion state changes.
    /// </summary>
    private void OnCallStateChanged(CallStateInfo info)
    {
        if (!AutoRecordEnabled) return;

        switch (info.State)
        {
            case CallState.Ringing when RecordOnRinging:
                // Start recording on ringing if configured
                if (CurrentState == RecordingState.Idle && info.PhoneNumber != null)
                {
                    Debug.WriteLine("[Recorder] Auto-start on ringing");
                    StartRecording(info.PhoneNumber);
                }
                break;

            case CallState.Connected:
                // Start recording on connected (default auto-record trigger)
                if (CurrentState == RecordingState.Idle && info.PhoneNumber != null)
                {
                    Debug.WriteLine("[Recorder] Auto-start on connected");
                    StartRecording(info.PhoneNumber);
                }
                break;

            case CallState.Ended:
                if (CurrentState == RecordingState.Recording)
                {
                    // If call was answered (duration > 0), save recording
                    if (info.DurationSeconds > 0)
                    {
                        Debug.WriteLine("[Recorder] Auto-stop on ended");
                        StopRecording();
                    }
                    else
                    {
                        // Unanswered call — discard recording
                        Debug.WriteLine("[Recorder] Auto-discard (unanswered)");
                        DiscardRecording();
                    }
                }
                break;
        }
    }

    public void Dispose()
    {
        _fusion.StateChanged -= OnCallStateChanged;
        if (_state == RecordingState.Recording)
        {
            try { _capture?.StopRecording(); } catch { }
        }
        CleanupCapture();
    }
}
