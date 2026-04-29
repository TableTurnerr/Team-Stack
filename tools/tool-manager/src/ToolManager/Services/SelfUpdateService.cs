using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;

namespace ToolManager.Services;

/// <summary>
/// Checks for and applies updates to the Tool Manager itself.
/// Uses a batch-script swap approach to replace the running executable.
/// </summary>
public class SelfUpdateService : IDisposable
{
    private readonly GitHubReleaseService _github;
    private readonly DownloadService _downloadService;
    private readonly SettingsService _settings;

    private CancellationTokenSource? _cts;
    private Task? _loopTask;

    // Cache the last check result so ApplyUpdate doesn't re-fetch
    private (Version? version, string? url) _lastCheck;

    public Version CurrentVersion { get; } =
        System.Reflection.Assembly.GetExecutingAssembly().GetName().Version ?? new Version(0, 0, 0);

    /// <summary>Full version string including pre-release suffix (e.g. "2.0.4-dev.20260323.1").</summary>
    public string CurrentVersionDisplay { get; } =
        System.Reflection.Assembly.GetExecutingAssembly()
            .GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>()
            ?.InformationalVersion ?? System.Reflection.Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";

    /// <summary>True when running a local dev build.</summary>
    public bool IsDevBuild => CurrentVersionDisplay.Contains("-dev.", StringComparison.OrdinalIgnoreCase);

    public Version? LatestVersion { get; private set; }
    public bool UpdateAvailable => LatestVersion != null && !IsDevBuild && LatestVersion > CurrentVersion;

    public event Action<Version>? UpdateFound;
    public event Action<Version, string>? UpdateApplyFailed;

    public SelfUpdateService(GitHubReleaseService github, DownloadService downloadService, SettingsService settings)
    {
        _github = github;
        _downloadService = downloadService;
        _settings = settings;
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

                    if (_settings.Settings.AutoUpdateEnabled)
                    {
                        FileLogger.Write($"[SelfUpdate] Auto-applying v{version}");
                        var ok = await ApplyUpdate(ct);
                        if (ok) return;
                        // ApplyUpdate failed — UpdateApplyFailed already fired; loop again next interval.
                    }
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

    public async Task<bool> ApplyUpdate(CancellationToken ct = default)
    {
        // Use cached result from CheckNow/Loop to avoid redundant API call
        var (version, url) = _lastCheck.version != null ? _lastCheck : await _github.CheckSelfUpdate(ct);
        if (version == null || url == null) return false;
        return await ApplySpecificVersion(version, url, ct);
    }

    /// <summary>
    /// Apply a specific version by URL. Used for switching from dev build to release
    /// when the numeric version matches (so normal ApplyUpdate won't find it).
    /// </summary>
    public async Task<bool> ApplySpecificVersion(Version version, string url, CancellationToken ct = default)
    {

        string? zipPath = null;
        string? tempDir = null;
        string? script = null;

        try
        {
            zipPath = await _downloadService.DownloadAsync(url, ct: ct);
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

            // Escape special characters for cmd.exe inside double-quoted strings.
            // %, &, ^, <, >, | all need protection to survive batch interpretation.
            string CmdEscape(string path) => path
                .Replace("%", "%%")
                .Replace("^", "^^")
                .Replace("&", "^&")
                .Replace("<", "^<")
                .Replace(">", "^>")
                .Replace("|", "^|");

            var qNewExe = CmdEscape(newExe);
            var qTargetExe = CmdEscape(targetExe);
            var qInstallDir = CmdEscape(installDir);
            var qTempDir = CmdEscape(tempDir);
            var qZipPath = CmdEscape(zipPath);

            script = Path.Combine(Path.GetTempPath(), "ToolManager_Updater.bat");
            File.WriteAllText(script, $"""
                @echo off
                timeout /t 2 /nobreak >nul
                taskkill /IM ToolManager.exe /F >nul 2>&1
                timeout /t 2 /nobreak >nul
                copy /Y "{qNewExe}" "{qTargetExe}" >nul
                if %ERRORLEVEL% neq 0 (
                    timeout /t 3 /nobreak >nul
                    copy /Y "{qNewExe}" "{qTargetExe}" >nul
                )
                start /D "{qInstallDir}" "" "{qTargetExe}"
                timeout /t 5 /nobreak >nul
                rmdir /s /q "{qTempDir}" >nul 2>&1
                del "{qZipPath}" >nul 2>&1
                del "%~f0" >nul 2>&1
                """);

            FileLogger.Write($"[SelfUpdate] Launching updater for v{version}, exiting...");
            using (Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{script}\"",
                CreateNoWindow = true,
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden,
            })) { /* handle disposed; child detached */ }

            Environment.Exit(0);
            return true;
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[SelfUpdate] Failed to apply v{version}: {ex.Message}");
            UpdateApplyFailed?.Invoke(version, ex.Message);
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
        try { _loopTask?.Wait(3000); }
        catch (AggregateException ae) when (ae.InnerExceptions.All(e => e is OperationCanceledException)) { }
        catch (Exception ex) { FileLogger.Write($"[SelfUpdate] Shutdown error: {ex}"); }
        _cts?.Dispose();
    }
}
