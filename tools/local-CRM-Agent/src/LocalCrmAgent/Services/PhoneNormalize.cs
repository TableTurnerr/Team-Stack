using System.Text;

namespace LocalCrmAgent.Services;

/// <summary>
/// Phone-number canonicalization used for matching across sources
/// (dashboard dial intent, Zoom UIA, Zoom webhook, WASAPI-adjacent metadata).
///
/// Canonical form: "+" + all digits (e.g. "+18023599100"). Short strings that
/// don't look like a phone number (extensions like "802") are returned as
/// digits-only without a "+" prefix so callers can distinguish them.
///
/// Matching uses the last-10-digit tail so different upstream formats
/// ("+1 (802) 359-9100", "18023599100", "8023599100") all unify.
/// </summary>
public static class PhoneNormalize
{
    public static string? ToE164Loose(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var digits = KeepDigits(input);
        if (digits.Length == 0) return null;
        // Extension-style short string — return as-is, no "+"
        if (digits.Length < 7) return digits;
        return "+" + digits;
    }

    public static string? LastTenDigits(string? input)
    {
        if (string.IsNullOrWhiteSpace(input)) return null;
        var digits = KeepDigits(input);
        if (digits.Length == 0) return null;
        return digits.Length <= 10 ? digits : digits.Substring(digits.Length - 10);
    }

    public static bool SameNumber(string? a, string? b)
    {
        var ta = LastTenDigits(a);
        var tb = LastTenDigits(b);
        if (ta == null || tb == null) return false;
        return ta == tb;
    }

    private static string KeepDigits(string s)
    {
        var sb = new StringBuilder(s.Length);
        foreach (var ch in s)
            if (ch >= '0' && ch <= '9') sb.Append(ch);
        return sb.ToString();
    }
}
