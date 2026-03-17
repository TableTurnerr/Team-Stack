using System.Diagnostics;
using System.IO.Compression;
using System.Text.Json;
using ToolManager.Models;
using ToolManager.Services.Handlers;

namespace ToolManager.Services;

/// <summary>
/// Orchestrates install/update/uninstall by downloading the release zip,
/// reading the tool.json manifest, and delegating to the appropriate handler.
/// </summary>
public class InstallService
{
    private readonly InstalledToolsRegistry _registry;
    private readonly DownloadService _downloadService;
    private readonly Dictionary<string, IToolTypeHandler> _handlers;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    public InstallService(InstalledToolsRegistry registry, DownloadService downloadService)
    {
        _registry = registry;
        _downloadService = downloadService;

        var windowsApp = new WindowsAppHandler();
        var chromeExt = new ChromeExtensionHandler();
        _handlers = new Dictionary<string, IToolTypeHandler>
        {
            [windowsApp.TypeName] = windowsApp,
            [chromeExt.TypeName] = chromeExt,
        };
    }

    public async Task<bool> InstallOrUpdate(ToolInfo tool, IProgress<string>? status = null, CancellationToken ct = default)
    {
        try
        {
            // 1. Download
            status?.Report("Downloading...");
            var zipPath = await _downloadService.DownloadAsync(tool.LatestDownloadUrl, ct: ct);

            // 2. Extract to staging
            status?.Report("Extracting...");
            var stagingDir = Path.Combine(Path.GetTempPath(),
                $"ToolManager_Stage_{tool.TagPrefix}_{Guid.NewGuid():N}");
            if (Directory.Exists(stagingDir)) Directory.Delete(stagingDir, true);
            ZipFile.ExtractToDirectory(zipPath, stagingDir);

            // 3. Read tool.json if present
            ToolManifest? manifest = null;
            var manifestPath = Path.Combine(stagingDir, "tool.json");
            if (File.Exists(manifestPath))
            {
                var json = await File.ReadAllTextAsync(manifestPath, ct);
                manifest = JsonSerializer.Deserialize<ToolManifest>(json, JsonOptions);
            }

            // Fallback manifest for releases that don't include tool.json
            manifest ??= new ToolManifest
            {
                Id = tool.TagPrefix,
                Name = tool.DisplayName,
                Description = tool.Description,
                Type = tool.ToolType != "unknown" ? tool.ToolType : "windows-app",
                Version = tool.LatestVersion.ToString(),
            };

            // Update ToolInfo from manifest
            tool.ToolType = manifest.Type;
            tool.DisplayName = manifest.Name;
            tool.Description = manifest.Description;

            // 4. Determine install path (under ToolManager/tools/{id})
            var installPath = tool.InstallPath
                ?? Path.Combine(InstalledToolsRegistry.ToolsDir, manifest.Id);

            // 5. Install via handler
            status?.Report("Installing...");
            if (_handlers.TryGetValue(manifest.Type, out var handler))
            {
                await handler.Install(stagingDir, installPath, manifest);
            }
            else
            {
                // Generic: just copy files
                Directory.CreateDirectory(installPath);
                CopyDirectory(stagingDir, installPath);
            }

            // 6. Update registry
            _registry.AddOrUpdate(new InstalledTool
            {
                TagPrefix = tool.TagPrefix,
                Id = manifest.Id,
                Name = manifest.Name,
                Type = manifest.Type,
                Version = tool.LatestVersion.ToString(),
                InstallPath = installPath,
                InstalledAt = _registry.GetByTagPrefix(tool.TagPrefix)?.InstalledAt ?? DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                Manifest = manifest,
            });

            // 7. Cleanup
            try { Directory.Delete(stagingDir, true); } catch { }
            try { File.Delete(zipPath); } catch { }

            status?.Report("Done");
            Debug.WriteLine($"[Install] {manifest.Name} v{tool.LatestVersion} installed to {installPath}");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Install] Failed: {ex.Message}");
            status?.Report("Failed");
            return false;
        }
    }

    public async Task<bool> Uninstall(string tagPrefix, IProgress<string>? status = null)
    {
        var installed = _registry.GetByTagPrefix(tagPrefix);
        if (installed == null) return false;

        try
        {
            status?.Report("Uninstalling...");

            if (_handlers.TryGetValue(installed.Type, out var handler))
                await handler.Uninstall(installed);
            else if (Directory.Exists(installed.InstallPath))
                Directory.Delete(installed.InstallPath, true);

            _registry.Remove(tagPrefix);
            status?.Report("Done");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Uninstall] Failed: {ex.Message}");
            status?.Report("Failed");
            return false;
        }
    }

    private static void CopyDirectory(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), true);
        foreach (var dir in Directory.GetDirectories(source))
            CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
    }
}
