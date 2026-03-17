using System.Diagnostics;
using System.IO.Compression;

namespace ToolManager.Services;

/// <summary>
/// Checks for and applies updates to the Tool Manager itself.
/// Uses a batch-script swap approach to replace the running executable.
/// </summary>
public class SelfUpdateService : IDisposable
{
    private readonly GitHubReleaseService _github;
    private readonly DownloadService _downloadService;

    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    // Cache the last check result so ApplyUpdate doesn't re-fetch
    private (Version? version, string? url) _lastCheck;

    public Version CurrentVersion { get; } =
        System.Reflection.Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0);

    public Version? LatestVersion { get; private set; }
    public bool UpdateAvailable => LatestVersion != null && LatestVersion > CurrentVersion;

    public event Action<Version>? UpdateFound;

    public SelfUpdateService(GitHubReleaseService github, DownloadService downloadService)
    {
        _github = github;
        _downloadService = downloadService;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
    }

    private async Task Loop(CancellationToken ct)
    {
        await Task.Delay(TimeSpan.FromMinutes(1), ct);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                var (version, url) = await _github.CheckSelfUpdate(ct);
                if (version != null)
                {
                    _lastCheck = (version, url);
                    LatestVersion = version;
                    Debug.WriteLine($"[SelfUpdate] Found: v{version}");
                    UpdateFound?.Invoke(version);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[SelfUpdate] Error: {ex.Message}");
            }

            await Task.Delay(TimeSpan.FromMinutes(15), ct);
        }
    }

    /// <summary>Manual check triggered from the UI.</summary>
    public async Task CheckNow(CancellationToken ct = default)
    {
        var (version, url) = await _github.CheckSelfUpdate(ct);
        if (version != null)
        {
            _lastCheck = (version, url);
            LatestVersion = version;
            Debug.WriteLine($"[SelfUpdate] Found: v{version}");
            UpdateFound?.Invoke(version);
        }
    }

    public async Task<bool> ApplyUpdate()
    {
        // Use cached result from CheckNow/Loop to avoid redundant API call
        var (version, url) = _lastCheck.version != null ? _lastCheck : await _github.CheckSelfUpdate();
        if (version == null || url == null) return false;

        string? zipPath = null;
        string? tempDir = null;
        string? script = null;

        try
        {
            zipPath = await _downloadService.DownloadAsync(url);
            tempDir = Path.Combine(Path.GetTempPath(), $"ToolManager_SelfUpdate_{version}");
            if (Directory.Exists(tempDir)) Directory.Delete(tempDir, true);
            ZipFile.ExtractToDirectory(zipPath, tempDir);

            var newExe = Path.Combine(tempDir, "ToolManager.exe");
            if (!File.Exists(newExe))
            {
                var found = Directory.GetFiles(tempDir, "ToolManager.exe", SearchOption.AllDirectories);
                newExe = found.Length > 0
                    ? found[0]
                    : throw new FileNotFoundException("ToolManager.exe not found in update package");
            }

            var installDir = Path.GetDirectoryName(Environment.ProcessPath)!;
            var targetExe = Path.Combine(installDir, "ToolManager.exe");

            script = Path.Combine(Path.GetTempPath(), "ToolManager_Updater.bat");
            File.WriteAllText(script, $"""
                @echo off
                timeout /t 2 /nobreak >nul
                taskkill /IM ToolManager.exe /F >nul 2>&1
                timeout /t 2 /nobreak >nul
                copy /Y "{newExe}" "{targetExe}" >nul
                if %ERRORLEVEL% neq 0 (
                    timeout /t 3 /nobreak >nul
                    copy /Y "{newExe}" "{targetExe}" >nul
                )
                start "" "{targetExe}"
                timeout /t 5 /nobreak >nul
                rmdir /s /q "{tempDir}" >nul 2>&1
                del "{zipPath}" >nul 2>&1
                del "%~f0" >nul 2>&1
                """);

            Debug.WriteLine("[SelfUpdate] Launching updater, exiting...");
            Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{script}\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            });

            Environment.Exit(0);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SelfUpdate] Failed: {ex.Message}");
            // Clean up on failure
            if (script != null) try { File.Delete(script); } catch { }
            if (zipPath != null) try { File.Delete(zipPath); } catch { }
            if (tempDir != null) try { Directory.Delete(tempDir, true); } catch { }
            return false;
        }
    }

    public void Dispose()
    {
        _cts?.Cancel();
        try { _loopTask?.Wait(3000); } catch { }
        _cts?.Dispose();
    }
}
