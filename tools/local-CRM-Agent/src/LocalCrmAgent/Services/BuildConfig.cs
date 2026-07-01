using System.Reflection;

namespace LocalCrmAgent.Services;

/// <summary>
/// Values baked into the binary at build time via MSBuild properties
/// (<c>/p:AgentDefaultToken=…</c>), surfaced as <see cref="AssemblyMetadataAttribute"/>.
/// The release CI reads the value from a GitHub Actions secret, so the shared
/// agent token ships embedded and reps never enter it — while the source tree and
/// dev builds stay empty (no secret committed). A persisted config value or the
/// CRM_AGENT_TOKEN env var still override the baked default.
/// </summary>
internal static class BuildConfig
{
    /// <summary>The build-time shared agent token, or null if not baked in (dev builds).</summary>
    public static string? EmbeddedAgentToken => Get("AgentDefaultToken");

    /// <summary>Optional build-time worker base URL override, or null if not baked in.</summary>
    public static string? EmbeddedWorkerUrl => Get("AgentDefaultWorkerUrl");

    private static string? Get(string key)
    {
        var value = Assembly.GetExecutingAssembly()
            .GetCustomAttributes<AssemblyMetadataAttribute>()
            .FirstOrDefault(a => a.Key == key)?.Value?.Trim();
        return string.IsNullOrEmpty(value) ? null : value;
    }
}
