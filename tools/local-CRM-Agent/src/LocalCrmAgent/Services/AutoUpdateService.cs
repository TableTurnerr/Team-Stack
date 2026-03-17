using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http.Headers;
using System.Reflection;
using System.Text.Json;

namespace LocalCrmAgent.Services;

/// <summary>
/// Checks GitHub Releases for newer versions and applies updates
/// by downloading the release zip and swapping the exe via a helper script.
/// </summary>
public class AutoUpdateService : IDisposable
{
    private const string GitHubOwner = "TableTurnerr";
    private const string GitHubRepo = "Team-Stack";
    private const string ReleaseTagPrefix = "local-agent-v";
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan InitialDelay = TimeSpan.FromSeconds(30);

    private readonly HttpClient _http;
    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    public Version CurrentVersion { get; }
    public Version? LatestVersion { get; private set; }
    public string? DownloadUrl { get; private set; }
    public bool UpdateAvailable => LatestVersion != null && LatestVersion > CurrentVersion;
    public bool IsUpdating { get; private set; }

    public event Action<Version>? UpdateFound;
    public event Action<string>? StatusChanged;

    public AutoUpdateService()
    {
        CurrentVersion = Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0);
        _http = new HttpClient();
        _http.DefaultRequestHeaders.UserAgent.Add(
            new ProductInfoHeaderValue("LocalCrmAgent", CurrentVersion.ToString(3)));
        _http.DefaultRequestHeaders.Accept.Add(
            new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
        Debug.WriteLine("[AutoUpdate] Started");
    }

    private async Task Loop(CancellationToken ct)
    {
        await Task.Delay(InitialDelay, ct);
        while (!ct.IsCancellationRequested)
        {
            try { await CheckForUpdate(ct); }
            catch (Exception ex) { Debug.WriteLine($"[AutoUpdate] Check error: {ex.Message}"); }
            await Task.Delay(CheckInterval, ct);
        }
    }

    public async Task CheckForUpdate(CancellationToken ct = default)
    {
        Debug.WriteLine("[AutoUpdate] Checking...");
        StatusChanged?.Invoke("Checking for updates...");

        var resp = await _http.GetAsync(
            $"https://api.github.com/repos/{GitHubOwner}/{GitHubRepo}/releases", ct);

        if (!resp.IsSuccessStatusCode)
        {
            Debug.WriteLine($"[AutoUpdate] API returned {resp.StatusCode}");
            StatusChanged?.Invoke("Check failed");
            return;
        }

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync(ct));

        foreach (var release in doc.RootElement.EnumerateArray())
        {
            var tag = release.GetProperty("tag_name").GetString();
            if (tag == null || !tag.StartsWith(ReleaseTagPrefix)) continue;
            if (release.GetProperty("draft").GetBoolean()) continue;

            if (!Version.TryParse(tag[ReleaseTagPrefix.Length..], out var ver)) continue;

            if (ver > CurrentVersion)
            {
                foreach (var asset in release.GetProperty("assets").EnumerateArray())
                {
                    var name = asset.GetProperty("name").GetString() ?? "";
                    if (!name.EndsWith(".zip", StringComparison.OrdinalIgnoreCase)) continue;

                    LatestVersion = ver;
                    DownloadUrl = asset.GetProperty("browser_download_url").GetString();
                    Debug.WriteLine($"[AutoUpdate] Found update: {CurrentVersion} -> {ver}");
                    UpdateFound?.Invoke(ver);
                    StatusChanged?.Invoke($"v{ver.ToString(3)} available");
                    return;
                }
            }

            // First matching release with our tag prefix is the latest
            break;
        }

        StatusChanged?.Invoke("Up to date");
        Debug.WriteLine("[AutoUpdate] Up to date");
    }

    public async Task<bool> ApplyUpdate()
    {
        if (!UpdateAvailable || DownloadUrl == null || IsUpdating) return false;
        IsUpdating = true;
        StatusChanged?.Invoke("Downloading update...");

        try
        {
            var installDir = Path.GetDirectoryName(Environment.ProcessPath)!;
            var tempDir = Path.Combine(Path.GetTempPath(), $"LocalCrmAgent_Update_{LatestVersion}");
            var tempZip = tempDir + ".zip";

            // Download
            Debug.WriteLine($"[AutoUpdate] Downloading {DownloadUrl}");
            using (var dlResp = await _http.GetAsync(DownloadUrl))
            {
                dlResp.EnsureSuccessStatusCode();
                await using var fs = File.Create(tempZip);
                await dlResp.Content.CopyToAsync(fs);
            }

            // Extract
            if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
            ZipFile.ExtractToDirectory(tempZip, tempDir);

            // Locate new exe
            var newExe = Path.Combine(tempDir, "LocalCrmAgent.exe");
            if (!File.Exists(newExe))
            {
                var found = Directory.GetFiles(tempDir, "LocalCrmAgent.exe", SearchOption.AllDirectories);
                newExe = found.Length > 0
                    ? found[0]
                    : throw new FileNotFoundException("LocalCrmAgent.exe not found in update package");
            }

            var targetExe = Path.Combine(installDir, "LocalCrmAgent.exe");

            // Write updater script that swaps the exe after this process exits
            var script = Path.Combine(Path.GetTempPath(), "LocalCrmAgent_Updater.bat");
            File.WriteAllText(script, $"""
                @echo off
                timeout /t 2 /nobreak >nul
                taskkill /IM LocalCrmAgent.exe /F >nul 2>&1
                timeout /t 2 /nobreak >nul
                copy /Y "{newExe}" "{targetExe}" >nul
                if %ERRORLEVEL% neq 0 (
                    timeout /t 3 /nobreak >nul
                    copy /Y "{newExe}" "{targetExe}" >nul
                )
                start "" "{targetExe}"
                timeout /t 5 /nobreak >nul
                rmdir /s /q "{tempDir}" >nul 2>&1
                del "{tempZip}" >nul 2>&1
                del "%~f0" >nul 2>&1
                """);

            StatusChanged?.Invoke("Installing update...");
            Debug.WriteLine("[AutoUpdate] Launching updater, exiting...");

            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{script}\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            });

            Application.Exit();
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AutoUpdate] Failed: {ex.Message}");
            StatusChanged?.Invoke("Update failed");
            IsUpdating = false;
            return false;
        }
    }

    public void Stop()
    {
        _cts?.Cancel();
        try { _loopTask?.Wait(3000); } catch { }
        _cts?.Dispose();
        _cts = null;
    }

    public void Dispose()
    {
        Stop();
        _http.Dispose();
    }
}
