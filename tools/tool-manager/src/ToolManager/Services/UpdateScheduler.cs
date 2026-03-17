using System.Diagnostics;
using ToolManager.Models;

namespace ToolManager.Services;

/// <summary>
/// Automatic update scheduler for already-installed tools only.
/// New tools are never auto-installed — the user picks those from the UI.
/// - On startup + hourly: auto-updates installed tools silently.
/// </summary>
public class UpdateScheduler : IDisposable
{
    private readonly GitHubReleaseService _github;
    private readonly InstallService _installer;
    private readonly InstalledToolsRegistry _registry;

    private CancellationTokenSource? _cts;
    private Task? _loopTask;
    private DateTime _lastCheck;

    /// <summary>Fired after each check so the UI can refresh.</summary>
    public event Action? UpdatesChecked;

    /// <summary>Fired before auto-updating with the list of tool names.</summary>
    public event Action<List<string>>? UpdatingTools;

    /// <summary>Fired after auto-update with results.</summary>
    public event Action<List<(string name, string version, bool success)>>? UpdatesApplied;

    public DateTime LastCheckTime => _lastCheck;

    public UpdateScheduler(GitHubReleaseService github, InstallService installer, InstalledToolsRegistry registry)
    {
        _github = github;
        _installer = installer;
        _registry = registry;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _loopTask = Task.Run(() => Loop(_cts.Token));
    }

    private async Task Loop(CancellationToken ct)
    {
        // Startup check after 10s
        await Task.Delay(TimeSpan.FromSeconds(10), ct);
        await CheckAndUpdateInstalled(ct);

        // Hourly loop
        while (!ct.IsCancellationRequested)
        {
            await Task.Delay(TimeSpan.FromHours(1), ct);
            try { await CheckAndUpdateInstalled(ct); }
            catch (Exception ex) { Debug.WriteLine($"[UpdateScheduler] Error: {ex.Message}"); }
        }
    }

    /// <summary>
    /// Check for updates to already-installed tools and apply them automatically.
    /// Never installs new tools — that's the user's choice via the UI.
    /// </summary>
    public async Task CheckAndUpdateInstalled(CancellationToken ct = default)
    {
        Debug.WriteLine("[UpdateScheduler] Checking installed tools for updates...");
        var tools = await _github.FetchToolsAsync(forceRefresh: true, ct: ct);
        _lastCheck = DateTime.UtcNow;

        // Only update tools the user has already installed
        var toUpdate = tools.Where(t => t.IsInstalled && t.UpdateAvailable).ToList();

        if (toUpdate.Count == 0)
        {
            Debug.WriteLine("[UpdateScheduler] All installed tools up to date");
            UpdatesChecked?.Invoke();
            return;
        }

        // Notify tray
        UpdatingTools?.Invoke(toUpdate.Select(t => t.DisplayName).ToList());

        // Apply updates
        var results = new List<(string name, string version, bool success)>();

        foreach (var tool in toUpdate)
        {
            Debug.WriteLine($"[UpdateScheduler] Updating {tool.DisplayName} {tool.InstalledVersion} -> {tool.LatestVersion}...");
            var success = await _installer.InstallOrUpdate(tool, ct: ct);
            results.Add((tool.DisplayName, tool.LatestVersion.ToString(), success));
        }

        UpdatesApplied?.Invoke(results);
        UpdatesChecked?.Invoke();
    }

    /// <summary>Just refresh the tool list without applying anything (for UI).</summary>
    public async Task RefreshToolList(CancellationToken ct = default)
    {
        await _github.FetchToolsAsync(forceRefresh: true, ct: ct);
        _lastCheck = DateTime.UtcNow;
        UpdatesChecked?.Invoke();
    }

    public void Dispose()
    {
        _cts?.Cancel();
        try { _loopTask?.Wait(3000); } catch { }
        _cts?.Dispose();
    }
}
