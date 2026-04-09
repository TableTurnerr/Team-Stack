using System.Text.Json;
using System.Text.Json.Serialization;

namespace ToolManager.Models;

/// <summary>
/// Persisted user settings at %LocalAppData%\TableTurnerr\ToolManager\settings.json.
/// </summary>
public class ToolManagerSettings
{
    private static readonly string FilePath = Path.Combine(
        InstalledToolsRegistry.BaseDir, "settings.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    [JsonPropertyName("autoStartEnabled")]
    public bool AutoStartEnabled { get; set; } = true;

    [JsonPropertyName("autoUpdateEnabled")]
    public bool AutoUpdateEnabled { get; set; } = true;

    public static ToolManagerSettings Load()
    {
        if (!File.Exists(FilePath))
            return new ToolManagerSettings();

        try
        {
            var json = File.ReadAllText(FilePath);
            return JsonSerializer.Deserialize<ToolManagerSettings>(json, JsonOptions)
                ?? new ToolManagerSettings();
        }
        catch
        {
            return new ToolManagerSettings();
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(InstalledToolsRegistry.BaseDir);
        var json = JsonSerializer.Serialize(this, JsonOptions);
        File.WriteAllText(FilePath, json);
    }
}
