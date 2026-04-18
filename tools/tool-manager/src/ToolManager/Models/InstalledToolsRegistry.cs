using System.Diagnostics;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace ToolManager.Models;

public class InstalledTool
{
    [JsonPropertyName("tagPrefix")]
    public string TagPrefix { get; set; } = "";

    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("name")]
    public string Name { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "unknown";

    [JsonPropertyName("version")]
    public string Version { get; set; } = "";

    [JsonPropertyName("installPath")]
    public string InstallPath { get; set; } = "";

    [JsonPropertyName("installedAt")]
    public DateTime InstalledAt { get; set; }

    [JsonPropertyName("updatedAt")]
    public DateTime UpdatedAt { get; set; }

    [JsonPropertyName("manifest")]
    public ToolManifest? Manifest { get; set; }
}

/// <summary>
/// Reads/writes installed.json at %LocalAppData%\TableTurnerr\ToolManager\.
/// </summary>
public class InstalledToolsRegistry
{
    public static readonly string BaseDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "TableTurnerr", "ToolManager");

    public static readonly string ToolsDir = Path.Combine(BaseDir, "tools");

    private static readonly string FilePath = Path.Combine(BaseDir, "installed.json");

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
    };

    private List<InstalledTool> _tools = [];

    public IReadOnlyList<InstalledTool> Tools => _tools.AsReadOnly();

    public InstalledToolsRegistry()
    {
        Load();
        MigrateExistingInstalls();
    }

    public void Load()
    {
        if (!File.Exists(FilePath))
        {
            _tools = [];
            return;
        }

        try
        {
            var json = File.ReadAllText(FilePath);
            _tools = JsonSerializer.Deserialize<List<InstalledTool>>(json, JsonOptions) ?? [];
        }
        catch
        {
            _tools = [];
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(BaseDir);
        var json = JsonSerializer.Serialize(_tools, JsonOptions);
        File.WriteAllText(FilePath, json);
    }

    public InstalledTool? GetByTagPrefix(string tagPrefix)
        => _tools.FirstOrDefault(t => t.TagPrefix == tagPrefix);

    public void AddOrUpdate(InstalledTool tool)
    {
        var idx = _tools.FindIndex(t => t.TagPrefix == tool.TagPrefix);
        if (idx >= 0)
            _tools[idx] = tool;
        else
            _tools.Add(tool);
        Save();
    }

    public void Remove(string tagPrefix)
    {
        _tools.RemoveAll(t => t.TagPrefix == tagPrefix);
        Save();
    }

    /// <summary>
    /// On first run, detect tools already installed at the old location
    /// and register them (pointing to their current path). The next auto-update
    /// will reinstall them under ToolManager/tools/{id}.
    /// </summary>
    private void MigrateExistingInstalls()
    {
        if (_tools.Count > 0) return;

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        // Detect existing CRM Agent at old install location
        var crmAgentExe = Path.Combine(appData, "TableTurnerr", "LocalCrmAgent", "LocalCrmAgent.exe");
        if (File.Exists(crmAgentExe))
        {
            try
            {
                var info = FileVersionInfo.GetVersionInfo(crmAgentExe);
                var ver = info.FileVersion ?? "0.0.0";
                var parts = ver.Split('.');
                if (parts.Length == 4 && parts[3] == "0")
                    ver = string.Join('.', parts.Take(3));

                // Register with the NEW managed path — the old location stays until
                // the next update cycle overwrites it at the new path.
                var managedPath = Path.Combine(ToolsDir, "local-crm-agent");

                AddOrUpdate(new InstalledTool
                {
                    TagPrefix = "local-agent",
                    Id = "local-crm-agent",
                    Name = "Local CRM Agent",
                    Type = "windows-app",
                    Version = ver,
                    InstallPath = managedPath,
                    InstalledAt = File.GetCreationTime(crmAgentExe),
                    UpdatedAt = File.GetLastWriteTime(crmAgentExe),
                    Manifest = new ToolManifest
                    {
                        Id = "local-crm-agent",
                        Name = "Local CRM Agent",
                        Description = "Desktop agent that monitors Zoom Phone call state and serves signals to the CRM dashboard.",
                        Type = "windows-app",
                        Version = ver,
                        Executable = "LocalCrmAgent.exe",
                        ProcessName = "LocalCrmAgent",
                        AutoStart = true,
                        RegistryAutoStart = new RegistryAutoStartConfig { Key = "LocalCrmAgent" },
                        ProtocolHandler = "crm-agent",
                        StartMenuFolder = "TableTurnerr",
                        StartMenuName = "CRM Agent",
                    },
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Registry] Migration failed for CRM Agent: {ex.Message}");
            }
        }
    }
}
