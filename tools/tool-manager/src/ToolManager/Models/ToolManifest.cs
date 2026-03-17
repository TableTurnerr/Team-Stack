using System.Text.Json.Serialization;

namespace ToolManager.Models;

/// <summary>
/// Deserialized from tool.json found inside each release zip.
/// </summary>
public class ToolManifest
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = "unknown";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "0.0.0";

    [JsonPropertyName("executable")]
    public string? Executable { get; set; }

    [JsonPropertyName("processName")]
    public string? ProcessName { get; set; }

    [JsonPropertyName("autoStart")]
    public bool AutoStart { get; set; }

    [JsonPropertyName("registryAutoStart")]
    public RegistryAutoStartConfig? RegistryAutoStart { get; set; }

    [JsonPropertyName("protocolHandler")]
    public string? ProtocolHandler { get; set; }

    [JsonPropertyName("startMenuFolder")]
    public string? StartMenuFolder { get; set; }

    [JsonPropertyName("startMenuName")]
    public string? StartMenuName { get; set; }
}

public class RegistryAutoStartConfig
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = "";

    [JsonPropertyName("args")]
    public string? Args { get; set; }
}
