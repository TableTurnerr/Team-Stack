using System.Diagnostics;
using LocalCrmAgent.Models;
using NAudio.Lame;
using NAudio.CoreAudioApi;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace LocalCrmAgent.Services;

public enum RecordingState
{
    Idle,
    Recording,
    Stopping,
    Error
}

/// <summary>
/// Records both system audio (remote party) via WASAPI loopback and microphone
/// audio (local user) via WASAPI capture, mixed into a mono file.
/// Integrates with CallStateFusion for auto-record on call state changes.
/// </summary>
public class AudioRecorderService : IDisposable
{
    private readonly RecordingStorageManager _storage;
    private readonly CallStateFusion _fusion;
    private readonly MicrophoneManager? _micManager;
    private readonly object _lock = new();

    private WasapiLoopbackCapture? _loopbackCapture;
    private WasapiCapture? _micCapture;
    private WaveFileWriter? _waveWriter;
    private readonly object _writeLock = new();
    private int _outputSampleRate;
    private int _loopbackChannels;
    private int _micChannels;

    // Mic data flows into this buffer; loopback callback pulls and mixes it.
    // Only the loopback callback writes to the WAV — single writer = no interleaving.
    private BufferedWaveProvider? _micBuffer;
    private ISampleProvider? _micMonoProvider; // mono (+ resampled if needed) view of _micBuffer

    // Watchdog thread — checks call state periodically
    private Thread? _watchdogThread;
    private volatile bool _isRecordingActive;

    private string? _tempWavPath;
    private string? _targetMp3Path;
    private DateTime _recordingStartTime;
    private string? _currentPhoneNumber;
    private string? _currentRecordingId;
    private RecordingState _state = RecordingState.Idle;

    // Safety: max recording duration (2 hours) — absolute ceiling.
    private const int MaxRecordingSeconds = 7200;

    // How often the mix loop checks if the call is still active (seconds).
    private const int CallStateCheckIntervalSeconds = 5;

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

    public string? CurrentRecordingId
    {
        get { lock (_lock) return _currentRecordingId; }
    }

    public event Action<RecordingState, string?>? StateChanged;
    /// <summary>
    /// Fired when recording is completed. Args: recordingId, fileName, phoneNumber, duration, fileSize, startTime.
    /// </summary>
    public event Action<string, string, string, int, long, DateTime>? RecordingCompleted;

    public AudioRecorderService(RecordingStorageManager storage, CallStateFusion fusion, MicrophoneManager? micManager = null)
    {
        _storage = storage;
        _fusion = fusion;
        _micManager = micManager;
        _fusion.StateChanged += OnCallStateChanged;
    }

    /// <summary>
    /// Start recording system audio + microphone for the given phone number.
    /// If a previous recording is still running (stuck from a prior call),
    /// it is force-stopped first so the new recording can start cleanly.
    /// </summary>
    public (bool success, string? error) StartRecording(string phoneNumber)
    {
        // Clean up any non-Idle state before starting a new recording.
        var currentState = CurrentState;
        if (currentState != RecordingState.Idle)
        {
            Debug.WriteLine($"[Recorder] State is {currentState} before start — cleaning up");

            if (currentState == RecordingState.Recording)
            {
                Debug.WriteLine("[Recorder] Force-discarding stuck recording");
                DiscardRecording();
            }
            else if (currentState == RecordingState.Stopping)
            {
                Debug.WriteLine("[Recorder] Waiting for previous recording to finish converting...");
                for (int i = 0; i < 50 && CurrentState == RecordingState.Stopping; i++)
                    Thread.Sleep(100); // up to 5 seconds
            }

            // If still not Idle (Error, stuck Stopping, etc.), force reset
            if (CurrentState != RecordingState.Idle)
            {
                Debug.WriteLine($"[Recorder] Forcing state from {CurrentState} → Idle");
                CleanupCapture();
                lock (_lock) { _state = RecordingState.Idle; }
            }
        }

        lock (_lock)
        {
            if (_state != RecordingState.Idle)
                return (false, $"Cannot start: state is {_state}");

            try
            {
                _currentPhoneNumber = phoneNumber;
                _recordingStartTime = DateTime.UtcNow;
                _currentRecordingId = Guid.NewGuid().ToString("N")[..12]; // short unique ID

                // Generate file paths
                _tempWavPath = _storage.GenerateTempWavPath(phoneNumber);
                _targetMp3Path = _storage.GenerateFilePath(phoneNumber);

                // Loopback capture (system audio — remote party's voice)
                _loopbackCapture = new WasapiLoopbackCapture();
                var outputFormat = _loopbackCapture.WaveFormat;
                _outputSampleRate = outputFormat.SampleRate;
                _loopbackChannels = outputFormat.Channels;

                _loopbackCapture.DataAvailable += OnLoopbackDataAvailable;
                _loopbackCapture.RecordingStopped += OnRecordingStopped;

                // Microphone capture — data goes into a buffer that the loopback
                // callback pulls from and mixes before writing to WAV.
                try
                {
                    var micDevice = _micManager?.GetRecordingDevice();
                    _micCapture = micDevice != null
                        ? new WasapiCapture(micDevice)
                        : new WasapiCapture();
                    _micChannels = _micCapture.WaveFormat.Channels;

                    _micBuffer = new BufferedWaveProvider(_micCapture.WaveFormat)
                    {
                        DiscardOnBufferOverflow = true
                    };

                    // Build a mono (+ resampled if needed) provider on top of the buffer
                    ISampleProvider micProv = _micBuffer.ToSampleProvider();
                    if (_micChannels >= 2)
                        micProv = new StereoToMonoSampleProvider(micProv);
                    if (_micCapture.WaveFormat.SampleRate != _outputSampleRate)
                        micProv = new WdlResamplingSampleProvider(micProv, _outputSampleRate);
                    _micMonoProvider = micProv;

                    _micCapture.DataAvailable += OnMicDataAvailable;

                    var micName = micDevice?.FriendlyName ?? "system default";
                    Debug.WriteLine($"[Recorder] Loopback format: {outputFormat.SampleRate}Hz, {outputFormat.Channels}ch, {outputFormat.BitsPerSample}bit");
                    Debug.WriteLine($"[Recorder] Mic ({micName}): {_micCapture.WaveFormat.SampleRate}Hz, {_micCapture.WaveFormat.Channels}ch, {_micCapture.WaveFormat.BitsPerSample}bit");
                }
                catch (Exception micEx)
                {
                    Debug.WriteLine($"[Recorder] Mic capture unavailable, recording system audio only: {micEx.Message}");
                    _micCapture?.Dispose();
                    _micCapture = null;
                    _micBuffer = null;
                    _micMonoProvider = null;
                }

                // Output: mono WAV at the loopback sample rate
                var monoFormat = WaveFormat.CreateIeeeFloatWaveFormat(_outputSampleRate, 1);
                _waveWriter = new WaveFileWriter(_tempWavPath, monoFormat);

                // Start watchdog thread (checks call state, enforces max duration)
                _isRecordingActive = true;
                _watchdogThread = new Thread(WatchdogLoop) { IsBackground = true, Name = "RecordWatchdog" };
                _watchdogThread.Start();

                // Start captures
                _loopbackCapture.StartRecording();
                _micCapture?.StartRecording();

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
            // Stop watchdog
            _isRecordingActive = false;

            // Stop captures — wrap each individually so one failure
            // doesn't prevent the other from stopping.
            try { _micCapture?.StopRecording(); } catch (Exception ex)
            {
                Debug.WriteLine($"[Recorder] Mic stop failed: {ex.Message}");
            }

            try { _loopbackCapture?.StopRecording(); } catch (Exception ex)
            {
                // If loopback stop fails, OnRecordingStopped won't fire —
                // trigger save flow manually.
                Debug.WriteLine($"[Recorder] Loopback stop failed, triggering save manually: {ex.Message}");
                OnRecordingStopped(null, new StoppedEventArgs());
            }

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
    /// IMPORTANT: Detach the RecordingStopped event BEFORE stopping captures,
    /// otherwise OnRecordingStopped fires and creates a bogus MP3 from the
    /// barely-started WAV, then clobbers the new recording's state.
    /// </summary>
    public void DiscardRecording()
    {
        string? tempWavToDelete;

        lock (_lock)
        {
            if (_state != RecordingState.Recording && _state != RecordingState.Stopping)
                return;

            Debug.WriteLine("[Recorder] Discarding recording");
            tempWavToDelete = _tempWavPath;
            _state = RecordingState.Idle;
            _tempWavPath = null;
            _targetMp3Path = null;
            _currentPhoneNumber = null;
            _currentRecordingId = null;
        }

        _isRecordingActive = false;

        // Detach events FIRST so stopping captures doesn't trigger OnRecordingStopped
        if (_loopbackCapture != null)
            _loopbackCapture.RecordingStopped -= OnRecordingStopped;

        try { _micCapture?.StopRecording(); } catch { }
        try { _loopbackCapture?.StopRecording(); } catch { }
        CleanupCapture();

        // Delete temp WAV file
        if (tempWavToDelete != null)
        {
            try { File.Delete(tempWavToDelete); } catch { }
        }

        StateChanged?.Invoke(RecordingState.Idle, null);
    }

    /// <summary>
    /// Called by WASAPI when loopback audio is available.
    /// This is the ONLY callback that writes to the WAV file.
    /// It converts loopback to mono, pulls mic data from the buffer,
    /// mixes them, and writes the result.
    /// </summary>
    private void OnLoopbackDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded == 0) return;

        try
        {
            // Convert loopback raw bytes → mono float samples
            int bytesPerSample = 4; // 32-bit float
            int totalSamples = e.BytesRecorded / bytesPerSample;
            int frames = totalSamples / _loopbackChannels;
            var mono = new float[frames];

            for (int f = 0; f < frames; f++)
            {
                float sum = 0f;
                for (int ch = 0; ch < _loopbackChannels; ch++)
                {
                    int idx = (f * _loopbackChannels + ch) * bytesPerSample;
                    sum += BitConverter.ToSingle(e.Buffer, idx);
                }
                mono[f] = sum / _loopbackChannels;
            }

            // Pull the same number of mono samples from the mic buffer and mix
            if (_micMonoProvider != null)
            {
                var micMono = new float[frames];
                int micRead = _micMonoProvider.Read(micMono, 0, frames);

                for (int i = 0; i < frames; i++)
                {
                    float m = i < micRead ? micMono[i] : 0f;
                    mono[i] = Math.Clamp(mono[i] + m, -1f, 1f);
                }
            }

            lock (_writeLock)
            {
                _waveWriter?.WriteSamples(mono, 0, frames);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Recorder] Loopback write error: {ex.Message}");
        }
    }

    /// <summary>
    /// Called by WASAPI when mic audio is available.
    /// Just stores data in the buffer — the loopback callback pulls and mixes it.
    /// </summary>
    private void OnMicDataAvailable(object? sender, WaveInEventArgs e)
    {
        try
        {
            _micBuffer?.AddSamples(e.Buffer, 0, e.BytesRecorded);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Recorder] Mic buffer error: {ex.Message}");
        }
    }

    /// <summary>
    /// Background watchdog: checks call state and enforces max duration.
    /// Stops the recording if the call ended but the event was missed.
    /// </summary>
    private void WatchdogLoop()
    {
        while (_isRecordingActive)
        {
            Thread.Sleep(CallStateCheckIntervalSeconds * 1000);
            if (!_isRecordingActive) break;

            var elapsed = (DateTime.UtcNow - _recordingStartTime).TotalSeconds;

            if (elapsed > MaxRecordingSeconds)
            {
                Debug.WriteLine($"[Recorder] Max duration ({MaxRecordingSeconds}s) reached, forcing stop");
                ForceStopFromWatchdog();
                break;
            }

            var callState = _fusion.CurrentState.State;
            if (callState == CallState.Idle || callState == CallState.Ended)
            {
                Debug.WriteLine($"[Recorder] Call state is {callState} — stopping recording ({(int)elapsed}s)");
                ForceStopFromWatchdog();
                break;
            }
        }
    }

    private void ForceStopFromWatchdog()
    {
        lock (_lock)
        {
            if (_state == RecordingState.Recording)
                _state = RecordingState.Stopping;
            else
                return; // already stopping or stopped
        }
        try { _micCapture?.StopRecording(); } catch { }
        try { _loopbackCapture?.StopRecording(); } catch { } // triggers OnRecordingStopped
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        string? tempWav;
        string? targetMp3;
        string? phoneNumber;
        string? recordingId;
        DateTime startTime;
        lock (_lock)
        {
            // Guard: if state is not Stopping, this is a spurious callback
            // (e.g. from a discarded recording). Don't finalize.
            if (_state != RecordingState.Stopping)
            {
                Debug.WriteLine($"[Recorder] OnRecordingStopped ignored (state={_state}, not Stopping)");
                return;
            }

            tempWav = _tempWavPath;
            targetMp3 = _targetMp3Path;
            phoneNumber = _currentPhoneNumber;
            recordingId = _currentRecordingId;
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

        // Add manifest entry immediately so "pending" count appears right away,
        // before the potentially slow WAV→MP3 conversion.
        var fileName = Path.GetFileName(targetMp3);
        _storage.AddEntry(fileName, phoneNumber ?? "", startTime, recordingId);

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

                // Update manifest with final file info
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
                    _currentRecordingId = null;
                }

                StateChanged?.Invoke(RecordingState.Idle, null);
                RecordingCompleted?.Invoke(recordingId ?? "", fileName, phoneNumber ?? "", duration, fileInfo.Length, startTime);
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

    /// <summary>
    /// Convert WAV to MP3, skipping any leading silence.
    /// Silence is detected per-chunk: once any sample exceeds the threshold,
    /// all audio from that chunk onward is written. Zero-cost on files
    /// that start with audio; a single pass for files with leading silence.
    /// </summary>
    private static void ConvertToMp3(string wavPath, string mp3Path)
    {
        const float silenceThreshold = 0.005f; // ~ -46 dBFS
        const int bufferSamples = 4096;

        using var reader = new WaveFileReader(wavPath);
        var sampleReader = reader.ToSampleProvider();
        using var writer = new LameMP3FileWriter(mp3Path, reader.WaveFormat, LAMEPreset.STANDARD);

        var buffer = new float[bufferSamples];
        bool foundAudio = false;
        int bytesPerSample = reader.WaveFormat.BitsPerSample / 8;

        while (true)
        {
            int samplesRead = sampleReader.Read(buffer, 0, bufferSamples);
            if (samplesRead == 0) break;

            if (!foundAudio)
            {
                // Scan for the first sample above threshold
                int firstLoud = -1;
                for (int i = 0; i < samplesRead; i++)
                {
                    if (Math.Abs(buffer[i]) > silenceThreshold)
                    {
                        firstLoud = i;
                        break;
                    }
                }

                if (firstLoud < 0) continue; // entire chunk is silent, skip

                foundAudio = true;
                // Align to frame boundary (stereo = 2 samples per frame)
                int channels = reader.WaveFormat.Channels;
                firstLoud -= firstLoud % channels;
                WriteFloatsAsBytes(writer, buffer, firstLoud, samplesRead - firstLoud, bytesPerSample);
            }
            else
            {
                WriteFloatsAsBytes(writer, buffer, 0, samplesRead, bytesPerSample);
            }
        }
    }


    /// <summary>
    /// Convert float samples back to the byte format expected by LameMP3FileWriter.
    /// </summary>
    private static void WriteFloatsAsBytes(LameMP3FileWriter writer, float[] samples, int offset, int count, int bytesPerSample)
    {
        var byteBuffer = new byte[count * bytesPerSample];

        for (int i = 0; i < count; i++)
        {
            float sample = Math.Clamp(samples[offset + i], -1f, 1f);

            switch (bytesPerSample)
            {
                case 4: // 32-bit IEEE float
                    BitConverter.TryWriteBytes(byteBuffer.AsSpan(i * 4), sample);
                    break;
                case 3: // 24-bit PCM
                    int val24 = (int)(sample * 8388607f);
                    byteBuffer[i * 3]     = (byte)(val24 & 0xFF);
                    byteBuffer[i * 3 + 1] = (byte)((val24 >> 8) & 0xFF);
                    byteBuffer[i * 3 + 2] = (byte)((val24 >> 16) & 0xFF);
                    break;
                default: // 16-bit PCM
                    short val16 = (short)(sample * 32767f);
                    BitConverter.TryWriteBytes(byteBuffer.AsSpan(i * 2), val16);
                    break;
            }
        }

        writer.Write(byteBuffer, 0, byteBuffer.Length);
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
            if (_micCapture != null)
            {
                _micCapture.DataAvailable -= OnMicDataAvailable;
                _micCapture.Dispose();
                _micCapture = null;
            }
        }
        catch { }

        try
        {
            if (_loopbackCapture != null)
            {
                _loopbackCapture.DataAvailable -= OnLoopbackDataAvailable;
                _loopbackCapture.RecordingStopped -= OnRecordingStopped;
                _loopbackCapture.Dispose();
                _loopbackCapture = null;
            }
        }
        catch { }

        _micBuffer = null;
        _micMonoProvider = null;
        _watchdogThread = null;
    }

    /// <summary>
    /// Respond to CallStateFusion state changes.
    /// Auto-START only fires when AutoRecordEnabled is true, but auto-STOP
    /// always fires — a recording that's running when the call ends must stop
    /// regardless of how it was started (manual or auto).
    /// </summary>
    private void OnCallStateChanged(CallStateInfo info)
    {
        switch (info.State)
        {
            case CallState.Ringing when AutoRecordEnabled && RecordOnRinging:
                if (CurrentState == RecordingState.Idle && info.PhoneNumber != null)
                {
                    Debug.WriteLine("[Recorder] Auto-start on ringing");
                    StartRecording(info.PhoneNumber);
                }
                break;

            case CallState.Connected:
                if (AutoRecordEnabled && CurrentState == RecordingState.Idle && info.PhoneNumber != null)
                {
                    Debug.WriteLine("[Recorder] Auto-start on connected");
                    StartRecording(info.PhoneNumber);
                }
                break;

            // Always stop/discard on call end, regardless of AutoRecordEnabled
            case CallState.Ended:
                if (CurrentState == RecordingState.Recording)
                {
                    if (info.DurationSeconds > 0)
                    {
                        Debug.WriteLine("[Recorder] Auto-stop on ended");
                        StopRecording();
                    }
                    else
                    {
                        Debug.WriteLine("[Recorder] Auto-discard (unanswered)");
                        DiscardRecording();
                    }
                }
                break;

            // Fallback: if we somehow missed the Ended event and the fusion
            // returned to Idle while we're still recording, force-stop.
            case CallState.Idle:
                if (CurrentState == RecordingState.Recording)
                {
                    Debug.WriteLine("[Recorder] Fallback stop — fusion returned to Idle while still recording");
                    StopRecording();
                }
                break;
        }
    }

    public void Dispose()
    {
        _fusion.StateChanged -= OnCallStateChanged;
        if (_state == RecordingState.Recording)
        {
            _isRecordingActive = false;
            try { _micCapture?.StopRecording(); } catch { }
            try { _loopbackCapture?.StopRecording(); } catch { }
        }
        CleanupCapture();
    }
}
