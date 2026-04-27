/**
 * Phone-number canonicalization used across the call-ownership system.
 *
 * Keep this in sync with:
 *   - tools/local-CRM-Agent/.../PhoneNormalize.cs (C#)
 *   - apps/dashboard/src/app/api/zoom/webhook/route.ts (local helper)
 */

export function toE164Loose(input: string | null | undefined): string | null {
    if (input == null) return null;
    const digits = String(input).replace(/\D+/g, '');
    if (!digits) return null;
    // Short strings (extensions) are returned digits-only so callers can
    // tell them apart from real phone numbers.
    if (digits.length < 7) return digits;
    return `+${digits}`;
}

export function lastTenDigits(input: string | null | undefined): string | null {
    if (input == null) return null;
    const digits = String(input).replace(/\D+/g, '');
    if (!digits) return null;
    return digits.length <= 10 ? digits : digits.slice(-10);
}

export function sameNumber(a: string | null | undefined, b: string | null | undefined): boolean {
    const ta = lastTenDigits(a);
    const tb = lastTenDigits(b);
    if (!ta || !tb) return false;
    return ta === tb;
}
