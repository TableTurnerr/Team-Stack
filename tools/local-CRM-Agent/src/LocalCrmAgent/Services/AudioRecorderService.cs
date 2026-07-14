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
    private readonly DialIntentTracker? _intentTracker;
    private readonly ZoomAudioMonitor? _audioMonitor;
    private readonly ChromeCallMonitor _chromeMonitor;
    private readonly object _lock = new();

    private IAudioInput? _loopback;
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
    private string? _currentClientCallId;
    private string _currentChannel = "desktop";
    private RecordingState _state = RecordingState.Idle;

    // Web-phone dial hint. ChromeCallMonitor owns the web recording lifecycle but
    // has no phone number (it only sees Chrome's mic session go active). The
    // Chrome extension, however, relays the exact dialed E.164 (from GHL
    // click-to-call) over native messaging as a channel=web START. We stash it
    // here and bind it to the web recording so the bridge can contact-match and
    // correlate by phone+time — without it, web clips land with no phone and,
    // when the Zoom call_history public-IP resolve also misses, get parked in
    // GHL "review" instead of attached to the call. Guarded by its own lock so
    // it never nests with _lock.
    private readonly object _webHintLock = new();
    private string? _webDialHintPhone;
    private DateTime _webDialHintAt = DateTime.MinValue;
    private static readonly TimeSpan WebDialHintTtl = TimeSpan.FromSeconds(120);

    // Conversion-rescue pass: filenames whose WAV→MP3 conversion task is
    // currently in flight (normal post-call path), so the rescue scan never
    // races a live conversion. Guarded by its own lock — never nests with _lock.
    private readonly object _conversionLock = new();
    private readonly HashSet<string> _conversionsInFlight = new(StringComparer.OrdinalIgnoreCase);
    private readonly System.Threading.Timer _rescueTimer;
    private int _rescueRunning;

    // Safety: max recording duration (2 hours) — absolute ceiling.
    private const int MaxRecordingSeconds = 7200;

    // Web calls now end on a reliable signal (ChromeCallMonitor sees Chrome's
    // mic-capture session drop). This tighter cap is just a backstop in case that
    // session somehow never reports gone (e.g. Chrome crash mid-call).
    private const int WebMaxRecordingSeconds = 1800;

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
    /// Fired immediately when capture stops, BEFORE MP3 conversion. Args:
    /// recordingId, fileName, phoneNumber, duration, fileSize, startTime,
    /// clientCallId. duration/fileSize are best-effort estimates at this
    /// point — final values are reported via <see cref="RecordingConverted"/>.
    /// </summary>
    public event Action<string, string, string, int, long, DateTime, string?>? RecordingCompleted;
    /// <summary>
    /// Fired after WAV→MP3 conversion succeeds. Args: recordingId, fileName,
    /// final duration (seconds), final fileSize (bytes).
    /// </summary>
    public event Action<string, string, int, long>? RecordingConverted;

    public AudioRecorderService(
        RecordingStorageManager storage,
        CallStateFusion fusion,
        MicrophoneManager? micManager = null,
        DialIntentTracker? intentTracker = null,
        ZoomAudioMonitor? audioMonitor = null)
    {
        _storage = storage;
        _fusion = fusion;
        _micManager = micManager;
        _intentTracker = intentTracker;
        _audioMonitor = audioMonitor;
        _fusion.StateChanged += OnCallStateChanged;

        // Zoom web-phone (Chrome) call detection. Drives web recordings entirely
        // from the agent side via Chrome's mic-capture session lifecycle — the
        // Chrome extension's WebSocket heuristic can't separate individual web
        // calls (one persistent signaling socket per tab). See ChromeCallMonitor.
        _chromeMonitor = new ChromeCallMonitor();
        _chromeMonitor.WebCallStarted += OnWebCallStarted;
        _chromeMonitor.WebCallEnded += OnWebCallEnded;
        _chromeMonitor.StartWatching();

        // Un-strand failed conversions: entries left with ConversionComplete=false
        // (LAME timeout/failure or a crash mid-conversion) never appear in
        // GetPendingUploads, so their clips silently never upload. Sweep them
        // shortly after startup and then hourly — retry the conversion, or fall
        // back to uploading the raw WAV.
        _rescueTimer = new System.Threading.Timer(_ => _ = RescueStrandedConversionsAsync(), null,
            TimeSpan.FromSeconds(20), TimeSpan.FromHours(1));
    }

    /// <summary>True while a web-channel recording is in progress.</summary>
    public bool IsRecordingWebChannel
    {
        get { lock (_lock) return _state == RecordingState.Recording && IsWebChannel; }
    }

    // ── Agent-driven web-phone call lifecycle (Chrome mic session) ────

    /// <summary>
    /// Record the dialed number the Chrome extension relayed for a web-phone
    /// call (channel=web START). ChromeCallMonitor drives the recording, but this
    /// is the only reliable source of the external number for web calls. START
    /// and the Chrome-mic signal can arrive in either order, so we both stash the
    /// number for an imminent recording and bind it to one already in progress.
    /// </summary>
    public void NoteWebDialPhone(string? phoneE164)
    {
        if (string.IsNullOrWhiteSpace(phoneE164)) return;
        var phone = phoneE164.Trim();

        lock (_webHintLock)
        {
            _webDialHintPhone = phone;
            _webDialHintAt = DateTime.UtcNow;
        }

        // Mic session already opened the recording with no number (extension's
        // START lost the race) — attach the number to it now.
        lock (_lock)
        {
            if (_state == RecordingState.Recording && IsWebChannel &&
                string.IsNullOrWhiteSpace(_currentPhoneNumber))
            {
                _currentPhoneNumber = phone;
                FileLogger.Write($"[Recorder] Bound web dial phone {phone} to in-progress web recording");
            }
        }
    }

    /// <summary>Consume a fresh web dial hint (single-use so it can't leak into a later call).</summary>
    private string? TakeFreshWebDialPhone()
    {
        lock (_webHintLock)
        {
            if (_webDialHintPhone != null && DateTime.UtcNow - _webDialHintAt <= WebDialHintTtl)
            {
                var phone = _webDialHintPhone;
                _webDialHintPhone = null;
                return phone;
            }
            _webDialHintPhone = null; // drop stale hint
            return null;
        }
    }

    private void OnWebCallStarted()
    {
        // Only auto-start a web recording when nothing else is recording. A live
        // desktop call takes precedence; we never interrupt it for a (possibly
        // spurious) Chrome mic session.
        if (CurrentState != RecordingState.Idle)
        {
            FileLogger.Write("[Recorder] Web call detected but recorder busy — ignoring");
            return;
        }
        // Prefer the extension-relayed dialed number when it arrived first.
        // Otherwise the number binds via NoteWebDialPhone if START lands after
        // the mic signal, and failing both the upload resolver still tries the
        // Zoom call_history device/public-IP + time match.
        var phone = TakeFreshWebDialPhone() ?? string.Empty;
        FileLogger.Write($"[Recorder] Web call detected (Chrome mic) — starting recording (phone={(phone.Length == 0 ? "(pending)" : phone)})");
        StartRecording(phone, "web");
    }

    private void OnWebCallEnded()
    {
        lock (_lock)
        {
            if (_state != RecordingState.Recording || !IsWebChannel)
                return;
        }
        FileLogger.Write("[Recorder] Web call ended (Chrome mic released) — stopping recording");
        StopRecording();
    }

    /// <summary>
    /// Start recording system audio + microphone for the given phone number.
    /// If a previous recording is still running (stuck from a prior call),
    /// it is force-stopped first so the new recording can start cleanly.
    /// </summary>
    public (bool success, string? error) StartRecording(string phoneNumber, string channel = "desktop")
    {
        // Idempotent re-entry: a duplicate startRecording for the same phone
        // within a couple of seconds (e.g. dashboard sent it twice due to a
        // network hiccup, or auto-record fired alongside an explicit start)
        // should be a no-op rather than tearing down a healthy recording.
        // Without this guard the second call force-discards the first and
        // produces an orphan WAV/manifest entry that the upload loop later
        // has to clean up.
        lock (_lock)
        {
            if (_state == RecordingState.Recording &&
                string.Equals(_currentPhoneNumber, phoneNumber, StringComparison.Ordinal) &&
                (DateTime.UtcNow - _recordingStartTime).TotalSeconds < 2.0)
            {
                Debug.WriteLine($"[Recorder] Idempotent skip — recording for {phoneNumber} started <2s ago");
                return (true, null);
            }
        }

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
                _currentChannel = string.IsNullOrEmpty(channel) ? "desktop" : channel;
                _recordingStartTime = DateTime.UtcNow;
                _currentRecordingId = Guid.NewGuid().ToString("N")[..12]; // short unique ID

                // Pull the freshest dial intent's client call id so the
                // resulting recording is unambiguously bound to the dashboard
                // dial that started the call. The dashboard later links the
                // recording to a call_log by this id, avoiding the stale
                // "latestRecording" race when MP3 conversion lags.
                var intent = _intentTracker?.MostRecent();
                _currentClientCallId = intent?.ClientCallId;

                // Generate file paths — pass the recordingId so back-to-back
                // calls to the same number within the same millisecond don't
                // collide on disk.
                _tempWavPath = _storage.GenerateTempWavPath(phoneNumber, _currentRecordingId);
                _targetMp3Path = _storage.GenerateFilePath(phoneNumber, _currentRecordingId);

                // Loopback capture — ONLY the call app's audio. For a Zoom
                // desktop call we target the Zoom process tree; for a Zoom web
                // call we target Chrome. This is the remote party's voice; the
                // rep's mic is captured separately and mixed in below. Falls
                // back to full-system loopback only if the app can't be targeted.
                (_loopback, _outputSampleRate, _loopbackChannels) = StartLoopback(_currentChannel);

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

                    // Build a mono (+ resampled if needed) provider on top of the
                    // buffer. Down-mix ANY channel count (1..N) to mono — the old
                    // StereoToMonoSampleProvider threw "Source must be stereo" for
                    // non-2-channel mics, which silently dropped the rep's side and
                    // produced one-sided recordings.
                    ISampleProvider micProv = _micBuffer.ToSampleProvider();
                    if (_micChannels > 1)
                        micProv = new MonoDownMixSampleProvider(micProv);
                    if (_micCapture.WaveFormat.SampleRate != _outputSampleRate)
                        micProv = new WdlResamplingSampleProvider(micProv, _outputSampleRate);
                    _micMonoProvider = micProv;

                    _micCapture.DataAvailable += OnMicDataAvailable;

                    var micName = micDevice?.FriendlyName ?? "system default";
                    Debug.WriteLine($"[Recorder] Loopback: {_outputSampleRate}Hz, {_loopbackChannels}ch");
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

                // Loopback is already running (started in StartLoopback so it
                // captures from call connect). Start the mic now.
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

            try { _loopback?.StopRecording(); } catch (Exception ex)
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
            _currentClientCallId = null;
        }

        _isRecordingActive = false;

        // Detach events FIRST so stopping captures doesn't trigger OnRecordingStopped
        if (_loopback != null)
            _loopback.RecordingStopped -= OnRecordingStopped;

        try { _micCapture?.StopRecording(); } catch { }
        try { _loopback?.StopRecording(); } catch { }
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
    /// True while the active recording is a Zoom WEB-phone call. Web calls are
    /// started and stopped by the Chrome extension over native messaging; the
    /// desktop <see cref="CallStateFusion"/> (which only tracks Zoom DESKTOP
    /// audio sessions) never leaves Idle for them, so it must never drive a web
    /// recording's lifecycle.
    /// </summary>
    private bool IsWebChannel => string.Equals(_currentChannel, "web", StringComparison.OrdinalIgnoreCase);

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

            var maxSeconds = IsWebChannel ? WebMaxRecordingSeconds : MaxRecordingSeconds;
            if (elapsed > maxSeconds)
            {
                Debug.WriteLine($"[Recorder] Max duration ({maxSeconds}s) reached, forcing stop");
                ForceStopFromWatchdog();
                break;
            }

            // WEB recordings end on the extension's explicit stopRecording (or
            // the max-duration ceiling above), NEVER on the desktop fusion —
            // which stays Idle for web calls and was cutting them off at the
            // first 5s check.
            var callState = _fusion.CurrentState.State;
            if ((callState == CallState.Idle || callState == CallState.Ended) && !IsWebChannel)
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
        try { _loopback?.StopRecording(); } catch { } // triggers OnRecordingStopped
    }

    private void OnRecordingStopped(object? sender, StoppedEventArgs e)
    {
        string? tempWav;
        string? targetMp3;
        string? phoneNumber;
        string? recordingId;
        string? clientCallId;
        DateTime startTime;
        string channel;
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
            clientCallId = _currentClientCallId;
            startTime = _recordingStartTime;
            channel = _currentChannel;
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
        _storage.AddEntry(fileName, phoneNumber ?? "", startTime, recordingId, channel);
        if (clientCallId != null)
            _storage.UpdateEntry(fileName, entry => entry.ClientCallId = clientCallId);

        // Reset state + paths NOW so the next recording can start while
        // conversion runs in the background. The manifest entry is the
        // single source of truth for the in-flight file from this point on.
        var preliminaryDuration = (int)(DateTime.UtcNow - startTime).TotalSeconds;
        lock (_lock)
        {
            _state = RecordingState.Idle;
            _tempWavPath = null;
            _targetMp3Path = null;
            _currentPhoneNumber = null;
            _currentRecordingId = null;
            _currentClientCallId = null;
        }

        StateChanged?.Invoke(RecordingState.Idle, null);

        // Broadcast RecordingCompleted IMMEDIATELY — the dashboard wants to
        // know the recording exists right now, not 5 seconds later when MP3
        // conversion finishes. Final duration/fileSize are reported via
        // RecordingConverted once the WAV→MP3 pass completes.
        RecordingCompleted?.Invoke(recordingId ?? "", fileName, phoneNumber ?? "", preliminaryDuration, 0, startTime, clientCallId);

        // Convert WAV to MP3 on a background thread, with a 30s timeout so a
        // hung LAME encoder can never wedge the recorder permanently.
        lock (_conversionLock) { _conversionsInFlight.Add(fileName); }
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Run(() => ConvertToMp3(tempWav, targetMp3))
                    .WaitAsync(TimeSpan.FromSeconds(30));

                // Delete temp WAV only after a successful MP3 write — on
                // timeout/error we keep the WAV as a fallback so the audio
                // isn't lost.
                try { File.Delete(tempWav); } catch { }

                var fileInfo = new FileInfo(targetMp3);
                var duration = (int)(DateTime.UtcNow - startTime).TotalSeconds;

                // Update manifest with final file info. ConversionComplete must
                // be set here (not before) — GetPendingUploads gates on it so
                // the upload service can't grab the MP3 while LameMP3FileWriter
                // still holds it open for write, which was producing truncated
                // / glitching uploads on the server side.
                _storage.UpdateEntry(fileName, e =>
                {
                    e.DurationSeconds = duration;
                    e.FileSizeBytes = fileInfo.Length;
                    e.ConversionComplete = true;
                });

                // Logged via FileLogger (not Debug.WriteLine) so it survives
                // into Release builds — a missing "Converted" line for a call
                // is the signal that conversion silently failed below.
                FileLogger.Write($"[Recorder] Converted: {fileName} ({duration}s, {fileInfo.Length} bytes) — queued for upload");

                RecordingConverted?.Invoke(recordingId ?? "", fileName, duration, fileInfo.Length);
            }
            catch (TimeoutException)
            {
                // ConversionComplete stays false → GetPendingUploads skips this
                // entry forever, so the clip never uploads. Make that visible.
                FileLogger.Write($"[Recorder] MP3 conversion TIMED OUT (30s) for {fileName} — clip will NOT upload (WAV kept as fallback)");
                _storage.UpdateEntry(fileName, e =>
                {
                    e.Error = "conversion timeout";
                    e.ConversionComplete = false;
                });
            }
            catch (Exception ex)
            {
                // Same as above: a failed conversion means the clip never
                // becomes a pending upload. This used to log via Debug.WriteLine
                // (a no-op in Release), which is why such failures were silent.
                FileLogger.Write($"[Recorder] MP3 conversion FAILED for {fileName}: {ex.GetType().Name}: {ex.Message} — clip will NOT upload (WAV kept as fallback)");
                // Keep the WAV file as fallback — do not delete tempWav here.
                _storage.UpdateEntry(fileName, e =>
                {
                    e.Error = ex.Message;
                    e.ConversionComplete = false;
                });
            }
            finally
            {
                lock (_conversionLock) { _conversionsInFlight.Remove(fileName); }
            }
        });
    }

    // ── Conversion rescue (un-strand failed conversions) ──────────────

    /// <summary>
    /// Sweep the manifest for entries stranded with ConversionComplete=false
    /// whose temp WAV still exists: retry the WAV→MP3 conversion; if it fails
    /// again, fall back to uploading the raw WAV (the upload path already sends
    /// audio/wav) so no clip is ever silently lost. Runs at startup and hourly.
    /// </summary>
    internal async Task RescueStrandedConversionsAsync()
    {
        // Single-flight: the hourly tick must never overlap a long-running pass.
        if (Interlocked.Exchange(ref _rescueRunning, 1) == 1) return;
        try
        {
            var stranded = _storage.GetStrandedConversions();
            foreach (var entry in stranded)
            {
                // Skip conversions still in flight from a live recording stop.
                lock (_conversionLock)
                {
                    if (_conversionsInFlight.Contains(entry.FileName)) continue;
                }

                // Skip anything belonging to the recording currently in progress.
                lock (_lock)
                {
                    if (_state != RecordingState.Idle && _targetMp3Path != null &&
                        string.Equals(Path.GetFileName(_targetMp3Path), entry.FileName, StringComparison.OrdinalIgnoreCase))
                        continue;
                }

                try { await RescueEntryAsync(entry); }
                catch (Exception ex)
                {
                    FileLogger.Write($"[Recorder] Rescue error for {entry.FileName}: {ex.GetType().Name}: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[Recorder] Conversion rescue pass failed: {ex.Message}");
        }
        finally
        {
            Interlocked.Exchange(ref _rescueRunning, 0);
        }
    }

    private async Task RescueEntryAsync(RecordingEntry entry)
    {
        var dir = _storage.RecordingsDirectory;
        var mp3Path = Path.Combine(dir, entry.FileName);
        var wavPath = FindTempWav(dir, entry);

        if (wavPath == null)
        {
            if (File.Exists(mp3Path))
            {
                // Conversion actually finished but the manifest update was lost
                // (e.g. process died between the MP3 write and UpdateEntry).
                var fi = new FileInfo(mp3Path);
                _storage.UpdateEntry(entry.FileName, e =>
                {
                    e.FileSizeBytes = fi.Length;
                    e.ConversionComplete = true;
                    e.Error = null;
                    e.RetryCount = 0;
                });
                FileLogger.Write($"[Recorder] Rescued {entry.FileName}: MP3 already on disk — marked uploadable");
            }
            else if (entry.Error?.StartsWith("stranded") != true)
            {
                // Nothing left on disk to recover — mark it failed LOUDLY so it
                // shows in the tray's failed count instead of vanishing quietly.
                _storage.UpdateEntry(entry.FileName, e => e.Error = "stranded: source WAV and MP3 both missing");
                FileLogger.Write($"[Recorder] Cannot rescue {entry.FileName}: neither WAV nor MP3 exists — marked failed");
            }
            return;
        }

        // Best-effort duration from the WAV header (the entry usually has none
        // when conversion never completed).
        int wavDuration = 0;
        try { using var r = new WaveFileReader(wavPath); wavDuration = (int)r.TotalTime.TotalSeconds; } catch { }

        // 1) Retry the LAME conversion. We're idle here (not post-call), so give
        //    it a more generous timeout than the 30s fast path.
        try
        {
            await Task.Run(() => ConvertToMp3(wavPath, mp3Path))
                .WaitAsync(TimeSpan.FromSeconds(60));

            try { File.Delete(wavPath); } catch { }

            var fileInfo = new FileInfo(mp3Path);
            _storage.UpdateEntry(entry.FileName, e =>
            {
                if (e.DurationSeconds <= 0 && wavDuration > 0) e.DurationSeconds = wavDuration;
                e.FileSizeBytes = fileInfo.Length;
                e.ConversionComplete = true;
                e.Error = null;
                e.RetryCount = 0;
            });
            FileLogger.Write($"[Recorder] Rescued stranded conversion: {entry.FileName} ({wavDuration}s, {fileInfo.Length} bytes) — queued for upload");
            RecordingConverted?.Invoke(entry.RecordingId ?? "", entry.FileName, wavDuration, fileInfo.Length);
            return;
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[Recorder] Conversion retry failed for {entry.FileName}: {ex.GetType().Name}: {ex.Message} — falling back to WAV upload");
            // Drop any partial MP3 the failed retry left behind.
            try { if (File.Exists(mp3Path)) File.Delete(mp3Path); } catch { }
        }

        // 2) Fall back to uploading the raw WAV: strip the ".tmp_" prefix so the
        //    file no longer looks temporary, point the manifest entry at it and
        //    mark it conversion-complete so GetPendingUploads picks it up (the
        //    upload path already sends audio/wav for .wav files).
        var wavFileName = Path.GetFileName(wavPath);
        if (wavFileName.StartsWith(".tmp_", StringComparison.OrdinalIgnoreCase))
        {
            var cleanName = wavFileName[".tmp_".Length..];
            var cleanPath = Path.Combine(dir, cleanName);
            try
            {
                if (!File.Exists(cleanPath))
                {
                    File.Move(wavPath, cleanPath);
                    wavFileName = cleanName;
                    wavPath = cleanPath;
                }
            }
            catch { /* keep the .tmp_ name — it still uploads fine */ }
        }

        var wavInfo = new FileInfo(wavPath);
        _storage.UpdateEntry(entry.FileName, e =>
        {
            e.FileName = wavFileName; // upload the WAV instead of the missing MP3
            if (e.DurationSeconds <= 0 && wavDuration > 0) e.DurationSeconds = wavDuration;
            e.FileSizeBytes = wavInfo.Length;
            e.ConversionComplete = true;
            e.Error = null;
            e.RetryCount = 0;
        });
        FileLogger.Write($"[Recorder] Rescued {entry.FileName} as WAV: {wavFileName} ({wavDuration}s, {wavInfo.Length} bytes) — queued for upload");
        RecordingConverted?.Invoke(entry.RecordingId ?? "", wavFileName, wavDuration, wavInfo.Length);
    }

    /// <summary>
    /// Locate the kept temp WAV for a stranded entry. The WAV and MP3 names are
    /// generated back-to-back so they normally share the same timestamp, but can
    /// differ by a millisecond — fall back to matching on the unique recording id.
    /// </summary>
    private static string? FindTempWav(string dir, RecordingEntry entry)
    {
        var exact = Path.Combine(dir, ".tmp_" + Path.GetFileNameWithoutExtension(entry.FileName) + ".wav");
        if (File.Exists(exact)) return exact;

        if (!string.IsNullOrEmpty(entry.RecordingId))
        {
            try
            {
                var byId = Directory.GetFiles(dir, $".tmp_*_{entry.RecordingId}.wav");
                if (byId.Length > 0) return byId[0];
            }
            catch { }
        }
        return null;
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

    /// <summary>
    /// Create and START the loopback source for this call's channel, preferring
    /// process-scoped capture (only the Zoom desktop app, or only Chrome for a
    /// web call) and falling back to full-system loopback if the target process
    /// can't be found or the OS doesn't support process loopback. Returns the
    /// started source plus its sample rate / channel count.
    /// </summary>
    private (IAudioInput source, int sampleRate, int channels) StartLoopback(string channel)
    {
        if (ProcessLoopbackCapture.IsSupported)
        {
            // For desktop, hint the exact process that currently owns Zoom's
            // active render session (usually the CptHost child) so we target it
            // precisely; INCLUDE_TREE then also covers its children.
            int hintPid = 0;
            if (channel != "web")
            {
                try { hintPid = _audioMonitor?.GetZoomAudioState()?.ProcessId ?? 0; } catch { }
            }

            var target = AudioCaptureTarget.Resolve(channel, hintPid);
            if (target is { } t)
            {
                var pc = new ProcessLoopbackCapture(t.Pid, includeProcessTree: true);
                pc.DataAvailable += OnLoopbackDataAvailable;
                pc.RecordingStopped += OnRecordingStopped;
                try
                {
                    pc.StartRecording();
                    FileLogger.Write($"[Recorder] Capturing {(channel == "web" ? "Chrome" : "Zoom")} audio only ({t.Label} pid={t.Pid})");
                    return (pc, pc.WaveFormat.SampleRate, pc.WaveFormat.Channels);
                }
                catch (Exception ex)
                {
                    pc.DataAvailable -= OnLoopbackDataAvailable;
                    pc.RecordingStopped -= OnRecordingStopped;
                    try { pc.Dispose(); } catch { }
                    FileLogger.Write($"[Recorder] Process loopback failed ({ex.Message}); using full-system audio");
                }
            }
            else
            {
                FileLogger.Write($"[Recorder] No {(channel == "web" ? "Chrome" : "Zoom")} process to target; using full-system audio");
            }
        }

        var sys = new WasapiLoopbackInput();
        sys.DataAvailable += OnLoopbackDataAvailable;
        sys.RecordingStopped += OnRecordingStopped;
        sys.StartRecording();
        return (sys, sys.WaveFormat.SampleRate, sys.WaveFormat.Channels);
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
            if (_loopback != null)
            {
                _loopback.DataAvailable -= OnLoopbackDataAvailable;
                _loopback.RecordingStopped -= OnRecordingStopped;
                _loopback.Dispose();
                _loopback = null;
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
                if (AutoRecordEnabled && CurrentState == RecordingState.Idle)
                {
                    // Desktop calls on the shared Zoom account usually have no
                    // number available locally — the worker (and the uploader's
                    // call_history device-IP match) resolve it afterward — so do
                    // NOT gate recording on a known phone number. Record with an
                    // empty number; it's filled in at upload time.
                    Debug.WriteLine("[Recorder] Auto-start on connected");
                    StartRecording(info.PhoneNumber ?? "");
                }
                break;

            // Always stop on call end, regardless of AutoRecordEnabled. Never
            // discard — even very short / "unanswered" recordings can hold a
            // voicemail leave, dial-tone confirmation, or otherwise useful
            // audio. The dashboard decides whether to keep or drop the file.
            case CallState.Ended:
                if (CurrentState == RecordingState.Recording && !IsWebChannel)
                {
                    Debug.WriteLine($"[Recorder] Auto-stop on ended (duration={info.DurationSeconds}s)");
                    StopRecording();
                }
                break;

            // Fallback: if we somehow missed the Ended event and the fusion
            // returned to Idle while we're still recording, force-stop.
            case CallState.Idle:
                if (CurrentState == RecordingState.Recording && !IsWebChannel)
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
        try { _rescueTimer.Dispose(); } catch { }
        try
        {
            _chromeMonitor.WebCallStarted -= OnWebCallStarted;
            _chromeMonitor.WebCallEnded -= OnWebCallEnded;
            _chromeMonitor.Dispose();
        }
        catch { }
        if (_state == RecordingState.Recording)
        {
            _isRecordingActive = false;
            try { _micCapture?.StopRecording(); } catch { }
            try { _loopback?.StopRecording(); } catch { }
        }
        CleanupCapture();
    }
}

/// <summary>
/// Down-mixes any channel count (1..N) to a single mono channel by averaging.
/// Replaces NAudio's StereoToMonoSampleProvider, which requires exactly two
/// channels and otherwise throws "Source must be stereo" — the bug that was
/// dropping the rep's microphone and producing one-sided recordings.
/// </summary>
internal sealed class MonoDownMixSampleProvider : ISampleProvider
{
    private readonly ISampleProvider _source;
    private readonly int _channels;
    private float[] _buffer = [];

    public WaveFormat WaveFormat { get; }

    public MonoDownMixSampleProvider(ISampleProvider source)
    {
        _source = source;
        _channels = source.WaveFormat.Channels;
        WaveFormat = WaveFormat.CreateIeeeFloatWaveFormat(source.WaveFormat.SampleRate, 1);
    }

    public int Read(float[] buffer, int offset, int count)
    {
        if (_channels <= 1) return _source.Read(buffer, offset, count);

        int needed = count * _channels;
        if (_buffer.Length < needed) _buffer = new float[needed];

        int read = _source.Read(_buffer, 0, needed);
        int frames = read / _channels;
        for (int f = 0; f < frames; f++)
        {
            float sum = 0f;
            for (int c = 0; c < _channels; c++) sum += _buffer[f * _channels + c];
            buffer[offset + f] = sum / _channels;
        }
        return frames;
    }
}
