using System.Diagnostics;

namespace ToolManager.Services;

/// <summary>
/// Tiny rolling-file logger so diagnostics survive into Release builds
/// (where Debug.WriteLine is a no-op). Single rollover at ~256 KB.
/// New diagnostic call sites should use FileLogger.Write directly; existing
/// Debug.WriteLine calls remain unchanged but are inert in Release.
/// </summary>
public static class FileLogger
{
    private const long MaxBytes = 256 * 1024;
    private static readonly object _lock = new();
    private static string? _path;
    private static StreamWriter? _writer;

    public static void Init(string path)
    {
        lock (_lock)
        {
            if (_path != null) return;
            _path = path;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                RollIfNeeded();
                OpenWriter();
                Trace.AutoFlush = true;
                Trace.Listeners.Add(new TextWriterTraceListener(new SyncWriter(_writer!, _lock)));
                WriteUnlocked($"[FileLogger] Started");
            }
            catch
            {
                // Logging must never crash the app.
            }
        }
    }

    public static void Write(string message)
    {
        lock (_lock)
        {
            if (_writer == null) { Debug.WriteLine(message); return; }
            try { WriteUnlocked(message); }
            catch { }
        }
    }

    private static void WriteUnlocked(string message)
    {
        _writer!.WriteLine($"{DateTime.Now:O} {message}");
    }

    private static void OpenWriter()
    {
        var stream = new FileStream(_path!, FileMode.Append, FileAccess.Write, FileShare.Read);
        _writer = new StreamWriter(stream) { AutoFlush = true };
    }

    private static void RollIfNeeded()
    {
        try
        {
            var fi = new FileInfo(_path!);
            if (fi.Exists && fi.Length > MaxBytes)
            {
                var rolled = _path + ".old";
                if (File.Exists(rolled)) File.Delete(rolled);
                File.Move(_path!, rolled);
            }
        }
        catch { }
    }

    private sealed class SyncWriter : TextWriter
    {
        private readonly StreamWriter _inner;
        private readonly object _gate;
        public SyncWriter(StreamWriter inner, object gate) { _inner = inner; _gate = gate; }
        public override System.Text.Encoding Encoding => _inner.Encoding;
        public override void Write(char value) { lock (_gate) _inner.Write(value); }
        public override void Write(string? value) { lock (_gate) _inner.Write(value); }
        public override void WriteLine(string? value)
        {
            lock (_gate) _inner.WriteLine($"{DateTime.Now:O} {value}");
        }
    }
}
