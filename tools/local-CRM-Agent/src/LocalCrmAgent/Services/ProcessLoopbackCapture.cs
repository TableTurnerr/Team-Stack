using System.Diagnostics;
using System.Runtime.InteropServices;
using NAudio.CoreAudioApi;
using NAudio.Wave;

namespace LocalCrmAgent.Services;

/// <summary>
/// Minimal capture surface shared by the two loopback sources so
/// <see cref="AudioRecorderService"/> has a single mixing path. Mirrors the
/// shape of NAudio's <c>IWaveIn</c> but is implemented by both our
/// process-scoped capture (<see cref="ProcessLoopbackCapture"/>) and the
/// full-system fallback (<see cref="WasapiLoopbackInput"/>).
///
/// Implementations ALWAYS deliver 32-bit IEEE float samples in
/// <see cref="DataAvailable"/> so the mixer never has to branch on bit depth.
/// </summary>
internal interface IAudioInput : IDisposable
{
    WaveFormat WaveFormat { get; }
    event EventHandler<WaveInEventArgs>? DataAvailable;
    event EventHandler<StoppedEventArgs>? RecordingStopped;
    void StartRecording();
    void StopRecording();
}

/// <summary>
/// Captures ONLY the audio rendered by a target process and its child
/// process tree, using the Windows Process Loopback API
/// (<c>ActivateAudioInterfaceAsync</c> with <c>AUDIOCLIENT_ACTIVATION_PARAMS</c>,
/// available since Windows 10 2004 / build 19041). This is what lets the
/// recorder capture the Zoom desktop app's call audio (or Chrome's, for the
/// web phone) while excluding every other sound on the machine — music,
/// notifications, other browser tabs.
///
/// The remote party's voice is what the target app renders, so this provides
/// the "their side" of the call. The rep's own microphone is captured
/// separately and mixed in by <see cref="AudioRecorderService"/>.
///
/// Output is normalised to 32-bit IEEE float, 2-channel, 48 kHz regardless of
/// the format the engine hands us (it converts 16-bit PCM up to float
/// internally) so the downstream mixer has a single, stable format.
/// </summary>
internal sealed class ProcessLoopbackCapture : IAudioInput
{
    // Target sample rate / channel count we ask the engine for. The engine
    // resamples/mixes the target app's stream to this in shared mode.
    private const int OutSampleRate = 48000;
    private const int OutChannels = 2;

    private readonly uint _targetPid;
    private readonly bool _includeTree;

    private IAudioClient? _audioClient;
    private IAudioCaptureClient? _captureClient;
    private AutoResetEvent? _bufferReady;
    private Thread? _thread;
    private volatile bool _stop;

    private bool _captureIsFloat;     // true: engine gave us float; false: PCM16 → convert
    private int _captureBlockAlign;   // bytes per frame in the capture format

    public WaveFormat WaveFormat { get; } = WaveFormat.CreateIeeeFloatWaveFormat(OutSampleRate, OutChannels);

    public event EventHandler<WaveInEventArgs>? DataAvailable;
    public event EventHandler<StoppedEventArgs>? RecordingStopped;

    /// <summary>The process-loopback API needs Windows 10 build 19041+.</summary>
    public static bool IsSupported => Environment.OSVersion.Version.Build >= 19041;

    public ProcessLoopbackCapture(uint targetProcessId, bool includeProcessTree = true)
    {
        _targetPid = targetProcessId;
        _includeTree = includeProcessTree;
    }

    public void StartRecording()
    {
        if (_thread != null) return;
        _stop = false;

        // Run activation + the whole capture lifecycle on ONE dedicated MTA
        // thread so the COM objects are never marshalled across apartments.
        // StartRecording blocks until activation either succeeds or fails so
        // the caller can fall back to system loopback on failure.
        var initDone = new ManualResetEventSlim(false);
        Exception? initError = null;

        _thread = new Thread(() =>
        {
            try
            {
                Activate();              // throws on failure
                _audioClient!.Start();
                initDone.Set();          // signal success BEFORE entering the loop
                CaptureLoop();
            }
            catch (Exception ex)
            {
                initError = ex;
                initDone.Set();
            }
            finally
            {
                CleanupComObjects();
            }
        })
        { IsBackground = true, Name = "ProcLoopbackCapture" };
        _thread.Start();

        if (!initDone.Wait(TimeSpan.FromSeconds(5)))
            initError ??= new TimeoutException("Process loopback activation timed out");

        if (initError != null)
        {
            _stop = true;
            try { _thread.Join(1000); } catch { }
            _thread = null;
            throw initError;
        }
    }

    public void StopRecording()
    {
        if (_thread == null) return;
        _stop = true;
        try { _bufferReady?.Set(); } catch { }
        try { _thread.Join(2000); } catch { }
        _thread = null;
        RecordingStopped?.Invoke(this, new StoppedEventArgs());
    }

    public void Dispose()
    {
        _stop = true;
        try { _bufferReady?.Set(); } catch { }
        try { _thread?.Join(1000); } catch { }
        _thread = null;
        CleanupComObjects();
    }

    // ── Activation ────────────────────────────────────────────────────────

    private void Activate()
    {
        // Try float first (the WASAPI mix format is float, so this normally
        // succeeds and avoids a conversion). Fall back to 16-bit PCM if the
        // engine rejects float for this stream.
        if (TryActivate(useFloat: true)) { _captureIsFloat = true; return; }
        if (TryActivate(useFloat: false)) { _captureIsFloat = false; return; }
        throw new InvalidOperationException(
            $"Process loopback could not be initialised for pid {_targetPid} (format not accepted)");
    }

    private bool TryActivate(bool useFloat)
    {
        IntPtr pParams = IntPtr.Zero, pProp = IntPtr.Zero, pFormat = IntPtr.Zero;
        try
        {
            // Build AUDIOCLIENT_ACTIVATION_PARAMS { ActivationType=PROCESS_LOOPBACK,
            //   ProcessLoopbackParams { TargetProcessId, Mode } } and wrap it in a
            // VT_BLOB PROPVARIANT (x64 layout).
            pParams = Marshal.AllocHGlobal(12);
            Marshal.WriteInt32(pParams, 0, 1);                       // AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK
            Marshal.WriteInt32(pParams, 4, (int)_targetPid);         // TargetProcessId
            Marshal.WriteInt32(pParams, 8, _includeTree ? 0 : 1);    // 0 = INCLUDE_TARGET_PROCESS_TREE

            pProp = Marshal.AllocHGlobal(24);
            for (int i = 0; i < 24; i++) Marshal.WriteByte(pProp, i, 0);
            Marshal.WriteInt16(pProp, 0, (short)VT_BLOB);            // vt
            Marshal.WriteInt32(pProp, 8, 12);                        // blob.cbSize
            Marshal.WriteIntPtr(pProp, 16, pParams);                 // blob.pBlobData

            var handler = new ActivateHandler();
            var iidAudioClient = IID_IAudioClient;
            ActivateAudioInterfaceAsync(VirtualAudioDeviceProcessLoopback, ref iidAudioClient,
                pProp, handler, out _);

            if (!handler.Done.Wait(TimeSpan.FromSeconds(4)) || handler.Operation == null)
                return false;

            handler.Operation.GetActivateResult(out int hr, out object clientObj);
            if (hr < 0 || clientObj is not IAudioClient client)
                return false;

            _audioClient = client;

            pFormat = BuildWaveFormat(useFloat);
            _captureBlockAlign = useFloat ? OutChannels * 4 : OutChannels * 2;

            const int AUDCLNT_SHAREMODE_SHARED = 0;
            const int AUDCLNT_STREAMFLAGS_LOOPBACK = 0x00020000;
            const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x00040000;
            const long hns200ms = 2_000_000;

            int initHr = client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                hns200ms, 0, pFormat, IntPtr.Zero);
            if (initHr < 0)
            {
                // Release this client so the PCM16 retry starts clean.
                _audioClient = null;
                try { Marshal.ReleaseComObject(client); } catch { }
                return false;
            }

            _bufferReady = new AutoResetEvent(false);
            client.SetEventHandle(_bufferReady.SafeWaitHandle.DangerousGetHandle());

            var iidCapture = IID_IAudioCaptureClient;
            if (client.GetService(ref iidCapture, out object svc) < 0 || svc is not IAudioCaptureClient cap)
            {
                _audioClient = null;
                try { Marshal.ReleaseComObject(client); } catch { }
                return false;
            }
            _captureClient = cap;
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ProcLoopback] activate ({(useFloat ? "float" : "pcm16")}) failed: {ex.Message}");
            return false;
        }
        finally
        {
            if (pParams != IntPtr.Zero) Marshal.FreeHGlobal(pParams);
            if (pProp != IntPtr.Zero) Marshal.FreeHGlobal(pProp);
            if (pFormat != IntPtr.Zero) Marshal.FreeHGlobal(pFormat);
        }
    }

    /// <summary>Allocate a WAVEFORMATEX (18 bytes) for float or PCM16 stereo @ 48 kHz.</summary>
    private static IntPtr BuildWaveFormat(bool useFloat)
    {
        const int WAVE_FORMAT_PCM = 1;
        const int WAVE_FORMAT_IEEE_FLOAT = 3;

        short bits = (short)(useFloat ? 32 : 16);
        short channels = OutChannels;
        int rate = OutSampleRate;
        short blockAlign = (short)(channels * bits / 8);
        int avgBytes = rate * blockAlign;

        IntPtr p = Marshal.AllocHGlobal(18);
        Marshal.WriteInt16(p, 0, (short)(useFloat ? WAVE_FORMAT_IEEE_FLOAT : WAVE_FORMAT_PCM)); // wFormatTag
        Marshal.WriteInt16(p, 2, channels);   // nChannels
        Marshal.WriteInt32(p, 4, rate);       // nSamplesPerSec
        Marshal.WriteInt32(p, 8, avgBytes);   // nAvgBytesPerSec
        Marshal.WriteInt16(p, 12, blockAlign);// nBlockAlign
        Marshal.WriteInt16(p, 14, bits);      // wBitsPerSample
        Marshal.WriteInt16(p, 16, 0);         // cbSize
        return p;
    }

    // ── Capture loop ──────────────────────────────────────────────────────

    private void CaptureLoop()
    {
        const uint AUDCLNT_BUFFERFLAGS_SILENT = 0x2;
        var cap = _captureClient!;

        while (!_stop)
        {
            // Event-driven: woken each engine period. Poll fallback (200 ms)
            // guards against a missed signal so we never wedge.
            _bufferReady!.WaitOne(200);
            if (_stop) break;

            try
            {
                cap.GetNextPacketSize(out uint packetFrames);
                while (packetFrames != 0 && !_stop)
                {
                    int hr = cap.GetBuffer(out IntPtr dataPtr, out uint frames,
                        out uint flags, out _, out _);
                    if (hr < 0) break;

                    bool silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;
                    byte[] outBytes = ConvertToFloatBytes(dataPtr, frames, silent);

                    cap.ReleaseBuffer(frames);

                    if (outBytes.Length > 0)
                    {
                        try { DataAvailable?.Invoke(this, new WaveInEventArgs(outBytes, outBytes.Length)); }
                        catch (Exception ex) { Debug.WriteLine($"[ProcLoopback] consumer error: {ex.Message}"); }
                    }

                    cap.GetNextPacketSize(out packetFrames);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ProcLoopback] capture error: {ex.Message}");
                break;
            }
        }

        try { _audioClient?.Stop(); } catch { }
    }

    /// <summary>
    /// Copy one captured packet into a fresh 32-bit float byte buffer,
    /// converting from PCM16 when the engine handed us PCM. Silent packets
    /// (the engine signals these instead of writing zeros) become zeros so
    /// the timeline stays continuous.
    /// </summary>
    private byte[] ConvertToFloatBytes(IntPtr dataPtr, uint frames, bool silent)
    {
        int frameCount = (int)frames;
        if (frameCount == 0) return [];

        if (_captureIsFloat)
        {
            int bytes = frameCount * _captureBlockAlign; // already float
            var outBytes = new byte[bytes];
            if (!silent && dataPtr != IntPtr.Zero)
                Marshal.Copy(dataPtr, outBytes, 0, bytes);
            return outBytes;
        }

        // PCM16 → float: each 16-bit sample becomes a 4-byte float.
        int sampleCount = frameCount * OutChannels;
        var floatBytes = new byte[sampleCount * 4];
        if (!silent && dataPtr != IntPtr.Zero)
        {
            var pcm = new byte[frameCount * _captureBlockAlign];
            Marshal.Copy(dataPtr, pcm, 0, pcm.Length);
            for (int i = 0; i < sampleCount; i++)
            {
                short s = (short)(pcm[i * 2] | (pcm[i * 2 + 1] << 8));
                float f = s / 32768f;
                BitConverter.TryWriteBytes(floatBytes.AsSpan(i * 4), f);
            }
        }
        return floatBytes;
    }

    private void CleanupComObjects()
    {
        try { if (_captureClient != null) { Marshal.ReleaseComObject(_captureClient); _captureClient = null; } } catch { }
        try { if (_audioClient != null) { Marshal.ReleaseComObject(_audioClient); _audioClient = null; } } catch { }
        try { _bufferReady?.Dispose(); _bufferReady = null; } catch { }
    }

    // ── COM interop ───────────────────────────────────────────────────────

    private const int VT_BLOB = 0x0041;
    private const string VirtualAudioDeviceProcessLoopback = "VAD\\Process_Loopback";

    private static Guid IID_IAudioClient = new("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    private static Guid IID_IAudioCaptureClient = new("C8ADBD64-E71E-48a0-A4DE-185C395CD317");

    [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
    private static extern void ActivateAudioInterfaceAsync(
        [In, MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [In] ref Guid riid,
        [In] IntPtr activationParams,
        [In] IActivateAudioInterfaceCompletionHandler completionHandler,
        out IActivateAudioInterfaceAsyncOperation activationOperation);

    private sealed class ActivateHandler : IActivateAudioInterfaceCompletionHandler
    {
        public readonly ManualResetEventSlim Done = new(false);
        public IActivateAudioInterfaceAsyncOperation? Operation;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation)
        {
            Operation = activateOperation;
            Done.Set();
        }
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation activateOperation);
    }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult([MarshalAs(UnmanagedType.Error)] out int activateResult,
            [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, int streamFlags, long hnsBufferDuration,
            long hnsPeriodicity, IntPtr format, IntPtr audioSessionGuid);
        [PreserveSig] int GetBufferSize(out uint numBufferFrames);
        [PreserveSig] int GetStreamLatency(out long phnsLatency);
        [PreserveSig] int GetCurrentPadding(out uint numPaddingFrames);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closestMatch);
        [PreserveSig] int GetMixFormat(out IntPtr deviceFormat);
        [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr eventHandle);
        [PreserveSig] int GetService(ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr dataBuffer, out uint numFramesToRead,
            out uint bufferFlags, out long devicePosition, out long qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint numFramesRead);
        [PreserveSig] int GetNextPacketSize(out uint numFramesInNextPacket);
    }
}

/// <summary>
/// Full-system WASAPI loopback wrapped as an <see cref="IAudioInput"/>. Used
/// as a fallback when process-scoped loopback can't be initialised (target
/// app not found, unsupported OS) so a call is never lost — at the cost of
/// also capturing other system sounds. NAudio's loopback delivers float, so
/// no conversion is needed.
/// </summary>
internal sealed class WasapiLoopbackInput : IAudioInput
{
    private readonly WasapiLoopbackCapture _cap = new();

    public WaveFormat WaveFormat => _cap.WaveFormat;

    public event EventHandler<WaveInEventArgs>? DataAvailable
    {
        add => _cap.DataAvailable += value;
        remove => _cap.DataAvailable -= value;
    }

    public event EventHandler<StoppedEventArgs>? RecordingStopped
    {
        add => _cap.RecordingStopped += value;
        remove => _cap.RecordingStopped -= value;
    }

    public void StartRecording() => _cap.StartRecording();
    public void StopRecording() => _cap.StopRecording();
    public void Dispose() => _cap.Dispose();
}
