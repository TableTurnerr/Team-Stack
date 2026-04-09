namespace ToolManager.Models;

/// <summary>
/// Parses version strings that may contain a pre-release suffix (e.g. "1.0.9-dev.20260323.1").
/// System.Version only supports numeric parts, so we strip the suffix for comparisons
/// but preserve the full string for display.
/// </summary>
public static class VersionHelper
{
    /// <summary>
    /// Try to parse a version string, stripping any "-dev.*" or other pre-release suffix
    /// so that System.Version can handle it.
    /// </summary>
    public static bool TryParse(string? input, out Version? version, out bool isDev)
    {
        version = null;
        isDev = false;

        if (string.IsNullOrWhiteSpace(input))
            return false;

        var raw = input.Trim();
        var dashIndex = raw.IndexOf('-');
        if (dashIndex >= 0)
        {
            isDev = raw[dashIndex..].StartsWith("-dev", StringComparison.OrdinalIgnoreCase);
            raw = raw[..dashIndex];
        }

        return Version.TryParse(raw, out version);
    }

    /// <summary>
    /// Check if a version string contains a dev/pre-release suffix.
    /// </summary>
    public static bool IsDevVersion(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return false;
        return input.Contains("-dev.", StringComparison.OrdinalIgnoreCase);
    }
}
