using System.Collections.Concurrent;
using System.Diagnostics;

namespace LocalCrmAgent.Services;

/// <summary>
/// Records outbound dial "intents" issued by the dashboard ahead of the
/// Zoom iframe actually dialing. The dashboard emits an intent the instant
/// the user clicks Call; the agent later correlates it to the Zoom UI
/// active-call appearance (by last-10 phone match) so the resulting
/// call_log/claim is unambiguously attributed to the user that initiated
/// the dial — not whichever teammate's iframe happened to update.
/// </summary>
public class DialIntentTracker
{
    private static readonly TimeSpan MaxIntentAge = TimeSpan.FromSeconds(20);

    private readonly ConcurrentDictionary<string, Intent> _intents = new();

    public record Intent(
        string IntentId,
        string PhoneE164,
        string UserId,
        string? SessionId,
        DateTime CreatedAt);

    public void Add(string intentId, string phone, string userId, string? sessionId = null)
    {
        if (string.IsNullOrWhiteSpace(intentId) || string.IsNullOrWhiteSpace(phone)) return;
        var e164 = PhoneNormalize.ToE164Loose(phone);
        if (e164 == null) return;
        _intents[intentId] = new Intent(intentId, e164, userId ?? "", sessionId, DateTime.UtcNow);
        Debug.WriteLine($"[DialIntent] +{intentId} phone={e164} user={userId}");
        Prune();
    }

    /// <summary>
    /// Look up the freshest matching intent by phone (last-10 digits).
    /// Returns null if no live intent matches.
    /// </summary>
    public Intent? MatchByPhone(string? phone)
    {
        if (string.IsNullOrWhiteSpace(phone)) return null;
        Prune();
        Intent? best = null;
        foreach (var kv in _intents)
        {
            var i = kv.Value;
            if (!PhoneNormalize.SameNumber(i.PhoneE164, phone)) continue;
            if (best == null || i.CreatedAt > best.CreatedAt) best = i;
        }
        return best;
    }

    /// <summary>
    /// Freshest intent in the tracking window, regardless of phone match.
    /// Used when we detect a call transitioning to Connected but can't
    /// read the phone from UIA — if an intent exists in the 20 s window
    /// it must be the dial that just connected, by the team rule that
    /// every outbound call originates from the CRM dialer.
    /// </summary>
    public Intent? MostRecent()
    {
        Prune();
        Intent? best = null;
        foreach (var kv in _intents)
        {
            var i = kv.Value;
            if (best == null || i.CreatedAt > best.CreatedAt) best = i;
        }
        return best;
    }

    public bool Consume(string intentId)
    {
        return _intents.TryRemove(intentId, out _);
    }

    private void Prune()
    {
        var cutoff = DateTime.UtcNow - MaxIntentAge;
        foreach (var kv in _intents)
            if (kv.Value.CreatedAt < cutoff)
                _intents.TryRemove(kv.Key, out _);
    }
}
