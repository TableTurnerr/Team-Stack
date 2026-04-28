using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LocalCrmAgent.Services;

/// <summary>
/// Persists agent settings (auto-record toggles + last upload auth) under
/// %APPDATA%\CrmAgent\agent-config.json so the agent can resume uploads
/// after a restart without waiting for the dashboard to reconfigure it.
/// The auth token is DPAPI-encrypted to the current Windows user.
/// </summary>
public class AgentConfig
{
    [JsonPropertyName("autoRecordEnabled")] public bool AutoRecordEnabled { get; set; } = true;
    [JsonPropertyName("recordOnRinging")] public bool RecordOnRinging { get; set; }
    [JsonPropertyName("lastPocketbaseUrl")] public string? LastPocketbaseUrl { get; set; }
    /// <summary>DPAPI-encrypted, base64-encoded auth token. Encrypted scope = current user.</summary>
    [JsonPropertyName("lastAuthTokenProtected")] public string? LastAuthTokenProtected { get; set; }
    [JsonPropertyName("lastUploaderId")] public string? LastUploaderId { get; set; }

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public static string ConfigPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "CrmAgent", "agent-config.json");

    public static AgentConfig Load()
    {
        try
        {
            if (!File.Exists(ConfigPath)) return new AgentConfig();
            var json = File.ReadAllText(ConfigPath);
            return JsonSerializer.Deserialize<AgentConfig>(json, JsonOptions) ?? new AgentConfig();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Config] load failed: {ex.Message}");
            return new AgentConfig();
        }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(ConfigPath)!);
            var json = JsonSerializer.Serialize(this, JsonOptions);
            File.WriteAllText(ConfigPath, json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Config] save failed: {ex.Message}");
        }
    }

    public void SetAuth(string? pocketbaseUrl, string? rawAuthToken, string? uploaderId)
    {
        LastPocketbaseUrl = pocketbaseUrl;
        LastUploaderId = uploaderId;
        if (string.IsNullOrEmpty(rawAuthToken))
        {
            LastAuthTokenProtected = null;
        }
        else
        {
            try
            {
                var bytes = Encoding.UTF8.GetBytes(rawAuthToken);
                var protectedBytes = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
                LastAuthTokenProtected = Convert.ToBase64String(protectedBytes);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Config] DPAPI protect failed: {ex.Message}");
                LastAuthTokenProtected = null;
            }
        }
    }

    public string? GetUnprotectedAuthToken()
    {
        if (string.IsNullOrEmpty(LastAuthTokenProtected)) return null;
        try
        {
            var protectedBytes = Convert.FromBase64String(LastAuthTokenProtected);
            var bytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Config] DPAPI unprotect failed: {ex.Message}");
            return null;
        }
    }
}
