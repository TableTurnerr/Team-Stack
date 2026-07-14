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
    /// <summary>
    /// Set to true when a saved DPAPI-protected token failed to decrypt (e.g.
    /// after a user profile change). Surfaced to the dashboard via an
    /// auth_required broadcast so the user is prompted to re-authenticate
    /// instead of silently failing to upload recordings.
    /// </summary>
    [JsonIgnore] public bool AuthDecryptionFailed { get; private set; }

    [JsonPropertyName("autoRecordEnabled")] public bool AutoRecordEnabled { get; set; } = true;
    [JsonPropertyName("recordOnRinging")] public bool RecordOnRinging { get; set; }
    [JsonPropertyName("lastPocketbaseUrl")] public string? LastPocketbaseUrl { get; set; }
    /// <summary>DPAPI-encrypted, base64-encoded auth token. Encrypted scope = current user.</summary>
    [JsonPropertyName("lastAuthTokenProtected")] public string? LastAuthTokenProtected { get; set; }
    [JsonPropertyName("lastUploaderId")] public string? LastUploaderId { get; set; }

    // ── GHL worker upload config (recordings now attach to GHL via the worker) ──
    /// <summary>Base URL of the zoomphone-bridge worker (e.g. https://zoomphone-bridge.example.workers.dev).</summary>
    [JsonPropertyName("workerBaseUrl")] public string? WorkerBaseUrl { get; set; }
    /// <summary>Rep identity for attribution = the rep's GoHighLevel user id
    /// (the "repKey"). Device-provisioned, one per machine, because the whole
    /// team shares a single Zoom account so the Zoom user_id can't identify the
    /// rep. Sent to the worker as <c>repKey</c>.</summary>
    [JsonPropertyName("repUserId")] public string? RepUserId { get; set; }
    /// <summary>DPAPI-encrypted, base64-encoded worker AGENT_SHARED_TOKEN. Scope = current user.</summary>
    [JsonPropertyName("agentTokenProtected")] public string? AgentTokenProtected { get; set; }
    /// <summary>Optional cloud-relay base URL tried when the primary worker is
    /// unreachable or returns 5xx (same /recordings/ingest contract, same token).
    /// Plain string — it's a public URL, not a secret, so no DPAPI.</summary>
    [JsonPropertyName("fallbackWorkerBaseUrl")] public string? FallbackWorkerBaseUrl { get; set; }

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
            FileLogger.Write($"[Config] DPAPI unprotect failed (auth lost): {ex.Message}");
            AuthDecryptionFailed = true;
            return null;
        }
    }

    /// <summary>Persist the GHL worker upload config. The token is DPAPI-encrypted.</summary>
    public void SetWorkerConfig(string? workerBaseUrl, string? rawAgentToken, string? repUserId)
    {
        WorkerBaseUrl = workerBaseUrl;
        RepUserId = repUserId;
        if (string.IsNullOrEmpty(rawAgentToken))
        {
            AgentTokenProtected = null;
        }
        else
        {
            try
            {
                var bytes = Encoding.UTF8.GetBytes(rawAgentToken);
                var protectedBytes = ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser);
                AgentTokenProtected = Convert.ToBase64String(protectedBytes);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Config] DPAPI protect failed (agent token): {ex.Message}");
                AgentTokenProtected = null;
            }
        }
    }

    public string? GetUnprotectedAgentToken()
    {
        if (string.IsNullOrEmpty(AgentTokenProtected)) return null;
        try
        {
            var protectedBytes = Convert.FromBase64String(AgentTokenProtected);
            var bytes = ProtectedData.Unprotect(protectedBytes, null, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[Config] DPAPI unprotect failed (agent token lost): {ex.Message}");
            AuthDecryptionFailed = true;
            return null;
        }
    }
}
