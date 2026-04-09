using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.RegularExpressions;
using ToolManager.Models;

namespace ToolManager.Services;

/// <summary>
/// Fetches all releases from the GitHub API, groups by tag prefix,
/// and produces a list of discoverable tools.
///
/// Optimizations:
///   - ETag conditional requests (304 Not Modified doesn't count against rate limit)
///   - Persistent disk cache (survives restarts, provides offline fallback)
///   - GitHub token support for 5000 req/hr vs 60 req/hr unauthenticated
///   - Self-update info extracted from same API response (no separate call)
///   - RefreshInstalledStatus updates cached tools from registry without API call
/// </summary>
public partial class GitHubReleaseService
{
    private const string GitHubOwner = "TableTurnerr";
    private const string GitHubRepo = "Team-Stack";
    public const string SelfTagPrefix = "tool-manager";

    /// <summary>
    /// Minimum between API requests. Short because ETag/304 responses
    /// are free and don't count against the GitHub rate limit.
    /// </summary>
    private static readonly TimeSpan MinRequestInterval = TimeSpan.FromSeconds(30);

    /// <summary>Stop making requests when remaining quota drops to this level.</summary>
    private const int RateLimitFloor = 5;

    [GeneratedRegex(@"^(.+)-v(\d+(?:\.\d+)*)$")]
    private static partial Regex TagPattern();

    private readonly HttpClient _http;
    private readonly InstalledToolsRegistry _registry;
    private readonly object _lock = new();

    // In-memory cache
    private List<ToolInfo>? _cachedTools;
    private (Version version, string url)? _cachedSelfUpdate;

    // ETag for conditional requests
    private string? _etag;

    // Rate limiting state
    private DateTime _lastApiCall;
    private int _rateLimitRemaining = 60;
    private DateTime _rateLimitReset;

    // Persistent disk cache
    private static readonly string CacheDir = InstalledToolsRegistry.BaseDir;
    private static readonly string CachePath = Path.Combine(CacheDir, "releases-cache.json");

    private static readonly string TokenFilePath = Path.Combine(CacheDir, "github-token.txt");

    public string? LastError { get; private set; }
    public bool IsAuthenticated { get; private set; }
    public int RateLimitRemaining => _rateLimitRemaining;

    public GitHubReleaseService(InstalledToolsRegistry registry)
    {
        _registry = registry;
        _http = new HttpClient();

        var version = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
        _http.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("ToolManager", version?.ToString(3) ?? "1.0.0"));
        _http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));

        // GitHub token for higher rate limits (5000/hr vs 60/hr)
        var token = LoadGitHubToken();
        ApplyToken(token);

        // Load persistent disk cache for instant startup and offline fallback
        LoadDiskCache();
    }

    /// <summary>
    /// Tries to load a GitHub token from environment variable or local config file.
    /// </summary>
    private static string? LoadGitHubToken()
    {
        var envToken = Environment.GetEnvironmentVariable("GITHUB_TOKEN");
        if (!string.IsNullOrWhiteSpace(envToken))
            return envToken.Trim();

        if (File.Exists(TokenFilePath))
        {
            try
            {
                var fileToken = File.ReadAllText(TokenFilePath).Trim();
                if (!string.IsNullOrWhiteSpace(fileToken))
                    return fileToken;
            }
            catch { }
        }

        return null;
    }

    private void ApplyToken(string? token)
    {
        if (token != null)
        {
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            IsAuthenticated = true;
            Debug.WriteLine("[GitHub] Using authenticated requests (5000 req/hr)");
        }
        else
        {
            _http.DefaultRequestHeaders.Authorization = null;
            IsAuthenticated = false;
            Debug.WriteLine("[GitHub] Unauthenticated requests (60 req/hr)");
        }
    }

    /// <summary>
    /// Returns the currently saved token (file-based only, not env var).
    /// </summary>
    public static string? GetSavedToken()
    {
        try
        {
            if (File.Exists(TokenFilePath))
            {
                var token = File.ReadAllText(TokenFilePath).Trim();
                if (!string.IsNullOrWhiteSpace(token)) return token;
            }
        }
        catch { }
        return null;
    }

    /// <summary>
    /// Save a GitHub token and apply it immediately. Invalidates cache
    /// so the next fetch uses the new auth credentials.
    /// </summary>
    public void SetToken(string token)
    {
        Directory.CreateDirectory(CacheDir);
        File.WriteAllText(TokenFilePath, token.Trim());
        ApplyToken(token.Trim());
        InvalidateCache();
        _lastApiCall = default; // Reset throttle so next fetch goes through immediately
        Debug.WriteLine("[GitHub] Token saved and applied");
    }

    /// <summary>
    /// Remove the saved token and revert to unauthenticated requests.
    /// </summary>
    public void ClearToken()
    {
        try { if (File.Exists(TokenFilePath)) File.Delete(TokenFilePath); } catch { }
        ApplyToken(null);
        InvalidateCache();
        _lastApiCall = default;
        Debug.WriteLine("[GitHub] Token cleared");
    }

    private bool ShouldThrottle()
    {
        if (DateTime.UtcNow - _lastApiCall < MinRequestInterval)
            return true;

        if (_rateLimitRemaining <= RateLimitFloor && DateTime.UtcNow < _rateLimitReset)
            return true;

        return false;
    }

    private void ReadRateLimitHeaders(HttpResponseMessage resp)
    {
        if (resp.Headers.TryGetValues("X-RateLimit-Remaining", out var remaining))
        {
            if (int.TryParse(remaining.FirstOrDefault(), out var val))
                _rateLimitRemaining = val;
        }
        if (resp.Headers.TryGetValues("X-RateLimit-Reset", out var reset))
        {
            if (long.TryParse(reset.FirstOrDefault(), out var epoch))
                _rateLimitReset = DateTimeOffset.FromUnixTimeSeconds(epoch).UtcDateTime;
        }
        Debug.WriteLine($"[GitHub] Rate limit: {_rateLimitRemaining} remaining, resets {_rateLimitReset:HH:mm:ss}");
    }

    public async Task<List<ToolInfo>> FetchToolsAsync(bool forceRefresh = false, CancellationToken ct = default)
    {
        // Return memory cache if available and not force-refreshing
        if (!forceRefresh && _cachedTools != null)
            return _cachedTools;

        // Respect rate limit when we have cached data
        if (ShouldThrottle() && _cachedTools != null)
        {
            Debug.WriteLine("[GitHub] Throttled — returning cached tools");
            return _cachedTools;
        }

        LastError = null;
        Debug.WriteLine("[GitHub] Fetching releases...");

        var url = $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases?per_page=100";

        // Use conditional request with ETag — 304 responses don't count against rate limit
        HttpResponseMessage resp;
        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get, url);
            if (_etag != null)
            {
                try { request.Headers.IfNoneMatch.Add(new EntityTagHeaderValue(_etag)); }
                catch { _etag = null; } // Reset invalid ETag
            }

            resp = await _http.SendAsync(request, ct);
            _lastApiCall = DateTime.UtcNow;
            ReadRateLimitHeaders(resp);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] Request failed: {ex.Message}");
            LastError = $"Network error: {ex.Message}";
            return _cachedTools ?? LoadToolsFromDisk() ?? [];
        }

        // 304 Not Modified — releases haven't changed, refresh installed status only
        if (resp.StatusCode == HttpStatusCode.NotModified)
        {
            Debug.WriteLine("[GitHub] 304 Not Modified — data unchanged");
            RefreshInstalledStatus();
            return _cachedTools ?? LoadToolsFromDisk() ?? [];
        }

        if (!resp.IsSuccessStatusCode)
        {
            Debug.WriteLine($"[GitHub] API returned {resp.StatusCode}");
            LastError = (int)resp.StatusCode == 403
                ? $"GitHub API rate limited. Resets at {_rateLimitReset.ToLocalTime():HH:mm}."
                : $"GitHub API error: {resp.StatusCode}";
            return _cachedTools ?? LoadToolsFromDisk() ?? [];
        }

        // Store ETag for future conditional requests
        try
        {
            var etag = resp.Headers.ETag;
            if (etag != null)
            {
                _etag = etag.Tag;
                Debug.WriteLine($"[GitHub] Stored ETag: {_etag}");
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] ETag read failed: {ex.Message}");
        }

        string json;
        try
        {
            json = await resp.Content.ReadAsStringAsync(ct);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] Content read failed: {ex.Message}");
            LastError = $"Failed to read response: {ex.Message}";
            return _cachedTools ?? LoadToolsFromDisk() ?? [];
        }

        // Save to disk for offline fallback
        SaveDiskCache(json);

        List<ToolInfo> tools;
        try
        {
            tools = ParseReleases(json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] Parse failed: {ex.Message}");
            LastError = $"Failed to parse releases: {ex.Message}";
            return _cachedTools ?? LoadToolsFromDisk() ?? [];
        }

        lock (_lock)
        {
            _cachedTools = tools;
        }

        Debug.WriteLine($"[GitHub] Found {tools.Count} tools");
        return tools;
    }

    /// <summary>
    /// Parse releases JSON into tool list and self-update info.
    /// Also caches self-update data so SelfUpdateService doesn't need a separate call.
    /// </summary>
    private List<ToolInfo> ParseReleases(string json)
    {
        using var doc = JsonDocument.Parse(json);

        var toolMap = new Dictionary<string, ToolInfo>();
        Version? selfUpdateVersion = null;
        string? selfUpdateUrl = null;
        var currentVersion = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version
            ?? new Version(0, 0, 0);

        Debug.WriteLine($"[GitHub] Parsing {doc.RootElement.GetArrayLength()} releases");

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            var tag = release.GetProperty("tag_name").GetString();
            if (tag == null) continue;
            if (release.GetProperty("draft").GetBoolean()) continue;

            var match = TagPattern().Match(tag);
            if (!match.Success) continue;

            var prefix = match.Groups[1].Value;
            var versionStr = match.Groups[2].Value;
            if (!Version.TryParse(versionStr, out var version)) continue;

            // Extract self-update info from the same response
            if (prefix == SelfTagPrefix)
            {
                if (selfUpdateVersion == null && version > currentVersion)
                {
                    foreach (var asset in release.GetProperty("assets").EnumerateArray())
                    {
                        var name = asset.GetProperty("name").GetString() ?? "";
                        if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                        {
                            selfUpdateVersion = version;
                            selfUpdateUrl = asset.GetProperty("browser_download_url").GetString();
                            break;
                        }
                    }
                }
                continue;
            }

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

            var publishedStr = release.GetProperty("published_at").GetString();
            DateTime? publishedAt = publishedStr != null ? DateTime.Parse(publishedStr) : null;
            var releaseBody = release.GetProperty("body").GetString();

            var releaseVersion = new ReleaseVersion
            {
                Version = version,
                DownloadUrl = downloadUrl,
                ReleaseBody = releaseBody,
                PublishedAt = publishedAt,
                TagName = tag,
            };

            // Append additional versions to existing tool (API returns newest first)
            if (toolMap.ContainsKey(prefix))
            {
                toolMap[prefix].AllVersions.Add(releaseVersion);
                continue;
            }

            var releaseName = release.GetProperty("name").GetString() ?? tag;
            var displayName = Regex.Replace(releaseName, @"\s*v[\d.]+\s*$", "").Trim();
            if (string.IsNullOrEmpty(displayName)) displayName = prefix;

            var installed = _registry.GetByTagPrefix(prefix);

            Version? installedVer = null;
            bool installedIsDev = false;
            if (installed != null)
                VersionHelper.TryParse(installed.Version, out installedVer, out installedIsDev);

            toolMap[prefix] = new ToolInfo
            {
                TagPrefix = prefix,
                DisplayName = installed?.Name ?? displayName,
                Description = installed?.Manifest?.Description,
                ToolType = installed?.Type ?? "unknown",
                LatestVersion = version,
                LatestDownloadUrl = downloadUrl,
                ReleaseBody = releaseBody,
                IsInstalled = installed != null,
                InstalledVersion = installedVer,
                InstalledVersionRaw = installed?.Version,
                IsDevBuild = installedIsDev,
                InstallPath = installed?.InstallPath,
                AllVersions = [releaseVersion],
            };
        }

        // Cache self-update info
        _cachedSelfUpdate = selfUpdateVersion != null && selfUpdateUrl != null
            ? (selfUpdateVersion, selfUpdateUrl)
            : null;

        return toolMap.Values.OrderBy(t => t.DisplayName).ToList();
    }

    /// <summary>
    /// Returns cached self-update info extracted from the last FetchToolsAsync call.
    /// Avoids a separate API call for self-update checks.
    /// </summary>
    public (Version? version, string? url) GetCachedSelfUpdate()
    {
        return _cachedSelfUpdate.HasValue
            ? (_cachedSelfUpdate.Value.version, _cachedSelfUpdate.Value.url)
            : (null, null);
    }

    /// <summary>
    /// Check for self-update. Uses cached data from FetchToolsAsync when available,
    /// falls back to a dedicated API call only if no cached data exists.
    /// </summary>
    public async Task<(Version? version, string? url)> CheckSelfUpdate(CancellationToken ct = default)
    {
        // Prefer data already extracted by FetchToolsAsync
        var cached = GetCachedSelfUpdate();
        if (cached.version != null) return cached;

        if (ShouldThrottle())
        {
            Debug.WriteLine("[GitHub] Self-update check throttled");
            return (null, null);
        }

        var currentVersion = System.Reflection.Assembly.GetExecutingAssembly().GetName().Version
            ?? new Version(0, 0, 0);

        HttpResponseMessage resp;
        try
        {
            resp = await _http.GetAsync(
                $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases?per_page=30", ct);
            _lastApiCall = DateTime.UtcNow;
            ReadRateLimitHeaders(resp);
        }
        catch { return (null, null); }

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
                    {
                        var url = asset.GetProperty("browser_download_url").GetString();
                        _cachedSelfUpdate = (version, url!);
                        return (version, url);
                    }
                }
            }
            break;
        }

        return (null, null);
    }

    /// <summary>
    /// Get the latest Tool Manager release URL regardless of version comparison.
    /// Used to switch from a dev build back to the release even when the numeric version matches.
    /// </summary>
    public async Task<(Version? version, string? url)> GetLatestSelfRelease(CancellationToken ct = default)
    {
        HttpResponseMessage resp;
        try
        {
            resp = await _http.GetAsync(
                $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases?per_page=30", ct);
            _lastApiCall = DateTime.UtcNow;
            ReadRateLimitHeaders(resp);
        }
        catch { return (null, null); }

        if (!resp.IsSuccessStatusCode) return (null, null);

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));
        var tagStart = $"{SelfTagPrefix}-v";

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            var tag = release.GetProperty("tag_name").GetString();
            if (tag == null || !tag.StartsWith(tagStart)) continue;
            if (release.GetProperty("draft").GetBoolean()) continue;

            if (!Version.TryParse(tag[tagStart.Length..], out var version)) continue;

            foreach (var asset in release.GetProperty("assets").EnumerateArray())
            {
                var name = asset.GetProperty("name").GetString() ?? "";
                if (name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase))
                {
                    var url = asset.GetProperty("browser_download_url").GetString();
                    return (version, url);
                }
            }
            break;
        }

        return (null, null);
    }

    /// <summary>
    /// Refresh installed status on cached tools from the registry
    /// without making any GitHub API call. Call after install/uninstall/update.
    /// </summary>
    public void RefreshInstalledStatus()
    {
        try
        {
            lock (_lock)
            {
                if (_cachedTools == null) return;
                _registry.Load();

                foreach (var tool in _cachedTools)
                {
                    var installed = _registry.GetByTagPrefix(tool.TagPrefix);
                    tool.IsInstalled = installed != null;
                    if (installed != null && VersionHelper.TryParse(installed.Version, out var iv, out var isDev))
                    {
                        tool.InstalledVersion = iv;
                        tool.InstalledVersionRaw = installed.Version;
                        tool.IsDevBuild = isDev;
                    }
                    else
                    {
                        tool.InstalledVersion = null;
                        tool.InstalledVersionRaw = installed?.Version;
                        tool.IsDevBuild = false;
                    }
                    tool.InstallPath = installed?.InstallPath;
                    if (installed?.Name != null) tool.DisplayName = installed.Name;
                    if (installed?.Manifest?.Description != null) tool.Description = installed.Manifest.Description;
                    if (installed?.Type != null) tool.ToolType = installed.Type;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] RefreshInstalledStatus failed: {ex.Message}");
        }
    }

    public void InvalidateCache()
    {
        lock (_lock)
        {
            _cachedTools = null;
            _cachedSelfUpdate = null;
            // Keep _etag so next fetch can use conditional request
        }
    }

    // ── Persistent disk cache ──────────────────────────────────

    private void SaveDiskCache(string releasesJson)
    {
        try
        {
            Directory.CreateDirectory(CacheDir);
            var cache = new DiskCacheData { ReleasesJson = releasesJson, ETag = _etag };
            File.WriteAllText(CachePath, JsonSerializer.Serialize(cache));
            Debug.WriteLine("[GitHub] Saved disk cache");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] Failed to save disk cache: {ex.Message}");
        }
    }

    private void LoadDiskCache()
    {
        try
        {
            if (!File.Exists(CachePath)) return;
            var json = File.ReadAllText(CachePath);
            var cache = JsonSerializer.Deserialize<DiskCacheData>(json);
            if (cache?.ReleasesJson == null) return;

            _etag = cache.ETag;
            _cachedTools = ParseReleases(cache.ReleasesJson);

            // Refresh installed status against current registry
            RefreshInstalledStatus();

            Debug.WriteLine($"[GitHub] Loaded disk cache: {_cachedTools.Count} tools (ETag: {_etag != null})");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[GitHub] Failed to load disk cache: {ex.Message}");
        }
    }

    /// <summary>
    /// Load tools from disk cache as a last-resort fallback (e.g., when API fails and memory cache is empty).
    /// </summary>
    private List<ToolInfo>? LoadToolsFromDisk()
    {
        try
        {
            if (!File.Exists(CachePath)) return null;
            var json = File.ReadAllText(CachePath);
            var cache = JsonSerializer.Deserialize<DiskCacheData>(json);
            if (cache?.ReleasesJson == null) return null;
            return ParseReleases(cache.ReleasesJson);
        }
        catch { return null; }
    }

    private class DiskCacheData
    {
        public string? ReleasesJson { get; set; }
        public string? ETag { get; set; }
    }
}
