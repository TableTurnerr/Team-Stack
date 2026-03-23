using System.Diagnostics;
using Spectre.Console;
using Color = Spectre.Console.Color;
using Panel = Spectre.Console.Panel;
using ToolManager.Models;
using ToolManager.Services;

namespace ToolManager.UI;

/// <summary>
/// Interactive terminal UI for the Tool Manager — styled after modern CLI tools.
/// </summary>
public class CliApp
{
    private readonly GitHubReleaseService _github;
    private readonly InstallService _installer;
    private readonly InstalledToolsRegistry _registry;
    private readonly UpdateScheduler _scheduler;
    private readonly SelfUpdateService _selfUpdater;
    private readonly SettingsService _settings;

    public CliApp(
        GitHubReleaseService github,
        InstallService installer,
        InstalledToolsRegistry registry,
        UpdateScheduler scheduler,
        SelfUpdateService selfUpdater,
        SettingsService settings)
    {
        _github = github;
        _installer = installer;
        _registry = registry;
        _scheduler = scheduler;
        _selfUpdater = selfUpdater;
        _settings = settings;
    }

    private DateTime _lastFetchTime;

    public async Task RunAsync()
    {
        // First load — auto-update installed tools silently
        AnsiConsole.Clear();
        RenderHeader();
        var tools = await FetchTools();
        await AutoUpdateInstalledTools(tools);

        while (true)
        {
            try
            {
                AnsiConsole.Clear();
                RenderHeader();

                tools = await FetchTools();
                RenderToolTable(tools);
                AnsiConsole.WriteLine();

                var action = PromptAction(tools);
                if (action == "Exit") break;

                await HandleAction(action, tools);

                AnsiConsole.WriteLine();
                AnsiConsole.Markup("[dim]Press any key to continue...[/]");
                Console.ReadKey(true);
            }
            catch (Exception ex)
            {
                AnsiConsole.MarkupLine($"[red]Error: {Markup.Escape(ex.Message)}[/]");
                AnsiConsole.Markup("[dim]Press any key to continue...[/]");
                Console.ReadKey(true);
            }
        }

        AnsiConsole.MarkupLine("[dim]Goodbye.[/]");
    }

    /// <summary>
    /// Auto-update all installed tools that have updates available. No confirmation needed.
    /// </summary>
    private async Task AutoUpdateInstalledTools(List<ToolInfo> tools)
    {
        await _selfUpdater.CheckNow();

        var updatable = tools.Where(t => t.IsInstalled && t.UpdateAvailable).ToList();
        var hasSelfUpdate = _selfUpdater.UpdateAvailable;

        if (updatable.Count == 0 && !hasSelfUpdate) return;

        var totalUpdates = updatable.Count + (hasSelfUpdate ? 1 : 0);
        AnsiConsole.MarkupLine($"[yellow]Found {totalUpdates} update(s) — applying automatically...[/]");
        AnsiConsole.WriteLine();

        foreach (var tool in updatable)
        {
            await RunInstallWithProgress(tool, "Updating");
        }
        _github.RefreshInstalledStatus();

        if (hasSelfUpdate)
        {
            AnsiConsole.MarkupLine($"[yellow]Updating Tool Manager v{_selfUpdater.CurrentVersion.ToString(3)} → v{_selfUpdater.LatestVersion!.ToString(3)} — restarting...[/]");
            await _selfUpdater.ApplyUpdate();
            return;
        }

        AnsiConsole.MarkupLine("[green]All updates applied.[/]");
        AnsiConsole.WriteLine();
        AnsiConsole.Markup("[dim]Press any key to continue...[/]");
        Console.ReadKey(true);
    }

    // ── Header ──────────────────────────────────────────────

    private void RenderHeader()
    {
        var version = _selfUpdater.CurrentVersionDisplay;
        var authTag = _github.IsAuthenticated
            ? "[green]Authenticated[/] (5,000 req/hr)"
            : "[yellow]Unauthenticated[/] (60 req/hr)";

        var lastCheck = _lastFetchTime == default
            ? "never"
            : FormatElapsed(DateTime.UtcNow - _lastFetchTime);

        var content = new Markup(
            $"  API: {authTag}\n" +
            $"  Last checked: [dim]{lastCheck}[/]");

        var panel = new Panel(content)
            .Header($"[bold dodgerblue1] TableTurnerr Tool Manager [/][dim]v{version}[/]")
            .Border(BoxBorder.Rounded)
            .BorderColor(Color.DodgerBlue1)
            .Padding(0, 0, 1, 0);

        AnsiConsole.Write(panel);
        AnsiConsole.WriteLine();
    }

    // ── Tool table ──────────────────────────────────────────

    private void RenderToolTable(List<ToolInfo> tools)
    {
        var table = new Table()
            .Border(TableBorder.Rounded)
            .BorderColor(Color.Grey)
            .AddColumn(new TableColumn("[bold]Tool[/]").NoWrap())
            .AddColumn(new TableColumn("[bold]Latest[/]").Centered())
            .AddColumn(new TableColumn("[bold]Installed[/]").Centered())
            .AddColumn(new TableColumn("[bold]Status[/]"))
            .AddColumn(new TableColumn("[bold]Type[/]"));

        // Manager self-entry
        var selfLatest = _selfUpdater.UpdateAvailable
            ? $"v{_selfUpdater.LatestVersion!.ToString(3)}"
            : $"v{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}";
        var selfInstalled = _selfUpdater.IsDevBuild
            ? $"[cyan]v{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}[/]"
            : $"v{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}";
        var selfStatus = _selfUpdater.IsDevBuild
            ? "[cyan]Dev build[/]"
            : _selfUpdater.UpdateAvailable
                ? "[yellow]Update available[/]"
                : "[green]Up to date[/]";
        table.AddRow(
            "[dodgerblue1]Tool Manager[/]",
            selfLatest,
            selfInstalled,
            selfStatus,
            "[dim]this app[/]");

        foreach (var tool in tools)
        {
            var latest = FormatVersion(tool.LatestVersion);
            var installed = tool.IsInstalled
                ? (tool.IsDevBuild ? $"[cyan]v{Markup.Escape(tool.InstalledVersionRaw ?? "")}[/]" : FormatVersion(tool.InstalledVersion))
                : "[dim]—[/]";

            string status;
            if (tool.IsDevBuild)
                status = "[cyan]Dev build[/]";
            else if (tool.UpdateAvailable)
                status = "[yellow]Update available[/]";
            else if (tool.IsInstalled)
                status = "[green]Up to date[/]";
            else
                status = "[dim]Not installed[/]";

            var type = tool.ToolType switch
            {
                "windows-app" => "Windows App",
                "chrome-extension" => "Chrome Ext",
                "unknown" => "[dim]—[/]",
                _ => tool.ToolType,
            };

            table.AddRow(
                $"[bold]{Markup.Escape(tool.DisplayName)}[/]",
                latest,
                installed,
                status,
                type);
        }

        AnsiConsole.Write(table);
    }

    // ── Action menu ─────────────────────────────────────────

    private string PromptAction(List<ToolInfo> tools)
    {
        var choices = new List<string> { "Check for Updates" };

        if (tools.Any(t => !t.IsInstalled)) choices.Add("Install a Tool");
        if (tools.Any(t => t.UpdateAvailable) || _selfUpdater.UpdateAvailable) choices.Add("Update a Tool");
        if (tools.Any(t => t.UpdateAvailable) || _selfUpdater.UpdateAvailable) choices.Add("Update All");
        if (tools.Any(t => t.IsInstalled)) choices.Add("Uninstall a Tool");
        if (tools.Any(t => t.IsInstalled)) choices.Add("Manage a Tool");
        if (tools.Any(t => t.IsDevBuild) || _selfUpdater.IsDevBuild) choices.Add("Switch to Release");

        choices.Add("Settings");
        choices.Add("Exit");

        return AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]What would you like to do?[/]")
                .HighlightStyle(new Style(Color.DodgerBlue1, decoration: Decoration.Bold))
                .PageSize(12)
                .AddChoices(choices));
    }

    // ── Action handlers ─────────────────────────────────────

    private async Task HandleAction(string action, List<ToolInfo> tools)
    {
        switch (action)
        {
            case "Check for Updates":
                await CheckForUpdates();
                break;
            case "Install a Tool":
                await InstallTool(tools);
                break;
            case "Update a Tool":
                await UpdateTool(tools.Where(t => t.UpdateAvailable).ToList());
                break;
            case "Update All":
                await UpdateAll(tools.Where(t => t.UpdateAvailable).ToList());
                break;
            case "Uninstall a Tool":
                await UninstallTool(tools.Where(t => t.IsInstalled).ToList());
                break;
            case "Manage a Tool":
                await ManageTool(tools.Where(t => t.IsInstalled).ToList());
                break;
            case "Switch to Release":
                await SwitchToRelease(tools.Where(t => t.IsDevBuild).ToList());
                break;
            case "Settings":
                await SettingsMenu();
                break;
        }
    }

    private async Task CheckForUpdates()
    {
        List<ToolInfo> tools = [];

        await AnsiConsole.Status()
            .Spinner(Spinner.Known.Dots)
            .SpinnerStyle(new Style(Color.DodgerBlue1))
            .StartAsync("Checking for updates...", async ctx =>
            {
                _github.InvalidateCache();
                _registry.Load();
                tools = await _github.FetchToolsAsync(forceRefresh: true);
                _lastFetchTime = DateTime.UtcNow;
                ctx.Status("Checking for manager updates...");
                await _selfUpdater.CheckNow();
            });

        var updatable = tools.Where(t => t.IsInstalled && t.UpdateAvailable).ToList();
        var hasSelfUpdate = _selfUpdater.UpdateAvailable;

        if (updatable.Count == 0 && !hasSelfUpdate)
        {
            AnsiConsole.MarkupLine("[green]All tools are up to date.[/]");
            return;
        }

        var totalUpdates = updatable.Count + (hasSelfUpdate ? 1 : 0);
        AnsiConsole.MarkupLine($"[yellow]Found {totalUpdates} update(s):[/]");
        if (hasSelfUpdate)
        {
            AnsiConsole.MarkupLine($"  [bold dodgerblue1]Tool Manager[/]  " +
                $"v{_selfUpdater.CurrentVersion.ToString(3)} → v{_selfUpdater.LatestVersion!.ToString(3)}");
        }
        foreach (var t in updatable)
        {
            AnsiConsole.MarkupLine($"  [bold]{Markup.Escape(t.DisplayName)}[/]  " +
                $"{FormatVersion(t.InstalledVersion)} → {FormatVersion(t.LatestVersion)}");
        }
        AnsiConsole.WriteLine();

        if (!AnsiConsole.Confirm("Apply updates now?", defaultValue: true))
            return;

        AnsiConsole.WriteLine();

        foreach (var tool in updatable)
        {
            await RunInstallWithProgress(tool, "Updating");
        }
        _github.RefreshInstalledStatus();

        if (hasSelfUpdate)
        {
            AnsiConsole.MarkupLine("[yellow]Applying Tool Manager update — the app will restart...[/]");
            await _selfUpdater.ApplyUpdate();
            return;
        }

        AnsiConsole.MarkupLine("[green]All updates applied.[/]");
    }

    // ── Install (with version picker) ───────────────────────

    private async Task InstallTool(List<ToolInfo> tools)
    {
        var installable = tools.Where(t => !t.IsInstalled).ToList();
        if (installable.Count == 0)
        {
            AnsiConsole.MarkupLine("[dim]No tools available to install.[/]");
            return;
        }

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Select a tool to install:[/]")
                .HighlightStyle(new Style(Color.Green))
                .AddChoices(installable.Select(t => $"{t.DisplayName} (v{FormatVersionRaw(t.LatestVersion)})"))
                .AddChoices("Cancel"));

        if (choice == "Cancel") return;

        var tool = installable.FirstOrDefault(t => choice.StartsWith(t.DisplayName));
        if (tool == null) return;

        // Version picker if multiple versions available
        var (selectedVersion, selectedUrl) = PickVersion(tool);
        if (selectedVersion == null) return;

        if (selectedVersion == tool.LatestVersion)
        {
            await RunInstallWithProgress(tool, "Installing");
        }
        else
        {
            await RunInstallWithProgress(tool, "Installing", selectedUrl, selectedVersion);
        }
    }

    private async Task UpdateTool(List<ToolInfo> tools)
    {
        var hasSelfUpdate = _selfUpdater.UpdateAvailable;

        if (tools.Count == 0 && !hasSelfUpdate)
        {
            AnsiConsole.MarkupLine("[dim]All tools are up to date.[/]");
            return;
        }

        var choices = new List<string>();

        if (hasSelfUpdate)
            choices.Add($"Tool Manager (v{_selfUpdater.CurrentVersion.ToString(3)} → v{_selfUpdater.LatestVersion!.ToString(3)})");

        choices.AddRange(tools.Select(t =>
            $"{t.DisplayName} ({FormatVersionRaw(t.InstalledVersion)} → v{FormatVersionRaw(t.LatestVersion)})"));

        choices.Add("Cancel");

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Select a tool to update:[/]")
                .HighlightStyle(new Style(Color.Yellow))
                .AddChoices(choices));

        if (choice == "Cancel") return;

        if (choice.StartsWith("Tool Manager"))
        {
            AnsiConsole.MarkupLine("[yellow]Applying Tool Manager update — the app will restart...[/]");
            await _selfUpdater.ApplyUpdate();
            return;
        }

        var tool = tools.FirstOrDefault(t => choice.StartsWith(t.DisplayName));
        if (tool == null) return;
        await RunInstallWithProgress(tool, "Updating");
    }

    private async Task UpdateAll(List<ToolInfo> tools)
    {
        var hasSelfUpdate = _selfUpdater.UpdateAvailable;
        var totalUpdates = tools.Count + (hasSelfUpdate ? 1 : 0);

        if (totalUpdates == 0)
        {
            AnsiConsole.MarkupLine("[dim]All tools are up to date.[/]");
            return;
        }

        AnsiConsole.MarkupLine($"[yellow]Updating {totalUpdates} tool(s)...[/]");
        AnsiConsole.WriteLine();

        foreach (var tool in tools)
        {
            await RunInstallWithProgress(tool, "Updating");
        }
        _github.RefreshInstalledStatus();

        if (hasSelfUpdate)
        {
            AnsiConsole.MarkupLine($"[yellow]Updating Tool Manager v{_selfUpdater.CurrentVersion.ToString(3)} → v{_selfUpdater.LatestVersion!.ToString(3)} — restarting...[/]");
            await _selfUpdater.ApplyUpdate();
            return;
        }

        AnsiConsole.MarkupLine("[green]All updates applied.[/]");
    }

    private async Task UninstallTool(List<ToolInfo> tools)
    {
        if (tools.Count == 0)
        {
            AnsiConsole.MarkupLine("[dim]No tools installed to uninstall.[/]");
            return;
        }

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Select a tool to uninstall:[/]")
                .HighlightStyle(new Style(Color.Red))
                .AddChoices(tools.Select(t =>
                    $"{t.DisplayName} (v{t.InstalledVersionRaw ?? FormatVersionRaw(t.InstalledVersion)})"))
                .AddChoices("Cancel"));

        if (choice == "Cancel") return;

        var tool = tools.FirstOrDefault(t => choice.StartsWith(t.DisplayName));
        if (tool == null) return;

        if (!AnsiConsole.Confirm($"Uninstall [bold]{Markup.Escape(tool.DisplayName)}[/]?", defaultValue: false))
            return;

        await AnsiConsole.Status()
            .Spinner(Spinner.Known.Dots)
            .SpinnerStyle(new Style(Color.Red))
            .StartAsync($"Uninstalling {tool.DisplayName}...", async _ =>
            {
                await _installer.Uninstall(tool.TagPrefix);
            });

        _github.RefreshInstalledStatus();
        AnsiConsole.MarkupLine($"[green]{Markup.Escape(tool.DisplayName)} uninstalled.[/]");
    }

    // ── Switch to Release ───────────────────────────────────

    private async Task SwitchToRelease(List<ToolInfo> devTools)
    {
        var selfIsDev = _selfUpdater.IsDevBuild;

        if (devTools.Count == 0 && !selfIsDev)
        {
            AnsiConsole.MarkupLine("[dim]No dev builds found.[/]");
            return;
        }

        var choices = new List<string>();

        if (selfIsDev)
        {
            // Need to fetch the latest release version for Tool Manager
            var (latestSelfVer, _) = _github.GetCachedSelfUpdate();
            var latestLabel = latestSelfVer != null
                ? $"v{latestSelfVer.ToString(3)}"
                : "latest release";
            choices.Add($"Tool Manager ({_selfUpdater.CurrentVersionDisplay} → {latestLabel})");
        }

        choices.AddRange(devTools.Select(t =>
            $"{t.DisplayName} ({t.InstalledVersionRaw} → v{FormatVersionRaw(t.LatestVersion)})"));

        choices.Add("Cancel");

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Switch which tool from dev build to release?[/]")
                .HighlightStyle(new Style(Color.Cyan1))
                .AddChoices(choices));

        if (choice == "Cancel") return;

        if (choice.StartsWith("Tool Manager"))
        {
            AnsiConsole.MarkupLine("[yellow]Fetching latest release...[/]");
            var (ver, url) = await _github.GetLatestSelfRelease();

            if (ver == null || url == null)
            {
                AnsiConsole.MarkupLine("[red]Could not find a release version to switch to.[/]");
                return;
            }

            if (!AnsiConsole.Confirm(
                    $"Replace dev build [cyan]{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}[/] with release [green]v{ver.ToString(3)}[/]?",
                    defaultValue: true))
                return;

            AnsiConsole.MarkupLine("[yellow]Switching to release — the app will restart...[/]");
            await _selfUpdater.ApplySpecificVersion(ver, url);
            return;
        }

        var tool = devTools.FirstOrDefault(t => choice.StartsWith(t.DisplayName));
        if (tool == null) return;

        if (!AnsiConsole.Confirm(
                $"Replace dev build [cyan]{Markup.Escape(tool.InstalledVersionRaw ?? "")}[/] with release [green]v{FormatVersionRaw(tool.LatestVersion)}[/]?",
                defaultValue: true))
            return;

        await RunInstallWithProgress(tool, "Switching to release");
    }


    // ── Manage a Tool ───────────────────────────────────────

    private async Task ManageTool(List<ToolInfo> installed)
    {
        if (installed.Count == 0)
        {
            AnsiConsole.MarkupLine("[dim]No tools installed.[/]");
            return;
        }

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Select a tool to manage:[/]")
                .HighlightStyle(new Style(Color.DodgerBlue1))
                .AddChoices(installed.Select(t =>
                    $"{t.DisplayName} (v{t.InstalledVersionRaw ?? FormatVersionRaw(t.InstalledVersion)})"))
                .AddChoices("Cancel"));

        if (choice == "Cancel") return;

        var tool = installed.FirstOrDefault(t => choice.StartsWith(t.DisplayName));
        if (tool == null) return;

        await ManageToolSubmenu(tool);
    }

    private async Task ManageToolSubmenu(ToolInfo tool)
    {
        var regEntry = _registry.GetByTagPrefix(tool.TagPrefix);

        var actions = new List<string>
        {
            "View Details",
            "View Release Notes",
            "Check Health",
            "Open Install Directory",
            "Launch / Restart",
            "Install Specific Version",
            "Repair (re-install)",
            "Manage Cached Versions",
            "Back",
        };

        var action = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title($"[bold]Managing: {Markup.Escape(tool.DisplayName)}[/]")
                .HighlightStyle(new Style(Color.DodgerBlue1))
                .PageSize(12)
                .AddChoices(actions));

        switch (action)
        {
            case "View Details":
                ViewToolDetails(tool, regEntry);
                break;
            case "View Release Notes":
                ViewReleaseNotes(tool);
                break;
            case "Check Health":
                CheckToolHealth(tool, regEntry);
                break;
            case "Open Install Directory":
                OpenInstallDirectory(tool);
                break;
            case "Launch / Restart":
                LaunchOrRestartTool(tool, regEntry);
                break;
            case "Install Specific Version":
                await InstallSpecificVersion(tool);
                break;
            case "Repair (re-install)":
                await RepairTool(tool);
                break;
            case "Manage Cached Versions":
                ManageCachedVersions(tool);
                break;
        }
    }

    // ── Manage: View Details ────────────────────────────────

    private void ViewToolDetails(ToolInfo tool, InstalledTool? reg)
    {
        var grid = new Grid().AddColumn().AddColumn();

        void Row(string label, string value) =>
            grid.AddRow($"[bold]{label}[/]", Markup.Escape(value));

        Row("Name", tool.DisplayName);
        Row("Tag Prefix", tool.TagPrefix);
        if (reg?.Id != null) Row("ID", reg.Id);
        if (tool.Description != null) Row("Description", tool.Description);
        Row("Type", tool.ToolType);
        Row("Installed Version", tool.InstalledVersionRaw ?? FormatVersionRaw(tool.InstalledVersion));
        Row("Latest Version", $"v{FormatVersionRaw(tool.LatestVersion)}");
        if (tool.IsDevBuild) grid.AddRow("[bold]Build Type[/]", "[cyan]Dev build[/]");
        if (tool.InstallPath != null) Row("Install Path", tool.InstallPath);
        if (reg != null)
        {
            Row("Installed At", reg.InstalledAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm"));
            Row("Updated At", reg.UpdatedAt.ToLocalTime().ToString("yyyy-MM-dd HH:mm"));
        }
        if (reg?.Manifest != null)
        {
            var m = reg.Manifest;
            if (m.Executable != null) Row("Executable", m.Executable);
            if (m.ProcessName != null) Row("Process Name", m.ProcessName);
            if (m.ProtocolHandler != null) Row("Protocol Handler", $"{m.ProtocolHandler}://");
            Row("Auto-Start", m.AutoStart ? "Yes" : "No");
            if (m.StartMenuName != null) Row("Start Menu", $"{m.StartMenuFolder ?? ""}\\{m.StartMenuName}");
        }

        var versions = tool.AllVersions;
        Row("Available Versions", versions.Count > 0 ? $"{versions.Count} release(s)" : "unknown");

        var cached = InstallService.GetCachedVersions(tool.TagPrefix);
        if (cached.Count > 0)
        {
            var totalSize = cached.Sum(c => c.sizeBytes) / (1024.0 * 1024.0);
            Row("Cached Versions", $"{cached.Count} ({totalSize:F1} MB)");
        }

        var panel = new Panel(grid)
            .Header($"[bold] {Markup.Escape(tool.DisplayName)} [/]")
            .Border(BoxBorder.Rounded)
            .BorderColor(Color.DodgerBlue1)
            .Padding(1, 0);

        AnsiConsole.WriteLine();
        AnsiConsole.Write(panel);
    }

    // ── Manage: View Release Notes ──────────────────────────

    private void ViewReleaseNotes(ToolInfo tool)
    {
        if (tool.AllVersions.Count == 0)
        {
            AnsiConsole.MarkupLine("[dim]No release notes available.[/]");
            return;
        }

        var choices = tool.AllVersions
            .Select(v => $"v{FormatVersionRaw(v.Version)}" +
                (v.PublishedAt.HasValue ? $" ({v.PublishedAt.Value.ToLocalTime():yyyy-MM-dd})" : ""))
            .ToList();
        choices.Add("Cancel");

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]View release notes for which version?[/]")
                .PageSize(15)
                .AddChoices(choices));

        if (choice == "Cancel") return;

        var idx = choices.IndexOf(choice);
        if (idx < 0 || idx >= tool.AllVersions.Count) return;

        var release = tool.AllVersions[idx];
        var body = release.ReleaseBody;

        if (string.IsNullOrWhiteSpace(body))
        {
            AnsiConsole.MarkupLine("[dim]No release notes for this version.[/]");
            return;
        }

        var panel = new Panel(Markup.Escape(body))
            .Header($"[bold] v{FormatVersionRaw(release.Version)} Release Notes [/]")
            .Border(BoxBorder.Rounded)
            .BorderColor(Color.Grey)
            .Padding(1, 0);

        AnsiConsole.WriteLine();
        AnsiConsole.Write(panel);
    }

    // ── Manage: Check Health ────────────────────────────────

    private void CheckToolHealth(ToolInfo tool, InstalledTool? reg)
    {
        AnsiConsole.WriteLine();

        var processName = reg?.Manifest?.ProcessName;
        var executable = reg?.Manifest?.Executable;
        var installPath = tool.InstallPath;

        // Check install directory
        if (installPath != null && Directory.Exists(installPath))
            AnsiConsole.MarkupLine($"  [green][[OK]][/]  Install directory exists: [dim]{Markup.Escape(installPath)}[/]");
        else
            AnsiConsole.MarkupLine($"  [red][[MISSING]][/]  Install directory not found: [dim]{Markup.Escape(installPath ?? "unknown")}[/]");

        // Check executable
        if (installPath != null && executable != null)
        {
            var exePath = Path.Combine(installPath, executable);
            if (File.Exists(exePath))
                AnsiConsole.MarkupLine($"  [green][[OK]][/]  Executable found: [dim]{Markup.Escape(executable)}[/]");
            else
                AnsiConsole.MarkupLine($"  [red][[MISSING]][/]  Executable not found: [dim]{Markup.Escape(exePath)}[/]");
        }

        // Check if process is running
        if (processName != null)
        {
            var procs = Process.GetProcessesByName(processName);
            if (procs.Length > 0)
            {
                foreach (var p in procs)
                {
                    try
                    {
                        var mem = p.WorkingSet64 / (1024.0 * 1024.0);
                        AnsiConsole.MarkupLine($"  [green][[RUNNING]][/]  PID {p.Id}, Memory: {mem:F1} MB");
                    }
                    catch
                    {
                        AnsiConsole.MarkupLine($"  [green][[RUNNING]][/]  PID {p.Id}");
                    }
                    p.Dispose();
                }
            }
            else
            {
                AnsiConsole.MarkupLine($"  [yellow][[STOPPED]][/]  Process [dim]{Markup.Escape(processName)}[/] is not running");
            }
        }

        // Check auto-start registry
        if (reg?.Manifest?.RegistryAutoStart != null)
        {
            try
            {
                using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Run");
                var val = key?.GetValue(reg.Manifest.RegistryAutoStart.Key) as string;
                if (val != null)
                    AnsiConsole.MarkupLine($"  [green][[OK]][/]  Auto-start registered: [dim]{Markup.Escape(reg.Manifest.RegistryAutoStart.Key)}[/]");
                else
                    AnsiConsole.MarkupLine($"  [yellow][[OFF]][/]  Auto-start not registered");
            }
            catch
            {
                AnsiConsole.MarkupLine($"  [dim][[?]][/]  Could not check auto-start registry");
            }
        }
    }

    // ── Manage: Open Install Directory ──────────────────────

    private static void OpenInstallDirectory(ToolInfo tool)
    {
        if (tool.InstallPath == null || !Directory.Exists(tool.InstallPath))
        {
            AnsiConsole.MarkupLine("[red]Install directory not found.[/]");
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = tool.InstallPath,
                UseShellExecute = true,
            });
            AnsiConsole.MarkupLine($"[green]Opened {Markup.Escape(tool.InstallPath)}[/]");
        }
        catch (Exception ex)
        {
            AnsiConsole.MarkupLine($"[red]Failed to open directory: {Markup.Escape(ex.Message)}[/]");
        }
    }

    // ── Manage: Launch / Restart ────────────────────────────

    private static void LaunchOrRestartTool(ToolInfo tool, InstalledTool? reg)
    {
        var processName = reg?.Manifest?.ProcessName;
        var executable = reg?.Manifest?.Executable;
        var installPath = tool.InstallPath;

        if (installPath == null || executable == null)
        {
            AnsiConsole.MarkupLine("[red]Cannot launch: unknown executable path.[/]");
            return;
        }

        var exePath = Path.Combine(installPath, executable);
        if (!File.Exists(exePath))
        {
            AnsiConsole.MarkupLine($"[red]Executable not found: {Markup.Escape(exePath)}[/]");
            return;
        }

        // Kill if running
        if (processName != null)
        {
            var procs = Process.GetProcessesByName(processName);
            if (procs.Length > 0)
            {
                AnsiConsole.MarkupLine($"[yellow]Stopping {Markup.Escape(processName)}...[/]");
                foreach (var p in procs)
                {
                    try { p.Kill(); } catch { }
                    p.Dispose();
                }
                Thread.Sleep(1000);
            }
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exePath,
                UseShellExecute = true,
            });
            AnsiConsole.MarkupLine($"[green]Launched {Markup.Escape(tool.DisplayName)}[/]");
        }
        catch (Exception ex)
        {
            AnsiConsole.MarkupLine($"[red]Failed to launch: {Markup.Escape(ex.Message)}[/]");
        }
    }

    // ── Manage: Install Specific Version ────────────────────

    private async Task InstallSpecificVersion(ToolInfo tool)
    {
        var (selectedVersion, selectedUrl) = PickVersion(tool);
        if (selectedVersion == null) return;

        var confirmMsg = tool.IsInstalled
            ? $"Replace [bold]v{tool.InstalledVersionRaw ?? FormatVersionRaw(tool.InstalledVersion)}[/] with [bold]v{FormatVersionRaw(selectedVersion)}[/]?"
            : $"Install [bold]v{FormatVersionRaw(selectedVersion)}[/]?";

        if (!AnsiConsole.Confirm(confirmMsg, defaultValue: true))
            return;

        await RunInstallWithProgress(tool, "Installing", selectedUrl, selectedVersion);
    }

    // ── Manage: Repair ──────────────────────────────────────

    private async Task RepairTool(ToolInfo tool)
    {
        // Try to find the installed version in AllVersions
        ReleaseVersion? target = null;
        if (tool.InstalledVersion != null)
            target = tool.AllVersions.FirstOrDefault(v => v.Version == tool.InstalledVersion);

        // If installed version is a dev build or not found, fall back to latest
        if (target == null)
        {
            var fallbackLabel = tool.IsDevBuild ? "dev build" : "installed version";
            AnsiConsole.MarkupLine($"[yellow]Cannot find {fallbackLabel} in releases — will re-install latest (v{FormatVersionRaw(tool.LatestVersion)}).[/]");
            target = tool.AllVersions.FirstOrDefault();
        }

        if (target == null)
        {
            AnsiConsole.MarkupLine("[red]No versions available to install.[/]");
            return;
        }

        if (!AnsiConsole.Confirm($"Re-install [bold]{Markup.Escape(tool.DisplayName)}[/] v{FormatVersionRaw(target.Version)}?", defaultValue: true))
            return;

        await RunInstallWithProgress(tool, "Repairing", target.DownloadUrl, target.Version);
    }

    // ── Manage: Cached Versions ─────────────────────────────

    private void ManageCachedVersions(ToolInfo tool)
    {
        var cached = InstallService.GetCachedVersions(tool.TagPrefix);

        if (cached.Count == 0)
        {
            AnsiConsole.MarkupLine("[dim]No versions cached locally. Versions are cached automatically when installed.[/]");
            return;
        }

        AnsiConsole.WriteLine();
        var table = new Table()
            .Border(TableBorder.Simple)
            .AddColumn("Version")
            .AddColumn("Size")
            .AddColumn("Path");

        foreach (var (ver, path, size) in cached)
        {
            var sizeMb = size / (1024.0 * 1024.0);
            table.AddRow($"v{FormatVersionRaw(ver)}", $"{sizeMb:F1} MB", Markup.Escape(path));
        }

        var totalSize = cached.Sum(c => c.sizeBytes) / (1024.0 * 1024.0);
        AnsiConsole.Write(table);
        AnsiConsole.MarkupLine($"  [dim]Total: {totalSize:F1} MB[/]");
        AnsiConsole.WriteLine();

        var actions = new List<string> { "Delete a Version", "Clear All", "Back" };
        var action = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Cache action:[/]")
                .AddChoices(actions));

        switch (action)
        {
            case "Delete a Version":
                var versions = cached.Select(c => $"v{FormatVersionRaw(c.version)} ({c.sizeBytes / (1024.0 * 1024.0):F1} MB)").ToList();
                versions.Add("Cancel");

                var pick = AnsiConsole.Prompt(
                    new SelectionPrompt<string>()
                        .Title("[bold]Delete which cached version?[/]")
                        .AddChoices(versions));

                if (pick == "Cancel") return;

                var idx = versions.IndexOf(pick);
                if (idx >= 0 && idx < cached.Count)
                {
                    InstallService.DeleteCachedVersion(tool.TagPrefix, cached[idx].version);
                    AnsiConsole.MarkupLine($"[green]Deleted cached v{FormatVersionRaw(cached[idx].version)}[/]");
                }
                break;

            case "Clear All":
                if (AnsiConsole.Confirm($"Delete all {cached.Count} cached version(s)?", defaultValue: false))
                {
                    InstallService.ClearCache(tool.TagPrefix);
                    AnsiConsole.MarkupLine("[green]Cache cleared.[/]");
                }
                break;
        }
    }

    // ── Settings ────────────────────────────────────────────

    private Task SettingsMenu()
    {
        while (true)
        {
            var settings = _settings.Settings;
            var startupLabel = settings.AutoStartEnabled
                ? "Startup: [green]Enabled[/]"
                : "Startup: [red]Disabled[/]";
            var autoUpdateLabel = settings.AutoUpdateEnabled
                ? "Auto-update: [green]Enabled[/]"
                : "Auto-update: [red]Disabled[/]";

            var cacheSize = InstallService.GetTotalCacheSize();
            var cacheSizeMb = cacheSize / (1024.0 * 1024.0);
            var cacheLabel = $"Clear Download Cache ({cacheSizeMb:F1} MB)";

            var action = AnsiConsole.Prompt(
                new SelectionPrompt<string>()
                    .Title("[bold]Settings[/]")
                    .HighlightStyle(new Style(Color.DodgerBlue1))
                    .AddChoices(
                        startupLabel,
                        autoUpdateLabel,
                        "Configure API Token",
                        cacheLabel,
                        "Back"));

            if (action == "Back") break;

            if (action == startupLabel)
            {
                var newVal = !settings.AutoStartEnabled;
                _settings.SetAutoStart(newVal);
                AnsiConsole.MarkupLine(newVal
                    ? "[green]Tool Manager will start with Windows.[/]"
                    : "[yellow]Tool Manager will no longer start with Windows.[/]");
            }
            else if (action == autoUpdateLabel)
            {
                var newVal = !settings.AutoUpdateEnabled;
                _settings.SetAutoUpdate(newVal);
                AnsiConsole.MarkupLine(newVal
                    ? "[green]Automatic updates enabled.[/]"
                    : "[yellow]Automatic updates disabled. Use 'Check for Updates' to update manually.[/]");
            }
            else if (action == "Configure API Token")
            {
                ConfigureToken();
            }
            else if (action == cacheLabel)
            {
                if (cacheSize == 0)
                {
                    AnsiConsole.MarkupLine("[dim]Cache is already empty.[/]");
                }
                else if (AnsiConsole.Confirm($"Delete all cached downloads ({cacheSizeMb:F1} MB)?", defaultValue: false))
                {
                    if (Directory.Exists(InstallService.CacheDir))
                        Directory.Delete(InstallService.CacheDir, true);
                    AnsiConsole.MarkupLine("[green]Cache cleared.[/]");
                }
            }

            AnsiConsole.WriteLine();
        }

        return Task.CompletedTask;
    }

    // ── Token management ────────────────────────────────────

    private void ConfigureToken()
    {
        AnsiConsole.WriteLine();

        var statusColor = _github.IsAuthenticated ? "green" : "yellow";
        var statusText = _github.IsAuthenticated
            ? $"Authenticated ({_github.RateLimitRemaining} requests remaining)"
            : "Not authenticated (60 requests/hour)";
        AnsiConsole.MarkupLine($"  Current status: [{statusColor}]{statusText}[/]");
        AnsiConsole.WriteLine();

        var existing = GitHubReleaseService.GetSavedToken();

        var actions = new List<string>();
        if (existing != null)
        {
            var masked = existing.Length > 4
                ? existing[..4] + new string('*', Math.Min(existing.Length - 4, 30))
                : new string('*', existing.Length);
            AnsiConsole.MarkupLine($"  Saved token: [dim]{Markup.Escape(masked)}[/]");
            AnsiConsole.WriteLine();
            actions.AddRange(["Replace Token", "Remove Token", "Cancel"]);
        }
        else
        {
            actions.AddRange(["Add Token", "Cancel"]);
        }

        var action = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Token action:[/]")
                .AddChoices(actions));

        switch (action)
        {
            case "Add Token":
            case "Replace Token":
                AnsiConsole.MarkupLine("[dim]Create a fine-grained token at github.com with read-only access to the Team-Stack repo.[/]");
                var token = AnsiConsole.Prompt(
                    new TextPrompt<string>("[bold]Paste your GitHub token:[/]")
                        .Secret());

                if (string.IsNullOrWhiteSpace(token))
                {
                    AnsiConsole.MarkupLine("[red]No token entered.[/]");
                    return;
                }

                _github.SetToken(token);
                AnsiConsole.MarkupLine("[green]Token saved and applied.[/]");
                break;

            case "Remove Token":
                _github.ClearToken();
                AnsiConsole.MarkupLine("[yellow]Token removed. Using unauthenticated requests.[/]");
                break;
        }
    }

    // ── Shared helpers ──────────────────────────────────────

    private async Task RunInstallWithProgress(ToolInfo tool, string verb, string? overrideUrl = null, Version? overrideVersion = null)
    {
        AnsiConsole.WriteLine();

        await AnsiConsole.Progress()
            .AutoRefresh(true)
            .HideCompleted(false)
            .Columns(
                new TaskDescriptionColumn(),
                new ProgressBarColumn()
                {
                    CompletedStyle = new Style(Color.DodgerBlue1),
                    RemainingStyle = new Style(Color.Grey),
                },
                new PercentageColumn(),
                new SpinnerColumn(Spinner.Known.Dots))
            .StartAsync(async ctx =>
            {
                var displayVer = overrideVersion != null ? $" v{FormatVersionRaw(overrideVersion)}" : "";
                var task = ctx.AddTask($"{verb} [bold]{Markup.Escape(tool.DisplayName)}{displayVer}[/]", maxValue: 100);

                var progress = new Progress<InstallProgress>(p =>
                {
                    task.Description = Markup.Escape(p.Status);
                    if (p.Percent >= 0)
                    {
                        task.IsIndeterminate = false;
                        task.Value = p.Percent;
                    }
                    else
                    {
                        task.IsIndeterminate = true;
                    }
                });

                var success = await _installer.InstallOrUpdate(tool, progress, overrideUrl, overrideVersion);

                task.IsIndeterminate = false;
                task.Value = 100;
                task.Description = success
                    ? $"[green]{Markup.Escape(tool.DisplayName)} installed successfully[/]"
                    : $"[red]Failed to install {Markup.Escape(tool.DisplayName)}[/]";
            });

        _github.RefreshInstalledStatus();
    }

    /// <summary>Pick a version from AllVersions. Returns (null, null) if cancelled.</summary>
    private static (Version? version, string? url) PickVersion(ToolInfo tool)
    {
        if (tool.AllVersions.Count <= 1)
            return (tool.LatestVersion, tool.LatestDownloadUrl);

        var choices = tool.AllVersions
            .Select(v =>
            {
                var label = $"v{FormatVersionRaw(v.Version)}";
                if (v.Version == tool.LatestVersion) label += " (latest)";
                if (v.PublishedAt.HasValue) label += $"  [{v.PublishedAt.Value.ToLocalTime():yyyy-MM-dd}]";
                return label;
            })
            .ToList();
        choices.Add("Cancel");

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Install which version?[/]")
                .PageSize(15)
                .HighlightStyle(new Style(Color.Green))
                .AddChoices(choices));

        if (choice == "Cancel") return (null, null);

        var idx = choices.IndexOf(choice);
        if (idx < 0 || idx >= tool.AllVersions.Count) return (null, null);

        var selected = tool.AllVersions[idx];
        return (selected.Version, selected.DownloadUrl);
    }

    private async Task<List<ToolInfo>> FetchTools()
    {
        List<ToolInfo> tools = [];

        await AnsiConsole.Status()
            .Spinner(Spinner.Known.Dots)
            .SpinnerStyle(new Style(Color.DodgerBlue1))
            .StartAsync("Fetching tools...", async _ =>
            {
                _registry.Load();
                tools = await _github.FetchToolsAsync(forceRefresh: _lastFetchTime == default);
                _lastFetchTime = DateTime.UtcNow;
            });

        if (tools.Count == 0 && _github.LastError != null)
            AnsiConsole.MarkupLine($"[yellow]{Markup.Escape(_github.LastError)}[/]");

        return tools;
    }

    private static string FormatVersion(Version? v)
    {
        if (v == null) return "[dim]—[/]";
        return $"v{(v.Build > 0 ? v.ToString(3) : v.ToString(2))}";
    }

    private static string FormatVersionRaw(Version? v)
    {
        if (v == null) return "?";
        return v.Build > 0 ? v.ToString(3) : v.ToString(2);
    }

    private static string FormatElapsed(TimeSpan elapsed)
    {
        if (elapsed.TotalMinutes < 1) return "just now";
        if (elapsed.TotalHours < 1) return $"{(int)elapsed.TotalMinutes} min ago";
        return $"{(int)elapsed.TotalHours}h ago";
    }
}
