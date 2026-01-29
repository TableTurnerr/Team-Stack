using NAudio.Wave;
using NAudio.Lame;
using System.Collections.Concurrent;

namespace CallRecorder.Core.Services;

/// <summary>
/// Service for recording audio from microphone and desktop
/// </summary>
public class AudioRecorderService : IDisposable
{
    private WaveInEvent? _micCapture;
    private WasapiLoopbackCapture? _desktopCapture;
    private Mp3FileWriter? _mp3Writer;
    private WaveFormat? _outputFormat;
    
    private readonly ConcurrentQueue<byte[]> _micBuffer = new();
    private readonly ConcurrentQueue<byte[]> _desktopBuffer = new();
    
    private bool _isRecording;
    private string? _currentFilePath;
    private DateTime _recordingStartTime;
    
    private CancellationTokenSource? _mixerTokenSource;
    
    // Audio levels for visualization
    public float MicLevel { get; private set; }
    public float DesktopLevel { get; private set; }
    
    public event EventHandler<float>? MicLevelChanged;
    public event EventHandler<float>? DesktopLevelChanged;
    public event EventHandler<string>? RecordingError;
    
    public bool IsRecording => _isRecording;
    public TimeSpan Duration => _isRecording ? DateTime.Now - _recordingStartTime : TimeSpan.Zero;
    public string? CurrentFilePath => _currentFilePath;
    
    /// <summary>
    /// Gets available microphone devices
    /// </summary>
    public List<(int Index, string Name)> GetMicrophoneDevices()
    {
        var devices = new List<(int, string)>();
        for (int i = 0; i < WaveIn.DeviceCount; i++)
        {
            var caps = WaveIn.GetCapabilities(i);
            devices.Add((i, caps.ProductName));
        }
        return devices;
    }
    
    /// <summary>
    /// Starts recording audio
    /// </summary>
    public bool StartRecording(string filePath, int micDeviceIndex = 0, int bitrate = 128)
    {
        if (_isRecording)
            return false;
        
        try
        {
            _currentFilePath = filePath;
            _recordingStartTime = DateTime.Now;
            
            // Ensure directory exists
            var dir = Path.GetDirectoryName(filePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }
            
            // Output format: 44.1kHz, 16-bit, stereo
            _outputFormat = new WaveFormat(44100, 16, 2);
            
            // Initialize MP3 writer
            _mp3Writer = new Mp3FileWriter(filePath, _outputFormat, bitrate);
            
            // Initialize microphone capture
            _micCapture = new WaveInEvent
            {
                DeviceNumber = micDeviceIndex,
                WaveFormat = _outputFormat,
                BufferMilliseconds = 50
            };
            _micCapture.DataAvailable += OnMicDataAvailable;
            
            // Initialize desktop audio capture (loopback)
            _desktopCapture = new WasapiLoopbackCapture();
            _desktopCapture.DataAvailable += OnDesktopDataAvailable;
            
            // Start capture
            _micCapture.StartRecording();
            _desktopCapture.StartRecording();
            
            // Start mixer thread
            _mixerTokenSource = new CancellationTokenSource();
            Task.Run(MixerLoopAsync, _mixerTokenSource.Token);
            
            _isRecording = true;
            return true;
        }
        catch (Exception ex)
        {
            RecordingError?.Invoke(this, $"Failed to start recording: {ex.Message}");
            Cleanup();
            return false;
        }
    }
    
    /// <summary>
    /// Stops recording and saves the file
    /// </summary>
    public string? StopRecording()
    {
        if (!_isRecording)
            return null;
        
        _isRecording = false;
        
        try
        {
            // Stop mixer
            _mixerTokenSource?.Cancel();
            
            // Stop capture
            _micCapture?.StopRecording();
            _desktopCapture?.StopRecording();
            
            // Flush remaining buffers
            Task.Delay(100).Wait();
            ProcessRemainingBuffers();
            
            // Close writer
            _mp3Writer?.Dispose();
            _mp3Writer = null;
            
            var filePath = _currentFilePath;
            Cleanup();
            
            return filePath;
        }
        catch (Exception ex)
        {
            RecordingError?.Invoke(this, $"Error stopping recording: {ex.Message}");
            Cleanup();
            return null;
        }
    }
    
    private void OnMicDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded > 0)
        {
            var buffer = new byte[e.BytesRecorded];
            Array.Copy(e.Buffer, buffer, e.BytesRecorded);
            _micBuffer.Enqueue(buffer);
            
            // Calculate level
            MicLevel = CalculateLevel(buffer);
            MicLevelChanged?.Invoke(this, MicLevel);
        }
    }
    
    private void OnDesktopDataAvailable(object? sender, WaveInEventArgs e)
    {
        if (e.BytesRecorded > 0)
        {
            // Convert from loopback format to output format
            var converted = ConvertToOutputFormat(e.Buffer, e.BytesRecorded, _desktopCapture!.WaveFormat);
            if (converted != null)
            {
                _desktopBuffer.Enqueue(converted);
                
                // Calculate level
                DesktopLevel = CalculateLevel(converted);
                DesktopLevelChanged?.Invoke(this, DesktopLevel);
            }
        }
    }
    
    private async Task MixerLoopAsync()
    {
        while (!_mixerTokenSource!.Token.IsCancellationRequested)
        {
            try
            {
                MixAndWriteBuffers();
                await Task.Delay(10, _mixerTokenSource.Token);
            }
            catch (TaskCanceledException)
            {
                break;
            }
        }
    }
    
    private void MixAndWriteBuffers()
    {
        // Get buffers from both sources
        while (_micBuffer.TryDequeue(out var micData) || _desktopBuffer.TryDequeue(out var desktopData))
        {
            byte[]? mixed;
            
            if (micData != null && _desktopBuffer.TryDequeue(out desktopData) && desktopData != null)
            {
                // Mix both streams
                mixed = MixAudio(micData, desktopData);
            }
            else if (micData != null)
            {
                mixed = micData;
            }
            else if (desktopData != null)
            {
                mixed = desktopData;
            }
            else
            {
                continue;
            }
            
            // Write to MP3
            _mp3Writer?.Write(mixed, 0, mixed.Length);
        }
    }
    
    private void ProcessRemainingBuffers()
    {
        MixAndWriteBuffers();
    }
    
    private byte[] MixAudio(byte[] buffer1, byte[] buffer2)
    {
        int length = Math.Min(buffer1.Length, buffer2.Length);
        var mixed = new byte[length];
        
        for (int i = 0; i < length; i += 2)
        {
            if (i + 1 >= length) break;
            
            // Convert to short
            short sample1 = (short)(buffer1[i] | (buffer1[i + 1] << 8));
            short sample2 = (short)(buffer2[i] | (buffer2[i + 1] << 8));
            
            // Mix with 50/50 ratio and prevent clipping
            int mixed32 = (sample1 / 2) + (sample2 / 2);
            short mixedSample = (short)Math.Clamp(mixed32, short.MinValue, short.MaxValue);
            
            // Convert back to bytes
            mixed[i] = (byte)(mixedSample & 0xFF);
            mixed[i + 1] = (byte)((mixedSample >> 8) & 0xFF);
        }
        
        return mixed;
    }
    
    private byte[]? ConvertToOutputFormat(byte[] input, int bytesRecorded, WaveFormat sourceFormat)
    {
        if (_outputFormat == null)
            return null;
        
        try
        {
            using var sourceStream = new MemoryStream(input, 0, bytesRecorded);
            using var rawSource = new RawSourceWaveStream(sourceStream, sourceFormat);
            using var converter = new MediaFoundationResampler(rawSource, _outputFormat);
            
            var outputBytes = new byte[bytesRecorded * 4]; // Extra buffer
            int read = converter.Read(outputBytes, 0, outputBytes.Length);
            
            if (read > 0)
            {
                var result = new byte[read];
                Array.Copy(outputBytes, result, read);
                return result;
            }
        }
        catch
        {
            // Conversion failed
        }
        
        return null;
    }
    
    private float CalculateLevel(byte[] buffer)
    {
        if (buffer.Length < 2)
            return 0;
        
        float max = 0;
        for (int i = 0; i < buffer.Length - 1; i += 2)
        {
            short sample = (short)(buffer[i] | (buffer[i + 1] << 8));
            float abs = Math.Abs(sample / (float)short.MaxValue);
            if (abs > max) max = abs;
        }
        
        return max;
    }
    
    private void Cleanup()
    {
        _micCapture?.Dispose();
        _micCapture = null;
        
        _desktopCapture?.Dispose();
        _desktopCapture = null;
        
        _mp3Writer?.Dispose();
        _mp3Writer = null;
        
        _mixerTokenSource?.Dispose();
        _mixerTokenSource = null;
        
        _micBuffer.Clear();
        _desktopBuffer.Clear();
        
        _currentFilePath = null;
    }
    
    public void Dispose()
    {
        if (_isRecording)
            StopRecording();
        else
            Cleanup();
    }
}
