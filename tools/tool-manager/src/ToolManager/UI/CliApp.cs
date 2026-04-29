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
        bool firstIteration = true;

        while (true)
        {
            try
            {
                AnsiConsole.Clear();
                RenderHeader();

                if (!firstIteration)
                    tools = await FetchTools();
                firstIteration = false;
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
            ? $"[green]\u25cf Authenticated[/] [grey50]({_github.RateLimitRemaining} requests left)[/]"
            : "[yellow]\u25cb Unauthenticated[/] [grey50](60 req/hr)[/]";

        var lastCheck = _lastFetchTime == default
            ? "[grey50]never[/]"
            : $"[grey70]{FormatElapsed(DateTime.UtcNow - _lastFetchTime)}[/]";

        var buildTag = _selfUpdater.IsDevBuild
            ? "  [cyan](dev build)[/]"
            : "";

        var grid = new Grid()
            .AddColumn(new GridColumn().NoWrap())
            .AddColumn(new GridColumn().NoWrap().RightAligned())
            .AddRow(
                $"  [bold]API[/]    {authTag}",
                $"[grey50]Last check[/]  {lastCheck}  ");

        var panel = new Panel(grid)
            .Header($"  [bold dodgerblue1] TableTurnerr Tool Manager [/][grey50]v{Markup.Escape(version)}[/]{buildTag}  ")
            .Border(BoxBorder.Rounded)
            .BorderColor(Color.DodgerBlue1)
            .Padding(0, 0, 0, 0)
            .Expand();

        AnsiConsole.Write(panel);
        AnsiConsole.WriteLine();
    }

    // ── Tool table ──────────────────────────────────────────

    private void RenderToolTable(List<ToolInfo> tools)
    {
        var table = new Table()
            .Border(TableBorder.Rounded)
            .BorderColor(Color.Grey30)
            .AddColumn(new TableColumn("[bold] [/]").NoWrap())
            .AddColumn(new TableColumn("[bold]Tool[/]").NoWrap())
            .AddColumn(new TableColumn("[bold]Latest[/]").Centered())
            .AddColumn(new TableColumn("[bold]Installed[/]").Centered())
            .AddColumn(new TableColumn("[bold]Status[/]"))
            .AddColumn(new TableColumn("[bold]Type[/]"));

        // Manager self-entry — always at the top with a visually distinct icon
        var selfLatest = _selfUpdater.UpdateAvailable
            ? $"[yellow]v{_selfUpdater.LatestVersion!.ToString(3)}[/]"
            : $"v{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}";
        var selfInstalled = _selfUpdater.IsDevBuild
            ? $"[cyan]v{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}[/]"
            : $"v{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}";
        var (selfIcon, selfStatus) = StatusFor(
            isInstalled: true,
            isDev: _selfUpdater.IsDevBuild,
            updateAvailable: _selfUpdater.UpdateAvailable);
        table.AddRow(
            selfIcon,
            "[dodgerblue1 bold]Tool Manager[/]",
            selfLatest,
            selfInstalled,
            selfStatus,
            "[grey50]this app[/]");

        // Sort: updates available first, then installed up-to-date, then not installed.
        // Within each group, sort by display name.
        var sorted = tools
            .OrderBy(t => t.UpdateAvailable ? 0 : t.IsInstalled ? 1 : 2)
            .ThenBy(t => t.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToList();

        foreach (var tool in sorted)
        {
            var latest = tool.UpdateAvailable
                ? $"[yellow]{FormatVersion(tool.LatestVersion)}[/]"
                : FormatVersion(tool.LatestVersion);
            var installed = tool.IsInstalled
                ? (tool.IsDevBuild
                    ? $"[cyan]v{Markup.Escape(tool.InstalledVersionRaw ?? "")}[/]"
                    : FormatVersion(tool.InstalledVersion))
                : "[grey50]\u2014[/]";

            var (icon, status) = StatusFor(tool.IsInstalled, tool.IsDevBuild, tool.UpdateAvailable);

            var type = FormatToolType(tool.ToolType);

            table.AddRow(
                icon,
                $"[bold]{Markup.Escape(tool.DisplayName)}[/]",
                latest,
                installed,
                status,
                type);
        }

        AnsiConsole.Write(table);
    }

    /// <summary>
    /// Returns the leading status glyph + the status cell text.
    /// Glyphs are filled (\u25cf) for installed, half (\u25d0) for update-available, hollow (\u25cb) for not installed.
    /// </summary>
    private static (string icon, string status) StatusFor(bool isInstalled, bool isDev, bool updateAvailable)
    {
        if (isDev) return ("[cyan]\u25c6[/]", "[cyan]Dev build[/]");
        if (updateAvailable) return ("[yellow]\u25d0[/]", "[yellow]Update available[/]");
        if (isInstalled) return ("[green]\u25cf[/]", "[green]Up to date[/]");
        return ("[grey42]\u25cb[/]", "[grey50]Not installed[/]");
    }

    private static string FormatToolType(string type) => type switch
    {
        "windows-app" => "[plum2]Windows App[/]",
        "chrome-extension" => "[lightseagreen]Chrome Ext[/]",
        "unknown" => "[grey50]\u2014[/]",
        _ => Markup.Escape(type),
    };

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

        return NumberedMenu.Show("[bold]What would you like to do?[/]", choices, Color.DodgerBlue1);
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

        if (!Confirm("Apply updates now?", defaultValue: true))
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
            AnsiConsole.MarkupLine("[grey50]No tools available to install.[/]");
            return;
        }

        var installChoices = installable
            .Select(t => $"[bold]{Markup.Escape(t.DisplayName)}[/] [grey50]v{FormatVersionRaw(t.LatestVersion)}[/]")
            .ToList();
        installChoices.Add("Cancel");
        var choice = NumberedMenu.Show("[bold]Select a tool to install:[/]", installChoices, Color.Green);

        if (choice == "Cancel") return;

        var idx = installChoices.IndexOf(choice);
        if (idx < 0 || idx >= installable.Count) return;
        var tool = installable[idx];

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
            AnsiConsole.MarkupLine("[grey50]All tools are up to date.[/]");
            return;
        }

        var choices = new List<string>();

        if (hasSelfUpdate)
            choices.Add(
                $"[dodgerblue1 bold]Tool Manager[/] [grey50]v{_selfUpdater.CurrentVersion.ToString(3)}[/] [grey42]\u2192[/] [yellow]v{_selfUpdater.LatestVersion!.ToString(3)}[/]");

        choices.AddRange(tools.Select(t =>
            $"[bold]{Markup.Escape(t.DisplayName)}[/] [grey50]v{FormatVersionRaw(t.InstalledVersion)}[/] [grey42]\u2192[/] [yellow]v{FormatVersionRaw(t.LatestVersion)}[/]"));

        choices.Add("Cancel");

        var choice = NumberedMenu.Show("[bold]Select a tool to update:[/]", choices, Color.Yellow);

        if (choice == "Cancel") return;

        var idx = choices.IndexOf(choice);
        if (idx < 0) return;

        if (hasSelfUpdate && idx == 0)
        {
            AnsiConsole.MarkupLine("[yellow]Applying Tool Manager update \u2014 the app will restart...[/]");
            await _selfUpdater.ApplyUpdate();
            return;
        }

        var toolIdx = hasSelfUpdate ? idx - 1 : idx;
        if (toolIdx < 0 || toolIdx >= tools.Count) return;
        await RunInstallWithProgress(tools[toolIdx], "Updating");
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
            AnsiConsole.MarkupLine("[grey50]No tools installed to uninstall.[/]");
            return;
        }

        var uninstallChoices = tools
            .Select(t => $"[bold]{Markup.Escape(t.DisplayName)}[/] [grey50]v{Markup.Escape(t.InstalledVersionRaw ?? FormatVersionRaw(t.InstalledVersion))}[/]")
            .ToList();
        uninstallChoices.Add("Cancel");
        var choice = NumberedMenu.Show("[bold]Select a tool to uninstall:[/]", uninstallChoices, Color.Red);

        if (choice == "Cancel") return;

        var idx = uninstallChoices.IndexOf(choice);
        if (idx < 0 || idx >= tools.Count) return;
        var tool = tools[idx];

        if (!Confirm($"Uninstall {tool.DisplayName}?", defaultValue: false))
            return;

        await AnsiConsole.Status()
            .Spinner(Spinner.Known.Dots)
            .SpinnerStyle(new Style(Color.Red))
            .StartAsync($"Uninstalling {tool.DisplayName}...", async _ =>
            {
                await _installer.Uninstall(tool.TagPrefix);
            });

        _github.RefreshInstalledStatus();
        AnsiConsole.MarkupLine($"[green]\u2713 {Markup.Escape(tool.DisplayName)} uninstalled.[/]");
    }

    // ── Switch to Release ───────────────────────────────────

    private async Task SwitchToRelease(List<ToolInfo> devTools)
    {
        var selfIsDev = _selfUpdater.IsDevBuild;

        if (devTools.Count == 0 && !selfIsDev)
        {
            AnsiConsole.MarkupLine("[grey50]No dev builds found.[/]");
            return;
        }

        var choices = new List<string>();

        if (selfIsDev)
        {
            var (latestSelfVer, _) = _github.GetCachedSelfUpdate();
            var latestLabel = latestSelfVer != null
                ? $"v{latestSelfVer.ToString(3)}"
                : "latest release";
            choices.Add(
                $"[dodgerblue1 bold]Tool Manager[/] [cyan]{Markup.Escape(_selfUpdater.CurrentVersionDisplay)}[/] [grey42]\u2192[/] [green]{latestLabel}[/]");
        }

        choices.AddRange(devTools.Select(t =>
            $"[bold]{Markup.Escape(t.DisplayName)}[/] [cyan]{Markup.Escape(t.InstalledVersionRaw ?? "")}[/] [grey42]\u2192[/] [green]v{FormatVersionRaw(t.LatestVersion)}[/]"));

        choices.Add("Cancel");

        var choice = NumberedMenu.Show("[bold]Switch which tool from dev build to release?[/]", choices, Color.Cyan1);

        if (choice == "Cancel") return;

        var idx = choices.IndexOf(choice);
        if (idx < 0) return;

        if (selfIsDev && idx == 0)
        {
            AnsiConsole.MarkupLine("[yellow]Fetching latest release...[/]");
            var (ver, url) = await _github.GetLatestSelfRelease();

            if (ver == null || url == null)
            {
                AnsiConsole.MarkupLine("[red]Could not find a release version to switch to.[/]");
                return;
            }

            if (!Confirm($"Replace dev build {_selfUpdater.CurrentVersionDisplay} with release v{ver.ToString(3)}?", defaultValue: true))
                return;

            AnsiConsole.MarkupLine("[yellow]Switching to release \u2014 the app will restart...[/]");
            await _selfUpdater.ApplySpecificVersion(ver, url);
            return;
        }

        var toolIdx = selfIsDev ? idx - 1 : idx;
        if (toolIdx < 0 || toolIdx >= devTools.Count) return;
        var tool = devTools[toolIdx];

        if (!Confirm($"Replace dev build {tool.InstalledVersionRaw ?? ""} with release v{FormatVersionRaw(tool.LatestVersion)}?", defaultValue: true))
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

        var manageChoices = installed
            .Select(t => $"[bold]{Markup.Escape(t.DisplayName)}[/] [grey50]v{Markup.Escape(t.InstalledVersionRaw ?? FormatVersionRaw(t.InstalledVersion))}[/]")
            .ToList();
        manageChoices.Add("Cancel");
        var choice = NumberedMenu.Show("[bold]Select a tool to manage:[/]", manageChoices, Color.DodgerBlue1);

        if (choice == "Cancel") return;

        var idx = manageChoices.IndexOf(choice);
        if (idx < 0 || idx >= installed.Count) return;
        await ManageToolSubmenu(installed[idx]);
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

        var action = NumberedMenu.Show($"[bold]Managing: {Markup.Escape(tool.DisplayName)}[/]", actions, Color.DodgerBlue1);

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

        var choice = NumberedMenu.Show("[bold]View release notes for which version?[/]", choices);

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
            ? $"Replace v{tool.InstalledVersionRaw ?? FormatVersionRaw(tool.InstalledVersion)} with v{FormatVersionRaw(selectedVersion)}?"
            : $"Install v{FormatVersionRaw(selectedVersion)}?";

        if (!Confirm(confirmMsg, defaultValue: true))
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

        if (!Confirm($"Re-install {tool.DisplayName} v{FormatVersionRaw(target.Version)}?", defaultValue: true))
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
        var action = NumberedMenu.Show("[bold]Cache action:[/]", actions);

        switch (action)
        {
            case "Delete a Version":
                var versions = cached.Select(c => $"v{FormatVersionRaw(c.version)} ({c.sizeBytes / (1024.0 * 1024.0):F1} MB)").ToList();
                versions.Add("Cancel");

                var pick = NumberedMenu.Show("[bold]Delete which cached version?[/]", versions);

                if (pick == "Cancel") return;

                var idx = versions.IndexOf(pick);
                if (idx >= 0 && idx < cached.Count)
                {
                    InstallService.DeleteCachedVersion(tool.TagPrefix, cached[idx].version);
                    AnsiConsole.MarkupLine($"[green]Deleted cached v{FormatVersionRaw(cached[idx].version)}[/]");
                }
                break;

            case "Clear All":
                if (Confirm($"Delete all {cached.Count} cached version(s)?", defaultValue: false))
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

            var settingsChoices = new List<string>
            {
                startupLabel,
                autoUpdateLabel,
                "Configure API Token",
                cacheLabel,
                "Back",
            };
            var action = NumberedMenu.Show("[bold]Settings[/]", settingsChoices, Color.DodgerBlue1);

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
                else if (Confirm($"Delete all cached downloads ({cacheSizeMb:F1} MB)?", defaultValue: false))
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
        var auth = new GitHubAuthService();

        var actions = new List<string>();
        if (existing != null)
        {
            var masked = existing.Length > 4
                ? existing[..4] + new string('*', Math.Min(existing.Length - 4, 30))
                : new string('*', existing.Length);
            AnsiConsole.MarkupLine($"  Saved token: [dim]{Markup.Escape(masked)}[/]");
            AnsiConsole.WriteLine();
            if (auth.IsConfigured) actions.Add("Sign in with GitHub");
            actions.AddRange(["Paste Token", "Remove Token", "Cancel"]);
        }
        else
        {
            if (auth.IsConfigured) actions.Add("Sign in with GitHub");
            actions.AddRange(["Paste Token", "Cancel"]);
        }

        var action = NumberedMenu.Show("[bold]Token action:[/]", actions);

        switch (action)
        {
            case "Sign in with GitHub":
                SignInWithGitHub(auth).GetAwaiter().GetResult();
                break;

            case "Paste Token":
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

    private async Task SignInWithGitHub(GitHubAuthService auth)
    {
        AnsiConsole.WriteLine();

        GitHubAuthService.DeviceCodeResponse code;
        try
        {
            code = await auth.RequestDeviceCodeAsync();
        }
        catch (Exception ex)
        {
            AnsiConsole.MarkupLine($"[red]Could not start GitHub sign-in: {Markup.Escape(ex.Message)}[/]");
            return;
        }

        AnsiConsole.MarkupLine($"  1. Open: [link]{code.VerificationUri}[/]");
        AnsiConsole.MarkupLine($"  2. Enter code: [bold yellow]{code.UserCode}[/]");
        AnsiConsole.WriteLine();
        AnsiConsole.MarkupLine("[dim]Opening browser...[/]");
        GitHubAuthService.OpenBrowser(code.VerificationUri);

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) => { e.Cancel = true; cts.Cancel(); };

        try
        {
            var token = await AnsiConsole.Status()
                .Spinner(Spinner.Known.Dots)
                .StartAsync("Waiting for GitHub authorization (Ctrl+C to cancel)...",
                    async _ => await auth.PollForTokenAsync(code, cts.Token));

            _github.SetToken(token);
            AnsiConsole.MarkupLine("[green]Signed in. Token saved.[/]");
        }
        catch (OperationCanceledException)
        {
            AnsiConsole.MarkupLine("[yellow]Sign-in cancelled.[/]");
        }
        catch (Exception ex)
        {
            AnsiConsole.MarkupLine($"[red]Sign-in failed: {Markup.Escape(ex.Message)}[/]");
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
                    RemainingStyle = new Style(Color.Grey30),
                    FinishedStyle = new Style(Color.Green),
                },
                new PercentageColumn(),
                new DownloadedColumn(),
                new TransferSpeedColumn(),
                new RemainingTimeColumn(),
                new SpinnerColumn(Spinner.Known.Dots))
            .StartAsync(async ctx =>
            {
                var displayVer = overrideVersion != null
                    ? $" [grey50]v{FormatVersionRaw(overrideVersion)}[/]"
                    : "";
                var task = ctx.AddTask(
                    $"{verb} [bold]{Markup.Escape(tool.DisplayName)}[/]{displayVer}",
                    maxValue: 100);

                bool inDownload = false;
                long lastBytes = 0;

                var progress = new Progress<InstallProgress>(p =>
                {
                    if (p.BytesDownloaded.HasValue && p.TotalBytes is > 0)
                    {
                        // Switch to byte-mode the first time we see a known total — this lets
                        // the speed/ETA columns compute meaningful values from increments.
                        if (!inDownload)
                        {
                            task.MaxValue = p.TotalBytes.Value;
                            task.Value = 0;
                            inDownload = true;
                            lastBytes = 0;
                        }
                        var delta = p.BytesDownloaded.Value - lastBytes;
                        if (delta > 0) task.Increment(delta);
                        lastBytes = p.BytesDownloaded.Value;
                        task.Description =
                            $"[dodgerblue1]\u2193[/] Downloading [bold]{Markup.Escape(tool.DisplayName)}[/]{displayVer}";
                        task.IsIndeterminate = false;
                    }
                    else
                    {
                        // Non-download phase: switch back to percent-based progress.
                        if (inDownload)
                        {
                            task.MaxValue = 100;
                            task.Value = 0;
                            inDownload = false;
                            lastBytes = 0;
                        }
                        task.Description =
                            $"[dodgerblue1]\u25b8[/] {Markup.Escape(p.Status)} [bold]{Markup.Escape(tool.DisplayName)}[/]{displayVer}";
                        if (p.Percent >= 0)
                        {
                            task.IsIndeterminate = false;
                            task.Value = p.Percent;
                        }
                        else
                        {
                            task.IsIndeterminate = true;
                        }
                    }
                });

                var success = await _installer.InstallOrUpdate(tool, progress, overrideUrl, overrideVersion);

                task.IsIndeterminate = false;
                task.MaxValue = 100;
                task.Value = 100;
                task.Description = success
                    ? $"[green]\u2713 {Markup.Escape(tool.DisplayName)}{(overrideVersion != null ? $" v{FormatVersionRaw(overrideVersion)}" : "")} ready[/]"
                    : $"[red]\u2717 Failed to install {Markup.Escape(tool.DisplayName)}[/]";
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
                if (v.PublishedAt.HasValue) label += $"  [grey50]({v.PublishedAt.Value.ToLocalTime():yyyy-MM-dd})[/]";
                return label;
            })
            .ToList();
        choices.Add("Cancel");

        var choice = NumberedMenu.Show("[bold]Install which version?[/]", choices, Color.Green);

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

    private static bool Confirm(string prompt, bool defaultValue = true)
    {
        var hint = defaultValue ? "[[Y/n]]" : "[[y/N]]";
        AnsiConsole.Markup($"{prompt} {hint} ");

        while (true)
        {
            var key = Console.ReadKey(intercept: true);
            if (key.Key == ConsoleKey.Y)
            {
                AnsiConsole.MarkupLine("[green]y[/]");
                return true;
            }
            if (key.Key == ConsoleKey.N)
            {
                AnsiConsole.MarkupLine("[red]n[/]");
                return false;
            }
            if (key.Key == ConsoleKey.Enter)
            {
                AnsiConsole.MarkupLine(defaultValue ? "[green]y[/]" : "[red]n[/]");
                return defaultValue;
            }
        }
    }
}
