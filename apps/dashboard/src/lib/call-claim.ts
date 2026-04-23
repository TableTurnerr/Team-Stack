import { pb } from './pocketbase';
import { toE164Loose, lastTenDigits } from './phone-canonical';

/**
 * Call-claim linking helpers.
 *
 * A "claim" is the ownership ledger row created either (a) at dial time by
 * the initiating user, or (b) by the Zoom webhook the moment an inbound
 * call rings. Every call_log row that we create in the CRM must be linked
 * back to the claim that represents the call — otherwise the call_log is
 * floating in a shared-account world where we can't tell who owned it.
 *
 * These helpers are intentionally forgiving: if no matching claim is found
 * (e.g. the webhook hasn't arrived yet), we still create/return the log —
 * the link is an enhancement, not a requirement.
 */

export interface ClaimLookupHints {
    zoomCallId?: string | null;
    phone?: string | null;
    direction?: 'inbound' | 'outbound';
    userId?: string | null;
    deviceId?: string | null;
    intentId?: string | null;
}

/**
 * Look up the freshest relevant claim. Prefers zoom_call_id (strongest),
 * then a live pending/active claim owned by this user, then a phone match.
 */
export async function findClaim(hints: ClaimLookupHints): Promise<{ id: string } | null> {
    if (hints.zoomCallId) {
        try {
            const claim = await pb.collection('call_claims')
                .getFirstListItem<{ id: string }>(`zoom_call_id = "${hints.zoomCallId}"`);
            return claim;
        } catch { /* fall through */ }
    }

    if (hints.intentId) {
        try {
            const claim = await pb.collection('call_claims')
                .getFirstListItem<{ id: string }>(`intent_id = "${hints.intentId}"`);
            return claim;
        } catch { /* fall through */ }
    }

    const tail = lastTenDigits(hints.phone);
    if (tail) {
        try {
            const phoneFilter = `phone_e164 ~ "${tail}"`;
            const ownerFilter = hints.userId ? ` && owner_user = "${hints.userId}"` : '';
            const stateFilter = ' && (state = "active" || state = "pending")';
            const list = await pb.collection('call_claims').getList<{ id: string; created: string }>(1, 1, {
                filter: phoneFilter + ownerFilter + stateFilter,
                sort: '-created',
            });
            if (list.items.length > 0) return { id: list.items[0].id };
        } catch { /* fall through */ }
    }

    return null;
}

/**
 * Ensure a claim exists for the given hints, creating one if not. Returns
 * the claim id. Used at call-log creation time so that every log has a
 * claim to point at even if the intent/webhook pipeline missed.
 */
export async function ensureClaim(
    hints: ClaimLookupHints & { state?: 'pending' | 'active' | 'ended' }
): Promise<string | null> {
    const existing = await findClaim(hints);
    if (existing) return existing.id;

    const phoneE164 = toE164Loose(hints.phone);
    if (!hints.direction) return null; // can't create without direction

    try {
        const created = await pb.collection('call_claims').create<{ id: string }>({
            zoom_call_id: hints.zoomCallId ?? undefined,
            phone_e164: phoneE164 ?? undefined,
            direction: hints.direction,
            state: hints.state ?? 'ended',
            owner_user: hints.userId ?? undefined,
            owner_device_id: hints.deviceId ?? undefined,
            intent_id: hints.intentId ?? undefined,
            ended_at: hints.state === 'ended' ? new Date().toISOString() : undefined,
        });
        return created.id;
    } catch (err) {
        console.warn('[call-claim] ensureClaim failed:', err);
        return null;
    }
}

/**
 * After a call_log has been created, link it to its claim. Best-effort —
 * failures are logged but don't propagate so call-log creation stays
 * resilient to claim-system outages.
 */
export async function linkCallLogToClaim(
    callLogId: string,
    hints: ClaimLookupHints
): Promise<string | null> {
    try {
        const claimId = await ensureClaim({ ...hints, state: 'ended' });
        if (!claimId) return null;
        await pb.collection('call_logs').update(callLogId, { claim: claimId });
        await pb.collection('call_claims').update(claimId, {
            call_log: callLogId,
            state: 'ended',
            ended_at: new Date().toISOString(),
        });
        return claimId;
    } catch (err) {
        console.warn('[call-claim] linkCallLogToClaim failed:', err);
        return null;
    }
}
