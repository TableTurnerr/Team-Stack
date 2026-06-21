using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace LocalCrmAgent.Services;

/// <summary>
/// Chrome Native Messaging host. When the Lead Scraper extension detects a Zoom
/// <b>web phone</b> call it relays START/STOP to the agent over Chrome Native
/// Messaging (host name <c>com.tableturnerr.crm_agent</c>). Chrome launches this
/// exe fresh for the connection with stdio wired to the extension, so this mode
/// is a thin relay: it does NOT spin up the tray app. It connects to the already
/// running agent's local WebSocket (<c>ws://127.0.0.1:9876</c>) and translates the
/// frozen START/STOP protocol (architecture plan §4) into the agent's existing
/// <c>startRecording</c>/<c>stopRecording</c> commands.
///
/// Native messaging framing: each message is a 4-byte little-endian length header
/// followed by that many UTF-8 JSON bytes, over stdin/stdout.
/// </summary>
public static class NativeMessagingHost
{
    private const string WsUrl = "ws://127.0.0.1:9876";
    private const int MaxMessageBytes = 1024 * 1024; // Chrome caps host messages at 1 MB

    private static string? _logPath;

    /// <summary>
    /// True when Chrome launched us as a native messaging host. Chrome appends
    /// the calling extension's origin (<c>chrome-extension://&lt;id&gt;/</c>) to argv;
    /// its presence is the canonical signal that this is a host launch.
    /// </summary>
    public static bool IsNativeMessagingLaunch(string[] args)
        => args.Any(a => a.StartsWith("chrome-extension://", StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// Run the relay loop. Blocks until Chrome closes stdin, then returns so
    /// <c>Main</c> can exit. Never throws — a host crash would just close the
    /// extension's port, but we prefer a clean exit.
    /// </summary>
    public static void Run()
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "CrmAgent");
            Directory.CreateDirectory(dir);
            _logPath = Path.Combine(dir, "native-host.log");
        }
        catch { /* logging is best-effort */ }

        Log("Native host started");

        using var stdin = Console.OpenStandardInput();
        using var stdout = Console.OpenStandardOutput();

        // Lazily-opened connection to the running agent, reused across messages.
        ClientWebSocket? ws = null;
        try
        {
            while (true)
            {
                var message = ReadMessage(stdin);
                if (message == null)
                {
                    Log("stdin closed — exiting");
                    break;
                }

                string? type = null;
                JsonElement root = default;
                try
                {
                    using var doc = JsonDocument.Parse(message);
                    root = doc.RootElement.Clone();
                    if (root.TryGetProperty("type", out var t) && t.ValueKind == JsonValueKind.String)
                        type = t.GetString();
                }
                catch (Exception ex)
                {
                    Log($"Bad inbound JSON: {ex.Message}");
                    continue;
                }

                switch (type)
                {
                    case "START":
                    {
                        var phone = root.TryGetProperty("phoneE164", out var p)
                            && p.ValueKind == JsonValueKind.String
                                ? p.GetString() ?? "" : "";
                        var callId = root.TryGetProperty("callId", out var c) ? c.GetString() : null;
                        Log($"START callId={callId} phone={phone}");
                        if (ForwardToAgent(ref ws, new { type = "startRecording", phoneNumber = phone, channel = "web" }))
                            WriteMessage(stdout, new { type = "ack", of = "START", ok = true, callId });
                        else
                            WriteMessage(stdout, new { type = "ack", of = "START", ok = false, callId });
                        break;
                    }
                    case "STOP":
                    {
                        var callId = root.TryGetProperty("callId", out var c) ? c.GetString() : null;
                        Log($"STOP callId={callId}");
                        var ok = ForwardToAgent(ref ws, new { type = "stopRecording" });
                        WriteMessage(stdout, new { type = "ack", of = "STOP", ok, callId });
                        break;
                    }
                    case "PING":
                        WriteMessage(stdout, new { type = "PONG" });
                        break;
                    default:
                        Log($"Ignoring message type={type ?? "(null)"}");
                        break;
                }
            }
        }
        catch (Exception ex)
        {
            Log($"Relay loop error: {ex.Message}");
        }
        finally
        {
            if (ws != null)
            {
                try
                {
                    if (ws.State == WebSocketState.Open)
                        ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "host exit", CancellationToken.None)
                          .Wait(1000);
                }
                catch { /* ignore */ }
                ws.Dispose();
            }
        }
    }

    /// <summary>
    /// Send a command to the running agent's WebSocket, opening (and if needed
    /// launching the agent for) the connection on first use. Returns false if the
    /// command could not be delivered.
    /// </summary>
    private static bool ForwardToAgent(ref ClientWebSocket? ws, object command)
    {
        if (ws == null || ws.State != WebSocketState.Open)
        {
            ws?.Dispose();
            ws = ConnectWithAgentLaunch();
            if (ws == null) return false;
        }

        try
        {
            var json = JsonSerializer.Serialize(command);
            var bytes = Encoding.UTF8.GetBytes(json);
            ws.SendAsync(bytes, WebSocketMessageType.Text, true, CancellationToken.None).Wait(5000);
            return true;
        }
        catch (Exception ex)
        {
            Log($"Forward failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Connect to the agent's local WebSocket. If the agent isn't running yet,
    /// launch it (the single-instance exe self-exits if already up) and retry.
    /// </summary>
    private static ClientWebSocket? ConnectWithAgentLaunch()
    {
        var ws = TryConnect();
        if (ws != null) return ws;

        // Agent likely not running — start it, then retry for ~5s.
        try
        {
            var exe = Environment.ProcessPath;
            if (exe != null)
            {
                Log("Agent not reachable — launching it");
                Process.Start(new ProcessStartInfo { FileName = exe, UseShellExecute = true });
            }
        }
        catch (Exception ex) { Log($"Agent launch failed: {ex.Message}"); }

        for (int i = 0; i < 10; i++)
        {
            Thread.Sleep(500);
            ws = TryConnect();
            if (ws != null) return ws;
        }
        Log("Could not reach agent after launch");
        return null;
    }

    private static ClientWebSocket? TryConnect()
    {
        var ws = new ClientWebSocket();
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            ws.ConnectAsync(new Uri(WsUrl), cts.Token).Wait(cts.Token);
            // Drain inbound frames (the agent broadcasts state) so server-side
            // flow control never blocks our sends.
            _ = Task.Run(() => DrainAsync(ws));
            return ws;
        }
        catch
        {
            ws.Dispose();
            return null;
        }
    }

    private static async Task DrainAsync(ClientWebSocket ws)
    {
        var buffer = new byte[8192];
        try
        {
            while (ws.State == WebSocketState.Open)
                await ws.ReceiveAsync(buffer, CancellationToken.None);
        }
        catch { /* socket closed */ }
    }

    /// <summary>Read one length-prefixed message, or null on EOF / protocol error.</summary>
    private static byte[]? ReadMessage(Stream stdin)
    {
        var header = new byte[4];
        if (!ReadFull(stdin, header, 4)) return null;

        int length = header[0] | (header[1] << 8) | (header[2] << 16) | (header[3] << 24);
        if (length <= 0 || length > MaxMessageBytes)
        {
            Log($"Bad message length {length} — closing");
            return null;
        }

        var payload = new byte[length];
        if (!ReadFull(stdin, payload, length)) return null;
        return payload;
    }

    private static bool ReadFull(Stream s, byte[] buffer, int count)
    {
        int offset = 0;
        while (offset < count)
        {
            int read = s.Read(buffer, offset, count - offset);
            if (read <= 0) return false; // EOF
            offset += read;
        }
        return true;
    }

    private static void WriteMessage(Stream stdout, object payload)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload));
            var header = new byte[4];
            header[0] = (byte)(bytes.Length & 0xFF);
            header[1] = (byte)((bytes.Length >> 8) & 0xFF);
            header[2] = (byte)((bytes.Length >> 16) & 0xFF);
            header[3] = (byte)((bytes.Length >> 24) & 0xFF);
            stdout.Write(header, 0, 4);
            stdout.Write(bytes, 0, bytes.Length);
            stdout.Flush();
        }
        catch (Exception ex) { Log($"Write failed: {ex.Message}"); }
    }

    private static void Log(string message)
    {
        if (_logPath == null) return;
        try
        {
            File.AppendAllText(_logPath, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch { /* best-effort */ }
    }
}
