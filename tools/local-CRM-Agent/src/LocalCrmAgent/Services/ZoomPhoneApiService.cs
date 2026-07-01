using System.Diagnostics;
using System.Globalization;
using System.Net.Http.Headers;
using System.Net.NetworkInformation;
using System.Net.Sockets;
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
    private string? _ownPublicIp; // cached for the session; used to match web calls

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

    /// <summary>
    /// Self-provision the shared Zoom S2S creds from the bridge worker
    /// (GET {workerBaseUrl}/agent/bootstrap, Bearer agent token). The worker is
    /// the single source of truth for the Zoom secret, so the agent never needs
    /// it shipped in the installer or entered by the user — only the agent token.
    /// No-op if already configured. Best-effort: returns false on any failure so
    /// the caller can retry on the next launch.
    /// </summary>
    public async Task<bool> TryBootstrapFromWorkerAsync(string workerBaseUrl, string agentToken)
    {
        if (IsConfigured) return true;
        if (string.IsNullOrWhiteSpace(workerBaseUrl) || string.IsNullOrWhiteSpace(agentToken))
            return false;

        var url = $"{workerBaseUrl.TrimEnd('/')}/agent/bootstrap";
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", agentToken);
            using var resp = await _http.SendAsync(req);
            if (!resp.IsSuccessStatusCode)
            {
                FileLogger.Write($"[ZoomAPI] Bootstrap from worker failed: HTTP {(int)resp.StatusCode} — Zoom number resolution disabled");
                return false;
            }

            var json = await resp.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("zoom", out var z))
            {
                FileLogger.Write("[ZoomAPI] Bootstrap response missing 'zoom' object");
                return false;
            }

            var accountId = z.TryGetProperty("accountId", out var a) ? a.GetString() : null;
            var clientId = z.TryGetProperty("clientId", out var c) ? c.GetString() : null;
            var clientSecret = z.TryGetProperty("clientSecret", out var s) ? s.GetString() : null;
            var zoomUserId = z.TryGetProperty("zoomUserId", out var u) ? u.GetString() : null;
            if (string.IsNullOrEmpty(accountId) || string.IsNullOrEmpty(clientId)
                || string.IsNullOrEmpty(clientSecret) || string.IsNullOrEmpty(zoomUserId))
            {
                FileLogger.Write("[ZoomAPI] Bootstrap response had incomplete Zoom creds");
                return false;
            }

            SetCredentials(accountId, clientId, clientSecret, zoomUserId);
            FileLogger.Write("[ZoomAPI] Provisioned Zoom S2S creds from worker — call number resolution enabled");
            return true;
        }
        catch (Exception ex)
        {
            FileLogger.Write($"[ZoomAPI] Bootstrap from worker error: {ex.GetType().Name}: {ex.Message}");
            return false;
        }
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

    // ── Recording correlation: resolve THIS machine's call ───────────────

    /// <summary>
    /// Resolve the real Zoom call_id and the external party's E.164 number for a
    /// call recorded on THIS machine, by matching Zoom's call_history against the
    /// recording's start time plus a device fingerprint.
    ///
    /// <para>Desktop calls report <c>device_private_ip</c>, which on the shared
    /// Zoom account is a distinct per-machine fingerprint (an exact match).</para>
    ///
    /// <para>Web-phone (Chrome) calls do <b>not</b> report <c>device_private_ip</c>
    /// at all — only <c>device_public_ip</c>. So for those we fall back to matching
    /// our own public IP (derived for free from this machine's most recent desktop
    /// call in the same history, else fetched once externally). Public IP is shared
    /// by machines behind one NAT, so within an office it disambiguates by time;
    /// remote reps on different connections get an exact match.</para>
    ///
    /// Retries briefly because call_history lags a few seconds after hangup.
    /// Returns (null, null) when there is no confident match.
    /// </summary>
    public async Task<(string? CallId, string? PhoneE164)> ResolveOwnCallAsync(
        DateTime startUtc, int attempts = 4, int delayMs = 2500)
    {
        var localIps = GetLocalIPv4Set();
        if (localIps.Count == 0)
        {
            Debug.WriteLine("[ZoomAPI] ResolveOwnCall: no local IPv4 addresses");
            return (null, null);
        }

        for (int i = 0; i < attempts; i++)
        {
            var calls = await GetRecentCallHistoryAsync(30);

            // Strategy 1 — desktop: exact device_private_ip match.
            var best = MatchClosest(calls, startUtc,
                c => !string.IsNullOrEmpty(c.DevicePrivateIp) && localIps.Contains(c.DevicePrivateIp));
            if (best.Record != null)
            {
                LogResolved(best, "private-ip");
                return (best.Record.CallId, PhoneOf(best.Record));
            }

            // Strategy 2 — web phone: records with NO private ip, matched by our
            // public ip when we can determine it. The Chrome web dialer is the only
            // path that produces these device-private-ip-less records.
            var pubIp = _ownPublicIp ??= DerivePublicIp(calls, localIps) ?? await FetchPublicIpAsync();
            if (!string.IsNullOrEmpty(pubIp))
            {
                best = MatchClosest(calls, startUtc,
                    c => string.IsNullOrEmpty(c.DevicePrivateIp)
                         && string.Equals(c.DevicePublicIp, pubIp, StringComparison.Ordinal));
                if (best.Record != null)
                {
                    LogResolved(best, "public-ip(web)");
                    return (best.Record.CallId, PhoneOf(best.Record));
                }
            }

            if (i < attempts - 1) await Task.Delay(delayMs);
        }
        Debug.WriteLine("[ZoomAPI] ResolveOwnCall: no device-IP + time match in call_history");
        return (null, null);
    }

    private static (ZoomCallRecord? Record, double Delta) MatchClosest(
        List<ZoomCallRecord> calls, DateTime startUtc, Func<ZoomCallRecord, bool> predicate)
    {
        ZoomCallRecord? best = null;
        double bestDelta = double.MaxValue;
        foreach (var c in calls)
        {
            if (!predicate(c) || c.StartTime == null) continue;
            var delta = Math.Abs((c.StartTime.Value - startUtc).TotalSeconds);
            if (delta > 180) continue; // generous window; the device fingerprint disambiguates
            if (delta < bestDelta) { bestDelta = delta; best = c; }
        }
        return (best, bestDelta);
    }

    private static string? PhoneOf(ZoomCallRecord r) =>
        string.Equals(r.Direction, "outbound", StringComparison.OrdinalIgnoreCase)
            ? r.CalleeNumber : r.CallerNumber;

    private static void LogResolved((ZoomCallRecord? Record, double Delta) m, string via)
    {
        if (m.Record == null) return;
        var ip = m.Record.DevicePrivateIp ?? m.Record.DevicePublicIp;
        FileLogger.Write($"[ZoomAPI] Resolved own call {m.Record.CallId} (Δ{m.Delta:F0}s, {via} {ip}) phone={PhoneOf(m.Record)}");
    }

    /// <summary>
    /// Determine this machine's public IP from call_history itself: any record
    /// whose device_private_ip is one of our local IPs (a desktop call from this
    /// machine) also carries our device_public_ip. Free, no external dependency.
    /// </summary>
    private static string? DerivePublicIp(List<ZoomCallRecord> calls, HashSet<string> localIps)
    {
        foreach (var c in calls)
        {
            if (!string.IsNullOrEmpty(c.DevicePrivateIp)
                && localIps.Contains(c.DevicePrivateIp)
                && !string.IsNullOrEmpty(c.DevicePublicIp))
                return c.DevicePublicIp;
        }
        return null;
    }

    /// <summary>
    /// Best-effort external public-IP lookup, used only when this machine has no
    /// desktop call in recent history to derive it from (e.g. a web-only rep).
    /// Short timeout; returns null on any failure so resolution degrades to parked.
    /// </summary>
    private async Task<string?> FetchPublicIpAsync()
    {
        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            var ip = (await _http.GetStringAsync("https://api.ipify.org", cts.Token)).Trim();
            return string.IsNullOrEmpty(ip) ? null : ip;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] public IP fetch failed: {ex.Message}");
            return null;
        }
    }

    private async Task<List<ZoomCallRecord>> GetRecentCallHistoryAsync(int pageSize)
    {
        var token = await GetAccessTokenAsync();
        if (token == null) return [];

        string? userId;
        lock (_lock) userId = _zoomUserId;
        if (userId == null) return [];

        try
        {
            var request = new HttpRequestMessage(HttpMethod.Get,
                $"{_apiBase}/phone/users/{userId}/call_history?page_size={pageSize}");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);

            var response = await _http.SendAsync(request);
            var body = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode)
            {
                Debug.WriteLine($"[ZoomAPI] call_history failed ({response.StatusCode}): {body}");
                return [];
            }

            using var doc = JsonDocument.Parse(body);
            var list = new List<ZoomCallRecord>();
            if (doc.RootElement.TryGetProperty("call_logs", out var arr) && arr.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in arr.EnumerateArray())
                {
                    list.Add(new ZoomCallRecord
                    {
                        CallId = item.TryGetProperty("call_id", out var id) ? id.GetString() ?? "" : "",
                        Direction = item.TryGetProperty("direction", out var d) ? d.GetString() : null,
                        CalleeNumber = item.TryGetProperty("callee_did_number", out var ce) ? ce.GetString() : null,
                        CallerNumber = item.TryGetProperty("caller_did_number", out var ca) ? ca.GetString() : null,
                        DevicePrivateIp = item.TryGetProperty("device_private_ip", out var ip) ? ip.GetString() : null,
                        DevicePublicIp = item.TryGetProperty("device_public_ip", out var pip) ? pip.GetString() : null,
                        StartTime = ParseUtc(item, "start_time"),
                    });
                }
            }
            return list;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] call_history error: {ex.Message}");
            return [];
        }
    }

    private static DateTime? ParseUtc(JsonElement obj, string prop)
    {
        if (!obj.TryGetProperty(prop, out var v) || v.ValueKind != JsonValueKind.String) return null;
        return DateTime.TryParse(v.GetString(), CultureInfo.InvariantCulture,
            DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var dt)
            ? dt : null;
    }

    private static HashSet<string> GetLocalIPv4Set()
    {
        var set = new HashSet<string>();
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var ua in ni.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily == AddressFamily.InterNetwork)
                        set.Add(ua.Address.ToString());
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZoomAPI] local IP enumeration failed: {ex.Message}");
        }
        return set;
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

public class ZoomCallRecord
{
    public string CallId { get; set; } = "";
    public string? Direction { get; set; }
    public string? CalleeNumber { get; set; }
    public string? CallerNumber { get; set; }
    public string? DevicePrivateIp { get; set; }
    public string? DevicePublicIp { get; set; }
    public DateTime? StartTime { get; set; }
}
