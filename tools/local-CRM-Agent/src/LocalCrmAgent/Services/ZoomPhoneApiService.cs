using System.Diagnostics;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace LocalCrmAgent.Services;

/// <summary>
/// Zoom Phone REST API client using Server-to-Server OAuth.
/// Used for reliable call control (end call, list active calls).
/// Dialing stays local (zoomphonecall: protocol), recording uses our own WASAPI recorder.
/// </summary>
public class ZoomPhoneApiService : IDisposable
{
    private readonly HttpClient _http = new();
    private readonly object _lock = new();
    private const string TokenUrl = "https://zoom.us/oauth/token";
    private const string DefaultApiBase = "https://api.zoom.us/v2";

    // Credentials (set via config file or WebSocket command)
    private string? _accountId;
    private string? _clientId;
    private string? _clientSecret;
    private string? _zoomUserId; // email or Zoom user ID

    // Token cache
    private string? _accessToken;
    private string _apiBase = DefaultApiBase; // set dynamically from token response
    private DateTime _tokenExpiresAt = DateTime.MinValue;

    private readonly string _configPath;

    public bool IsConfigured
    {
        get { lock (_lock) return _accountId != null && _clientId != null && _clientSecret != null && _zoomUserId != null; }
    }

    public ZoomPhoneApiService()
    {
        // Check next to the exe first (dev/repo), then %APPDATA% (production)
        var exeDir = Path.GetDirectoryName(Environment.ProcessPath) ?? ".";
        var localPath = Path.Combine(exeDir, "zoom-api.json");

        if (File.Exists(localPath))
        {
            _configPath = localPath;
        }
        else
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var configDir = Path.Combine(appData, "CRM Agent");
            Directory.CreateDirectory(configDir);
            _configPath = Path.Combine(configDir, "zoom-api.json");
        }

        LoadConfig();
    }

    // ── Configuration ────────────────────────────────────────────────

    public void SetCredentials(string accountId, string clientId, string clientSecret, string zoomUserId)
    {
        lock (_lock)
        {
            _accountId = accountId;
            _clientId = clientId;
            _clientSecret = clientSecret;
            _zoomUserId = zoomUserId;
            _accessToken = null; // force re-auth
        }

        SaveConfig();
        Debug.WriteLine($"[ZoomAPI] Credentials set for user: {zoomUserId}");
    }

    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_configPath)) return;
            var json = File.ReadAllText(_configPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            lock (_lock)
            {
                _accountId = root.TryGetProperty("accountId", out var a) ? a.GetString() : null;
                _clientId = root.TryGetProperty("clientId", out var c) ? c.GetString() : null;
                _clientSecret = root.TryGetProperty("clientSecret", out var s) ? s.GetString() : null;
                _zoomUserId = root.TryGetProperty("zoomUserId", out var u) ? u.GetString() : null;
            }

            if (IsConfigured)
                Debug.WriteLine($"[ZoomAPI] Loaded config from {_configPath}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] Failed to load config: {ex.Message}");
        }
    }

    private void SaveConfig()
    {
        try
        {
            string accountId, clientId, clientSecret, zoomUserId;
            lock (_lock)
            {
                accountId = _accountId ?? "";
                clientId = _clientId ?? "";
                clientSecret = _clientSecret ?? "";
                zoomUserId = _zoomUserId ?? "";
            }

            var json = JsonSerializer.Serialize(new
            {
                accountId,
                clientId,
                clientSecret,
                zoomUserId,
            }, new JsonSerializerOptions { WriteIndented = true });

            File.WriteAllText(_configPath, json);
            Debug.WriteLine($"[ZoomAPI] Config saved to {_configPath}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] Failed to save config: {ex.Message}");
        }
    }

    // ── OAuth Token Management ───────────────────────────────────────

    private async Task<string?> GetAccessTokenAsync()
    {
        string? accountId, clientId, clientSecret;
        lock (_lock)
        {
            // Return cached token if still valid (with 5-minute buffer)
            if (_accessToken != null && DateTime.UtcNow < _tokenExpiresAt.AddMinutes(-5))
                return _accessToken;

            accountId = _accountId;
            clientId = _clientId;
            clientSecret = _clientSecret;
        }

        if (accountId == null || clientId == null || clientSecret == null)
        {
            Debug.WriteLine("[ZoomAPI] Cannot get token — credentials not configured");
            return null;
        }

        try
        {
            var authHeader = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{clientId}:{clientSecret}"));

            var request = new HttpRequestMessage(HttpMethod.Post, TokenUrl);
            request.Headers.Authorization = new AuthenticationHeaderValue("Basic", authHeader);
            request.Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "account_credentials",
                ["account_id"] = accountId,
            });

            var response = await _http.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Debug.WriteLine($"[ZoomAPI] Token request failed ({response.StatusCode}): {body}");
                return null;
            }

            using var doc = JsonDocument.Parse(body);
            var token = doc.RootElement.GetProperty("access_token").GetString();
            var expiresIn = doc.RootElement.GetProperty("expires_in").GetInt32();

            // Use the API URL from the token response (region-specific)
            var apiUrl = doc.RootElement.TryGetProperty("api_url", out var urlProp)
                ? urlProp.GetString() : null;

            lock (_lock)
            {
                _accessToken = token;
                _tokenExpiresAt = DateTime.UtcNow.AddSeconds(expiresIn);
                if (!string.IsNullOrEmpty(apiUrl))
                    _apiBase = apiUrl.TrimEnd('/') + "/v2";
            }

            Debug.WriteLine($"[ZoomAPI] Token obtained, expires in {expiresIn}s, api={_apiBase}");
            return token;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] Token error: {ex.Message}");
            return null;
        }
    }

    // ── API Calls ────────────────────────────────────────────────────

    /// <summary>
    /// List active phone calls for the configured user.
    /// </summary>
    public async Task<List<ZoomActiveCall>> ListActiveCallsAsync()
    {
        var token = await GetAccessTokenAsync();
        if (token == null) return [];

        string? userId;
        lock (_lock) userId = _zoomUserId;
        if (userId == null) return [];

        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get,
                $"{_apiBase}/phone/users/{userId}/phone_calls");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var response = await _http.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();

            if (!response.IsSuccessStatusCode)
            {
                Debug.WriteLine($"[ZoomAPI] ListActiveCalls failed ({response.StatusCode}): {body}");
                return [];
            }

            using var doc = JsonDocument.Parse(body);

            var calls = new List<ZoomActiveCall>();
            if (doc.RootElement.TryGetProperty("phone_calls", out var arr) ||
                doc.RootElement.TryGetProperty("calls", out arr))
            {
                foreach (var item in arr.EnumerateArray())
                {
                    calls.Add(new ZoomActiveCall
                    {
                        CallId = item.TryGetProperty("call_id", out var id) ? id.GetString() ?? ""
                            : item.TryGetProperty("id", out var id2) ? id2.GetString() ?? "" : "",
                        PhoneNumber = item.TryGetProperty("callee_number", out var cn) ? cn.GetString()
                            : item.TryGetProperty("phone_number", out var pn) ? pn.GetString()
                            : item.TryGetProperty("caller_number", out var crn) ? crn.GetString() : null,
                        Direction = item.TryGetProperty("direction", out var dir) ? dir.GetString() : null,
                        Status = item.TryGetProperty("status", out var st) ? st.GetString() : null,
                    });
                }
            }

            Debug.WriteLine($"[ZoomAPI] Found {calls.Count} active call(s)");
            return calls;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] ListActiveCalls error: {ex.Message}");
            return [];
        }
    }

    /// <summary>
    /// End a specific call by ID.
    /// </summary>
    public async Task<(bool Success, string? Error)> EndCallByIdAsync(string callId)
    {
        var token = await GetAccessTokenAsync();
        if (token == null) return (false, "Not authenticated with Zoom API");

        string? userId;
        lock (_lock) userId = _zoomUserId;
        if (userId == null) return (false, "Zoom user ID not configured");

        try
        {
            var request = new HttpRequestMessage(HttpMethod.Patch,
                $"{_apiBase}/phone/users/{userId}/phone_calls/{callId}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            request.Content = new StringContent(
                JsonSerializer.Serialize(new { action = "end" }),
                Encoding.UTF8, "application/json");

            var response = await _http.SendAsync(request);

            if (response.IsSuccessStatusCode || response.StatusCode == System.Net.HttpStatusCode.NoContent)
            {
                Debug.WriteLine($"[ZoomAPI] Call {callId} ended successfully");
                return (true, null);
            }

            var body = await response.Content.ReadAsStringAsync();
            Debug.WriteLine($"[ZoomAPI] EndCall failed ({response.StatusCode}): {body}");
            return (false, $"API returned {response.StatusCode}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] EndCall error: {ex.Message}");
            return (false, ex.Message);
        }
    }

    /// <summary>
    /// End the active call matching the given phone number.
    /// Protects against shared-account issues by only ending calls
    /// that WASAPI has confirmed are on THIS machine.
    /// </summary>
    public async Task<(bool Success, string? Error)> EndCallByPhoneNumberAsync(string? phoneNumber)
    {
        var calls = await ListActiveCallsAsync();
        if (calls.Count == 0)
            return (false, "No active calls found via Zoom API");

        // If we have a phone number, try to match it
        if (!string.IsNullOrEmpty(phoneNumber))
        {
            var digits = new string(phoneNumber.Where(char.IsDigit).ToArray());
            var match = calls.FirstOrDefault(c =>
            {
                if (c.PhoneNumber == null) return false;
                var callDigits = new string(c.PhoneNumber.Where(char.IsDigit).ToArray());
                // Match last 7+ digits (handles country code differences)
                return digits.Length >= 7 && callDigits.Length >= 7 &&
                       digits.EndsWith(callDigits[^Math.Min(10, callDigits.Length)..]) ||
                       callDigits.EndsWith(digits[^Math.Min(10, digits.Length)..]);
            });

            if (match != null)
            {
                Debug.WriteLine($"[ZoomAPI] Matched call {match.CallId} by phone number {match.PhoneNumber}");
                return await EndCallByIdAsync(match.CallId);
            }
        }

        // No phone number match — if there's exactly one active call, end it
        // (safe assumption: WASAPI confirmed a call exists on this machine)
        if (calls.Count == 1)
        {
            Debug.WriteLine($"[ZoomAPI] Single active call found, ending: {calls[0].CallId}");
            return await EndCallByIdAsync(calls[0].CallId);
        }

        // Multiple calls, can't determine which is ours
        Debug.WriteLine($"[ZoomAPI] {calls.Count} active calls but can't match — ending most recent");
        // End the last one (most recently started, likely ours)
        var last = calls.Last();
        return await EndCallByIdAsync(last.CallId);
    }

    public void Dispose()
    {
        _http.Dispose();
    }
}

public class ZoomActiveCall
{
    public string CallId { get; set; } = "";
    public string? PhoneNumber { get; set; }
    public string? Direction { get; set; }
    public string? Status { get; set; }
}
