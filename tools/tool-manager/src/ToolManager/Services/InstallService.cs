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

    /// <summary>Local cache of downloaded release zips: {BaseDir}/cache/{tagPrefix}/v{version}.zip</summary>
    public static readonly string CacheDir = Path.Combine(InstalledToolsRegistry.BaseDir, "cache");

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

    public async Task<bool> InstallOrUpdate(
        ToolInfo tool,
        IProgress<InstallProgress>? status = null,
        string? overrideDownloadUrl = null,
        Version? overrideVersion = null,
        CancellationToken ct = default)
    {
        string? zipPath = null;
        string? stagingDir = null;
        bool zipFromCache = false;

        var downloadUrl = overrideDownloadUrl ?? tool.LatestDownloadUrl;
        var targetVersion = overrideVersion ?? tool.LatestVersion;

        try
        {
            // Check local cache first
            var cachedZip = GetCachedZipPath(tool.TagPrefix, targetVersion);
            if (File.Exists(cachedZip))
            {
                status?.Report(new InstallProgress("Using cached download...", 50));
                zipPath = cachedZip;
                zipFromCache = true;
            }
            else
            {
                // 1. Download with byte-level progress
                status?.Report(new InstallProgress("Downloading...", 0));

                var downloadProgress = new Progress<(long downloaded, long? total)>(p =>
                {
                    if (p.total is > 0)
                    {
                        var pct = (int)(p.downloaded * 100 / p.total.Value);
                        var mb = p.downloaded / (1024.0 * 1024.0);
                        var totalMb = p.total.Value / (1024.0 * 1024.0);
                        status?.Report(new InstallProgress($"Downloading... {mb:F1} / {totalMb:F1} MB", pct));
                    }
                    else
                    {
                        var mb = p.downloaded / (1024.0 * 1024.0);
                        status?.Report(new InstallProgress($"Downloading... {mb:F1} MB", -1));
                    }
                });

                zipPath = await _downloadService.DownloadAsync(downloadUrl, downloadProgress, ct);

                // Cache the download for future use
                try
                {
                    var cacheDir = Path.GetDirectoryName(cachedZip)!;
                    Directory.CreateDirectory(cacheDir);
                    File.Copy(zipPath, cachedZip, true);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Install] Cache copy failed (non-fatal): {ex.Message}");
                }
            }

            // 2. Extract to staging
            status?.Report(new InstallProgress("Extracting..."));
            stagingDir = Path.Combine(Path.GetTempPath(),
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
                // Validate required fields
                if (manifest != null && string.IsNullOrEmpty(manifest.Id))
                    manifest = null;
            }

            // Fallback manifest for releases that don't include tool.json
            manifest ??= new ToolManifest
            {
                Id = tool.TagPrefix,
                Name = tool.DisplayName,
                Description = tool.Description,
                Type = tool.ToolType != "unknown" ? tool.ToolType : "windows-app",
                Version = targetVersion.ToString(),
            };

            // Update ToolInfo from manifest
            tool.ToolType = manifest.Type;
            tool.DisplayName = manifest.Name;
            tool.Description = manifest.Description;

            // 4. Determine install path (under ToolManager/tools/{id})
            var installPath = tool.InstallPath
                ?? Path.Combine(InstalledToolsRegistry.ToolsDir, manifest.Id);

            // 5. Install via handler
            status?.Report(new InstallProgress("Installing..."));
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
                Version = targetVersion.ToString(),
                InstallPath = installPath,
                InstalledAt = _registry.GetByTagPrefix(tool.TagPrefix)?.InstalledAt ?? DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow,
                Manifest = manifest,
            });

            status?.Report(new InstallProgress("Done", 100));
            Debug.WriteLine($"[Install] {manifest.Name} v{targetVersion} installed to {installPath}");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Install] Failed: {ex.Message}");
            status?.Report(new InstallProgress($"Failed: {ex.Message}"));
            return false;
        }
        finally
        {
            // Always clean up temp files (but not cached zips)
            if (stagingDir != null)
                try { Directory.Delete(stagingDir, true); } catch { }
            if (zipPath != null && !zipFromCache)
                try { File.Delete(zipPath); } catch { }
        }
    }

    public async Task<bool> Uninstall(string tagPrefix, IProgress<InstallProgress>? status = null)
    {
        var installed = _registry.GetByTagPrefix(tagPrefix);
        if (installed == null) return false;

        try
        {
            status?.Report(new InstallProgress("Uninstalling..."));

            if (_handlers.TryGetValue(installed.Type, out var handler))
                await handler.Uninstall(installed);
            else if (Directory.Exists(installed.InstallPath))
                Directory.Delete(installed.InstallPath, true);

            _registry.Remove(tagPrefix);
            status?.Report(new InstallProgress("Done", 100));
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Uninstall] Failed: {ex.Message}");
            status?.Report(new InstallProgress($"Failed: {ex.Message}"));
            return false;
        }
    }

    // ── Local version cache management ──────────────────────

    /// <summary>Get the cache path for a specific tool version zip.</summary>
    public static string GetCachedZipPath(string tagPrefix, Version version)
        => Path.Combine(CacheDir, tagPrefix, $"v{version}.zip");

    /// <summary>List all locally cached versions for a tool.</summary>
    public static List<(Version version, string path, long sizeBytes)> GetCachedVersions(string tagPrefix)
    {
        var dir = Path.Combine(CacheDir, tagPrefix);
        if (!Directory.Exists(dir)) return [];

        var result = new List<(Version, string, long)>();
        foreach (var file in Directory.GetFiles(dir, "v*.zip"))
        {
            var name = Path.GetFileNameWithoutExtension(file);
            if (name.StartsWith('v') && Version.TryParse(name[1..], out var ver))
            {
                var info = new FileInfo(file);
                result.Add((ver, file, info.Length));
            }
        }
        return result.OrderByDescending(x => x.Item1).ToList();
    }

    /// <summary>Delete a specific cached version zip.</summary>
    public static bool DeleteCachedVersion(string tagPrefix, Version version)
    {
        var path = GetCachedZipPath(tagPrefix, version);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        return true;
    }

    /// <summary>Delete all cached versions for a tool.</summary>
    public static void ClearCache(string tagPrefix)
    {
        var dir = Path.Combine(CacheDir, tagPrefix);
        if (Directory.Exists(dir))
            Directory.Delete(dir, true);
    }

    /// <summary>Get total cache size across all tools.</summary>
    public static long GetTotalCacheSize()
    {
        if (!Directory.Exists(CacheDir)) return 0;
        return Directory.GetFiles(CacheDir, "*.zip", SearchOption.AllDirectories)
            .Sum(f => new FileInfo(f).Length);
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
