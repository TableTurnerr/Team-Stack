using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using ToolManager.Models;

namespace ToolManager.Services;

/// <summary>
/// Fetches all releases from the GitHub API, groups by tag prefix,
/// and produces a list of discoverable tools.
/// </summary>
public partial class GitHubReleaseService
{
    private const string GitHubOwner = "TableTurnerr";
    private const string GitHubRepo = "Team-Stack";
    public const string SelfTagPrefix = "tool-manager";

    [GeneratedRegex(@"^(.+)-v(\d+(?:\.\d+)*)$")]
    private static partial Regex TagPattern();

    private readonly HttpClient _http;
    private readonly InstalledToolsRegistry _registry;

    private List<ToolInfo>? _cachedTools;
    private DateTime _cacheTime;
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(2);

    public GitHubReleaseService(InstalledToolsRegistry registry)
    {
        _registry = registry;
        _http = new HttpClient();
        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        _http.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("ToolManager", version?.ToString(3) ?? "1.0.0"));
        _http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    }

    public async Task<List<ToolInfo>> FetchToolsAsync(bool forceRefresh = false, CancellationToken ct = default)
    {
        if (!forceRefresh && _cachedTools != null && DateTime.UtcNow - _cacheTime < CacheDuration)
            return _cachedTools;

        Debug.WriteLine("[GitHub] Fetching releases...");

        var url = $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases?per_page=100";
        HttpResponseMessage resp;
        try
        {
            resp = await _http.GetAsync(url, ct);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] Request failed: {ex.Message}");
            return _cachedTools ?? [];
        }

        if (!resp.IsSuccessStatusCode)
        {
            Debug.WriteLine($"[GitHub] API returned {resp.StatusCode}");
            return _cachedTools ?? [];
        }

        var json = await resp.Content.ReadAsStringAsync(ct);
        using var doc = JsonDocument.Parse(json);

        var toolMap = new Dictionary<string, ToolInfo>();
        Debug.WriteLine($"[GitHub] Parsing {doc.RootElement.GetArrayLength()} releases");

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            var tag = release.GetProperty("tag_name").GetString();
            if (tag == null) continue;
            if (release.GetProperty("draft").GetBoolean()) continue;

            var match = TagPattern().Match(tag);
            if (!match.Success) { Debug.WriteLine($"[GitHub] No regex match: {tag}"); continue; }

            var prefix = match.Groups[1].Value;
            var versionStr = match.Groups[2].Value;

            // Skip the manager's own releases
            if (prefix == SelfTagPrefix) continue;

            if (!Version.TryParse(versionStr, out var version)) { Debug.WriteLine($"[GitHub] Version parse failed: {versionStr}"); continue; }

            // Only keep the latest version per prefix (API returns newest first)
            if (toolMap.ContainsKey(prefix)) continue;

            // Find zip asset
            string? downloadUrl = null;
            foreach (var asset in release.GetProperty("assets").EnumerateArray())
            {
                var name = asset.GetProperty("name").GetString() ?? "";
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    downloadUrl = asset.GetProperty("browser_download_url").GetString();
                    break;
                }
            }

            if (downloadUrl == null) continue;

            var releaseName = release.GetProperty("name").GetString() ?? tag;
            var displayName = Regex.Replace(releaseName, @"\s*v[\d.]+\s*$", "").Trim();
            if (string.IsNullOrEmpty(displayName)) displayName = prefix;

            var installed = _registry.GetByTagPrefix(prefix);

            toolMap[prefix] = new ToolInfo
            {
                TagPrefix = prefix,
                DisplayName = installed?.Name ?? displayName,
                Description = installed?.Manifest?.Description,
                ToolType = installed?.Type ?? "unknown",
                LatestVersion = version,
                LatestDownloadUrl = downloadUrl,
                ReleaseBody = release.GetProperty("body").GetString(),
                IsInstalled = installed != null,
                InstalledVersion = installed != null && Version.TryParse(installed.Version, out var iv) ? iv : null,
                InstallPath = installed?.InstallPath,
            };
        }

        _cachedTools = toolMap.Values.OrderBy(t => t.DisplayName).ToList();
        _cacheTime = DateTime.UtcNow;

        Debug.WriteLine($"[GitHub] Found {_cachedTools.Count} tools");
        return _cachedTools;
    }

    public async Task<(Version? version, string? url)> CheckSelfUpdate(CancellationToken ct = default)
    {
        var currentVersion = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version
            ?? new Version(0, 0, 0);

        var resp = await _http.GetAsync(
            $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases?per_page=30", ct);

        if (!resp.IsSuccessStatusCode) return (null, null);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var tagStart = $"{SelfTagPrefix}-v";

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            var tag = release.GetProperty("tag_name").GetString();
            if (tag == null || !tag.StartsWith(tagStart)) continue;
            if (release.GetProperty("draft").GetBoolean()) continue;

            if (!Version.TryParse(tag[tagStart.Length..], out var version)) continue;

            if (version > currentVersion)
            {
                foreach (var asset in release.GetProperty("assets").EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString() ?? "";
                    if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                        return (version, asset.GetProperty("browser_download_url").GetString());
                }
            }
            break;
        }

        return (null, null);
    }

    public void InvalidateCache() => _cachedTools = null;
}
