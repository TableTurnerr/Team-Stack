using System.Diagnostics;
using System.Text.Json;
using System.Text.RegularExpressions;
using ToolManager.Models;

namespace ToolManager.Services;

/// <summary>
/// Detects a Local CRM Agent that is installed but never provisioned with the
/// rep's personal settings (the values a Setup-CRM-Agent-&lt;RepName&gt;.bat from
/// make-rep-installer.ps1 carries), and applies such a .bat when the rep picks
/// it from the setup popup. "Provisioned" hinges on the per-rep repUserId (the
/// rep's GHL user id): the shared token can be baked into the release binary,
/// but the rep key can only come from per-machine setup.
/// </summary>
public class AgentProvisioningService
{
    /// <summary>Env vars a rep setup .bat may set (mirrors make-rep-installer.ps1).</summary>
    private static readonly string[] KnownVars =
    [
        "CRM_AGENT_TOKEN", "CRM_AGENT_REP_KEY", "CRM_AGENT_WORKER_URL", "CRM_AGENT_FALLBACK_URL",
    ];

    // Matches the lines make-rep-installer.ps1 emits: setx CRM_AGENT_TOKEN "value" >nul
    private static readonly Regex SetxLine = new(
        "^\\s*setx\\s+(CRM_AGENT_[A-Za-z_]+)\\s+\"([^\"]*)\"",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private readonly InstalledToolsRegistry _registry;

    public AgentProvisioningService(InstalledToolsRegistry registry)
    {
        _registry = registry;
    }

    /// <summary>The agent's own config file (see LocalCrmAgent AgentConfig.ConfigPath).</summary>
    private static string AgentConfigPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "CrmAgent", "agent-config.json");

    /// <summary>
    /// True when the CRM Agent is installed on this machine but has no rep key
    /// anywhere the agent would find one (persisted config or user env vars).
    /// </summary>
    public bool NeedsRepSetup()
    {
        if (FindAgentExe() == null) return false; // not installed — nothing to set up

        if (!string.IsNullOrEmpty(ReadConfiguredRepKey())) return false;

        // Read at User/Machine scope (the registry), not from this process's
        // stale environment snapshot — setx / a setup .bat won't update the
        // latter. Machine scope covers the runbook's admin-provisioned variant.
        foreach (var scope in new[] { EnvironmentVariableTarget.User, EnvironmentVariableTarget.Machine })
        {
            if (!string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CRM_AGENT_REP_KEY", scope))
                || !string.IsNullOrEmpty(Environment.GetEnvironmentVariable("CRM_AGENT_REP_USER_ID", scope)))
                return false;
        }

        return true;
    }

    /// <summary>The repUserId persisted in agent-config.json, if any.</summary>
    private static string? ReadConfiguredRepKey()
    {
        try
        {
            if (!File.Exists(AgentConfigPath)) return null;
            using var doc = JsonDocument.Parse(File.ReadAllText(AgentConfigPath));
            return doc.RootElement.TryGetProperty("repUserId", out var v) ? v.GetString() : null;
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[AgentSetup] Could not read agent-config.json: {ex.Message}");
            return null;
        }
    }

    /// <summary>
    /// Locate the installed LocalCrmAgent.exe: registry install path first,
    /// then the known managed/legacy locations.
    /// </summary>
    public string? FindAgentExe()
    {
        var tool = _registry.GetByTagPrefix("local-agent");
        if (tool != null)
        {
            var exe = Path.Combine(tool.InstallPath, tool.Manifest?.Executable ?? "LocalCrmAgent.exe");
            if (File.Exists(exe)) return exe;
        }

        var appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        foreach (var candidate in new[]
        {
            Path.Combine(InstalledToolsRegistry.ToolsDir, "local-crm-agent", "LocalCrmAgent.exe"),
            Path.Combine(appData, "TableTurnerr", "LocalCrmAgent", "LocalCrmAgent.exe"),
        })
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    /// <summary>
    /// Extract the CRM_AGENT_* values from a rep setup .bat. Returns an empty
    /// dictionary if the file has no recognizable setx lines.
    /// </summary>
    public static Dictionary<string, string> ParseSetupBat(string batPath)
    {
        var vars = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in File.ReadLines(batPath))
        {
            var m = SetxLine.Match(line);
            if (!m.Success) continue;
            var name = m.Groups[1].Value.ToUpperInvariant();
            if (KnownVars.Contains(name) && m.Groups[2].Value.Length > 0)
                vars[name] = m.Groups[2].Value;
        }
        return vars;
    }

    /// <summary>
    /// Apply parsed setup values: stop the agent, persist the vars as user-level
    /// env vars (what the .bat's setx would have done), patch the rep key into
    /// agent-config.json if one exists, and relaunch the agent so it picks the
    /// values up immediately and persists them itself (token DPAPI-encrypted).
    /// </summary>
    public void Apply(Dictionary<string, string> vars)
    {
        // 1. Stop the running (unprovisioned) agent so it can't overwrite the
        //    config we're about to patch.
        foreach (var proc in Process.GetProcessesByName("LocalCrmAgent"))
        {
            using (proc)
            {
                try { proc.Kill(); proc.WaitForExit(5000); } catch { }
            }
        }

        // 2. User-level env vars — same effect as the .bat's setx lines, so a
        //    manual agent relaunch later also finds them.
        foreach (var kv in vars)
            Environment.SetEnvironmentVariable(kv.Key, kv.Value, EnvironmentVariableTarget.User);

        // 3. If a config file already exists, patch the plaintext fields and
        //    clear the protected token so the agent re-reads CRM_AGENT_TOKEN
        //    from the environment and re-encrypts it on next launch. (Persisted
        //    config wins over env in the agent, so stale fields must not linger.)
        PatchAgentConfig(vars);

        // 4. Relaunch. Env vars are injected into the child directly because a
        //    child process inherits OUR (stale) environment, not the user-level
        //    values written in step 2.
        var exe = FindAgentExe();
        if (exe == null)
        {
            FileLogger.Write("[AgentSetup] Agent exe not found for relaunch — vars saved, agent will pick them up on next start");
            return;
        }

        try
        {
            var psi = new ProcessStartInfo { FileName = exe, UseShellExecute = false };
            var args = _registry.GetByTagPrefix("local-agent")?.Manifest?.RegistryAutoStart?.Args;
            if (!string.IsNullOrEmpty(args)) psi.Arguments = args;
            foreach (var kv in vars)
                psi.Environment[kv.Key] = kv.Value;
            using var _ = Process.Start(psi);
            FileLogger.Write("[AgentSetup] Agent relaunched with provisioned settings");
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[AgentSetup] Agent relaunch failed: {ex.Message}");
        }
    }

    private static void PatchAgentConfig(Dictionary<string, string> vars)
    {
        try
        {
            if (!File.Exists(AgentConfigPath)) return;

            using var doc = JsonDocument.Parse(File.ReadAllText(AgentConfigPath));
            var fields = new Dictionary<string, object?>();
            foreach (var prop in doc.RootElement.EnumerateObject())
                fields[prop.Name] = prop.Value.Clone();

            if (vars.TryGetValue("CRM_AGENT_REP_KEY", out var repKey))
                fields["repUserId"] = repKey;
            if (vars.TryGetValue("CRM_AGENT_WORKER_URL", out var worker))
                fields["workerBaseUrl"] = worker;
            if (vars.TryGetValue("CRM_AGENT_FALLBACK_URL", out var fallback))
                fields["fallbackWorkerBaseUrl"] = fallback;
            // Never write the raw token here — it must be DPAPI-encrypted by the
            // agent itself. Clearing the field forces the agent to fall back to
            // the CRM_AGENT_TOKEN env var and persist it encrypted.
            if (vars.ContainsKey("CRM_AGENT_TOKEN"))
                fields["agentTokenProtected"] = null;

            var json = JsonSerializer.Serialize(fields, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(AgentConfigPath, json);
            FileLogger.Write("[AgentSetup] Patched agent-config.json with rep settings");
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[AgentSetup] Could not patch agent-config.json: {ex.Message}");
        }
    }
}
