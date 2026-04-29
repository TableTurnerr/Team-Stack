using System.Diagnostics;
using System.Net.Http.Json;
using System.Text.Json.Serialization;

namespace ToolManager.Services;

/// <summary>
/// GitHub OAuth Device Flow client for interactive sign-in. Returns an access
/// token that callers persist via <see cref="GitHubReleaseService.SetToken"/>.
/// No client secret required — Device Flow is for public/desktop clients.
///
/// Setup: register an OAuth App on the TableTurnerr org with Device Flow
/// enabled, then drop its Client ID into <see cref="ClientId"/> below.
/// </summary>
public class GitHubAuthService
{
    // TODO: register the TableTurnerr OAuth App with Device Flow enabled and
    // paste its Client ID here. Until this is set, sign-in is unavailable.
    public const string ClientId = "Ov23liR5mqP5m7qNkaD3";

    private const string Scope = "public_repo";
    private const string DeviceCodeEndpoint = "https://github.com/login/device/code";
    private const string TokenEndpoint = "https://github.com/login/oauth/access_token";

    public bool IsConfigured => !string.IsNullOrWhiteSpace(ClientId);

    public class DeviceCodeResponse
    {
        [JsonPropertyName("device_code")] public string DeviceCode { get; set; } = "";
        [JsonPropertyName("user_code")] public string UserCode { get; set; } = "";
        [JsonPropertyName("verification_uri")] public string VerificationUri { get; set; } = "";
        [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
        [JsonPropertyName("interval")] public int Interval { get; set; }
    }

    private class TokenResponse
    {
        [JsonPropertyName("access_token")] public string? AccessToken { get; set; }
        [JsonPropertyName("error")] public string? Error { get; set; }
        [JsonPropertyName("error_description")] public string? ErrorDescription { get; set; }
        [JsonPropertyName("interval")] public int? Interval { get; set; }
    }

    public async Task<DeviceCodeResponse> RequestDeviceCodeAsync(CancellationToken ct = default)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("GitHub OAuth Client ID is not configured.");

        using var http = new HttpClient();
        http.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));

        var form = new FormUrlEncodedContent(new[]
        {
            new KeyValuePair<string, string>("client_id", ClientId),
            new KeyValuePair<string, string>("scope", Scope),
        });

        using var resp = await http.PostAsync(DeviceCodeEndpoint, form, ct);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<DeviceCodeResponse>(cancellationToken: ct)
                   ?? throw new InvalidOperationException("Empty device code response");
        if (string.IsNullOrEmpty(body.DeviceCode))
            throw new InvalidOperationException("GitHub returned an empty device code.");
        return body;
    }

    /// <summary>
    /// Polls GitHub until the user authorizes the device or the request expires.
    /// Returns the access token on success. Throws on denial/expiry/cancel.
    /// </summary>
    public async Task<string> PollForTokenAsync(DeviceCodeResponse code, CancellationToken ct = default)
    {
        if (!IsConfigured)
            throw new InvalidOperationException("GitHub OAuth Client ID is not configured.");

        using var http = new HttpClient();
        http.DefaultRequestHeaders.Accept.Add(new System.Net.Http.Headers.MediaTypeWithQualityHeaderValue("application/json"));

        var deadline = DateTime.UtcNow.AddSeconds(code.ExpiresIn > 0 ? code.ExpiresIn : 600);
        // GitHub minimum is 5s; honor server-suggested interval and slow_down bumps.
        var interval = TimeSpan.FromSeconds(Math.Max(5, code.Interval > 0 ? code.Interval : 5));

        while (DateTime.UtcNow < deadline)
        {
            await Task.Delay(interval, ct);

            var form = new FormUrlEncodedContent(new[]
            {
                new KeyValuePair<string, string>("client_id", ClientId),
                new KeyValuePair<string, string>("device_code", code.DeviceCode),
                new KeyValuePair<string, string>("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            });

            TokenResponse? body;
            try
            {
                using var resp = await http.PostAsync(TokenEndpoint, form, ct);
                body = await resp.Content.ReadFromJsonAsync<TokenResponse>(cancellationToken: ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                FileLogger.Write($"[GitHubAuth] Transient poll error: {ex.Message}");
                continue;
            }

            if (body == null) continue;

            if (!string.IsNullOrEmpty(body.AccessToken))
                return body.AccessToken!;

            switch (body.Error)
            {
                case "authorization_pending":
                    continue;
                case "slow_down":
                    var bump = body.Interval ?? 5;
                    interval = TimeSpan.FromSeconds(Math.Max(interval.TotalSeconds + 5, bump));
                    continue;
                case "expired_token":
                    throw new TimeoutException("Device code expired before authorization. Please try again.");
                case "access_denied":
                    throw new OperationCanceledException("Authorization was denied on GitHub.");
                default:
                    throw new InvalidOperationException(
                        $"GitHub auth error: {body.Error ?? "unknown"} — {body.ErrorDescription ?? "no description"}");
            }
        }

        throw new TimeoutException("Device code expired before authorization.");
    }

    /// <summary>Open the verification URL in the user's default browser.</summary>
    public static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true,
            });
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[GitHubAuth] Failed to open browser to {url}: {ex.Message}");
        }
    }
}
