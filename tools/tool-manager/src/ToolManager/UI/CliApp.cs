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

    public CliApp(
        GitHubReleaseService github,
        InstallService installer,
        InstalledToolsRegistry registry,
        UpdateScheduler scheduler,
        SelfUpdateService selfUpdater)
    {
        _github = github;
        _installer = installer;
        _registry = registry;
        _scheduler = scheduler;
        _selfUpdater = selfUpdater;
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
        var version = _selfUpdater.CurrentVersion.ToString(3);
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
            : $"v{_selfUpdater.CurrentVersion.ToString(3)}";
        var selfStatus = _selfUpdater.UpdateAvailable
            ? "[yellow]Update available[/]"
            : "[green]Up to date[/]";
        table.AddRow(
            "[dodgerblue1]Tool Manager[/]",
            selfLatest,
            $"v{_selfUpdater.CurrentVersion.ToString(3)}",
            selfStatus,
            "[dim]this app[/]");

        foreach (var tool in tools)
        {
            var latest = FormatVersion(tool.LatestVersion);
            var installed = tool.IsInstalled
                ? FormatVersion(tool.InstalledVersion)
                : "[dim]—[/]";

            string status;
            if (tool.UpdateAvailable)
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
        if (tools.Any(t => t.IsInstalled)) choices.Add("Uninstall a Tool");

        choices.Add("Configure API Token");
        choices.Add("Exit");

        return AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]What would you like to do?[/]")
                .HighlightStyle(new Style(Color.DodgerBlue1, decoration: Decoration.Bold))
                .PageSize(10)
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
                await InstallTool(tools.Where(t => !t.IsInstalled).ToList());
                break;
            case "Update a Tool":
                await UpdateTool(tools.Where(t => t.UpdateAvailable).ToList());
                break;
            case "Uninstall a Tool":
                await UninstallTool(tools.Where(t => t.IsInstalled).ToList());
                break;
            case "Configure API Token":
                ConfigureToken();
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

    private async Task InstallTool(List<ToolInfo> tools)
    {
        if (tools.Count == 0)
        {
            AnsiConsole.MarkupLine("[dim]No tools available to install.[/]");
            return;
        }

        var choice = AnsiConsole.Prompt(
            new SelectionPrompt<string>()
                .Title("[bold]Select a tool to install:[/]")
                .HighlightStyle(new Style(Color.Green))
                .AddChoices(tools.Select(t => $"{t.DisplayName} (v{FormatVersionRaw(t.LatestVersion)})"))
                .AddChoices("Cancel"));

        if (choice == "Cancel") return;

        var tool = tools.FirstOrDefault(t => choice.StartsWith(t.DisplayName));
        if (tool == null) return;
        await RunInstallWithProgress(tool, "Installing");
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

    private async Task RunInstallWithProgress(ToolInfo tool, string verb)
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
                var task = ctx.AddTask($"{verb} [bold]{Markup.Escape(tool.DisplayName)}[/]", maxValue: 100);

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

                var success = await _installer.InstallOrUpdate(tool, progress);

                task.IsIndeterminate = false;
                task.Value = 100;
                task.Description = success
                    ? $"[green]{Markup.Escape(tool.DisplayName)} installed successfully[/]"
                    : $"[red]Failed to install {Markup.Escape(tool.DisplayName)}[/]";
            });

        _github.RefreshInstalledStatus();
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
                    $"{t.DisplayName} (v{FormatVersionRaw(t.InstalledVersion)})"))
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

    // ── Helpers ──────────────────────────────────────────────

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
