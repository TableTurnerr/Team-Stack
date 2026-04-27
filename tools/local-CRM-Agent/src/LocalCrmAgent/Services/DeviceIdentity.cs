using System.Diagnostics;
using System.Text.Json;

namespace LocalCrmAgent.Services;

/// <summary>
/// Per-machine identity for the local agent. A stable GUID is generated on
/// first run and persisted to %APPDATA%/LocalCrmAgent/device.json so every
/// call claim / session / websocket handshake can be attributed to *this*
/// physical device rather than to the shared Zoom account.
/// </summary>
public static class DeviceIdentity
{
    private static readonly object _lock = new();
    private static string? _cachedId;

    public static string DeviceId => LoadOrCreate();

    public static string Hostname
    {
        get
        {
            try { return Environment.MachineName ?? ""; }
            catch { return ""; }
        }
    }

    private static string LoadOrCreate()
    {
        lock (_lock)
        {
            if (!string.IsNullOrEmpty(_cachedId)) return _cachedId!;

            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "LocalCrmAgent");
            var file = Path.Combine(dir, "device.json");

            try
            {
                if (File.Exists(file))
                {
                    var json = File.ReadAllText(file);
                    using var doc = JsonDocument.Parse(json);
                    if (doc.RootElement.TryGetProperty("device_id", out var v) &&
                        v.ValueKind == JsonValueKind.String)
                    {
                        var id = v.GetString();
                        if (!string.IsNullOrWhiteSpace(id))
                        {
                            _cachedId = id;
                            return _cachedId!;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[DeviceIdentity] read failed: {ex.Message}");
            }

            // Generate and persist
            var newId = Guid.NewGuid().ToString("N");
            try
            {
                Directory.CreateDirectory(dir);
                var payload = JsonSerializer.Serialize(new
                {
                    device_id = newId,
                    hostname = Hostname,
                    created_at = DateTime.UtcNow.ToString("O"),
                });
                File.WriteAllText(file, payload);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[DeviceIdentity] write failed: {ex.Message}");
            }

            _cachedId = newId;
            return _cachedId;
        }
    }
}
