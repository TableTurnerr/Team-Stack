import { NextResponse } from 'next/server';
import crypto from 'crypto';
import PocketBase from 'pocketbase';

/**
 * Zoom Phone Webhook Endpoint
 *
 * IMPORTANT: This stores RAW Zoom events only — no CRM user identity.
 * When multiple teammates share the same Zoom account, the webhook
 * fires for ALL of their calls. It has no way to know which CRM user
 * is on which machine.
 *
 * Identity flow:
 *   1. Webhook stores raw events (call_id, phone numbers, timestamps)
 *   2. Each agent detects calls locally via WASAPI (this machine only)
 *   3. Agent matches events by phone number + timing to get call_id
 *   4. CRM auth (from the dashboard) determines which user owns the call
 *   5. Call logs are always created by the authenticated CRM user, never by this webhook
 */

/**
 * Canonicalise a phone string by stripping non-digits and prefixing "+".
 * Short strings (extensions) return digits-only without the "+".
 * Kept in sync with the identical helper in the local agent.
 */
function toE164Loose(input: string | undefined | null): string | null {
    if (!input) return null;
    const digits = String(input).replace(/\D+/g, '');
    if (!digits) return null;
    if (digits.length < 7) return digits;
    return `+${digits}`;
}

const ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || '';
const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL || '';
const PB_ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PB_ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';

// ── Signature verification ───────────────────────────────────────

function verifySignature(body: string, timestamp: string, signature: string): boolean {
    if (!ZOOM_WEBHOOK_SECRET) return false;
    const message = `v0:${timestamp}:${body}`;
    const hash = crypto.createHmac('sha256', ZOOM_WEBHOOK_SECRET).update(message).digest('hex');
    return signature === `v0=${hash}`;
}

// ── PocketBase admin client ──────────────────────────────────────

let pbAdmin: PocketBase | null = null;

async function getPbAdmin(): Promise<PocketBase | null> {
    if (!PB_URL || !PB_ADMIN_EMAIL || !PB_ADMIN_PASSWORD) return null;

    if (pbAdmin && pbAdmin.authStore.isValid) return pbAdmin;

    try {
        const pb = new PocketBase(PB_URL);
        await pb.collection('_superusers').authWithPassword(PB_ADMIN_EMAIL, PB_ADMIN_PASSWORD);
        pbAdmin = pb;
        return pb;
    } catch (err) {
        console.error('[ZoomWebhook] PB admin auth failed:', err);
        return null;
    }
}

// ── Webhook handler ──────────────────────────────────────────────

export async function POST(request: Request) {
    const rawBody = await request.text();
    let payload: Record<string, unknown>;

    try {
        payload = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    // ── URL validation challenge (Zoom app activation) ───────────
    if (payload.event === 'endpoint.url_validation') {
        const plainToken = (payload.payload as { plainToken?: string })?.plainToken;
        if (!plainToken || !ZOOM_WEBHOOK_SECRET) {
            return NextResponse.json({ error: 'Missing token or secret' }, { status: 400 });
        }

        const encryptedToken = crypto
            .createHmac('sha256', ZOOM_WEBHOOK_SECRET)
            .update(plainToken)
            .digest('hex');

        return NextResponse.json({ plainToken, encryptedToken });
    }

    // ── Verify webhook signature ─────────────────────────────────
    const timestamp = request.headers.get('x-zm-request-timestamp') || '';
    const signature = request.headers.get('x-zm-signature') || '';

    if (ZOOM_WEBHOOK_SECRET && !verifySignature(rawBody, timestamp, signature)) {
        console.warn('[ZoomWebhook] Invalid signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // ── Process phone call events ────────────────────────────────
    const event = payload.event as string;
    const eventPayload = payload.payload as Record<string, unknown> | undefined;

    console.log(`[ZoomWebhook] Event: ${event}`);

    if (!eventPayload) {
        return NextResponse.json({ status: 'ok' });
    }

    // Extract call data — NO CRM user identity, just raw Zoom data
    const callObj = (eventPayload.object ?? eventPayload.call ?? eventPayload) as Record<string, unknown>;
    const callId = (callObj.call_id ?? callObj.id ?? '') as string;
    const calleeNumber = (callObj.callee_number ?? callObj.phone_number ?? '') as string;
    const callerNumber = (callObj.caller_number ?? '') as string;
    const direction = (callObj.direction ?? '') as string;
    const zoomUserId = (callObj.user_id ?? callObj.owner_id ?? '') as string;
    const status = (callObj.status ?? event.split('.').pop() ?? '') as string;
    const duration = (callObj.duration ?? 0) as number;

    // Normalize direction: Zoom uses strings like "outbound"/"inbound"
    // already, but fall back to inferring from the event name.
    const normalizedDirection =
        direction === 'outbound' || direction === 'inbound'
            ? direction
            : event.includes('callee_')     // "phone.callee_ringing" → received by us
                ? 'inbound'
                : event.includes('caller_') // "phone.caller_...">dialed by us
                    ? 'outbound'
                    : '';

    // Canonicalise the external phone for the claim. The webhook reports
    // the number that isn't us:
    //   inbound  → caller_number is the external party
    //   outbound → callee_number is the external party
    const externalPhoneRaw =
        normalizedDirection === 'inbound' ? callerNumber :
        normalizedDirection === 'outbound' ? calleeNumber :
        (calleeNumber || callerNumber);
    const phoneE164 = toE164Loose(externalPhoneRaw);

    // Store the raw event using the canonical schema field names.
    const pb = await getPbAdmin();
    if (pb) {
        try {
            await pb.collection('zoom_call_events').create({
                event,
                zoom_call_id: callId,
                caller_number: callerNumber,
                callee_number: calleeNumber,
                direction: normalizedDirection || undefined,
                payload: eventPayload,
                received_at: new Date().toISOString(),
            });
        } catch (err) {
            console.warn('[ZoomWebhook] Failed to store event:', err);
        }

        // Inbound ringing: create an unassigned pending claim so every
        // connected dashboard sees the ring via PocketBase realtime
        // *before* any teammate's agent has detected it locally. The
        // claim is owner-less until the teammate that answers links
        // their UI-confirmed call to it.
        if (
            normalizedDirection === 'inbound' &&
            /ring|ringing|callee_ringing/i.test(event) &&
            callId
        ) {
            try {
                const existing = await pb
                    .collection('call_claims')
                    .getFirstListItem(`zoom_call_id = "${callId}"`)
                    .catch(() => null);

                if (!existing) {
                    await pb.collection('call_claims').create({
                        zoom_call_id: callId,
                        phone_e164: phoneE164 ?? externalPhoneRaw,
                        direction: 'inbound',
                        state: 'pending',
                        pending_since: new Date().toISOString(),
                        ui_evidence: { source: 'zoom_webhook', event },
                    });
                }
            } catch (err) {
                console.warn('[ZoomWebhook] Failed to create pending claim:', err);
            }
        }

        // Best-effort cleanup: events older than 24h are just a cache.
        try {
            const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000)
                .toISOString().replace('T', ' ');
            const old = await pb.collection('zoom_call_events').getList(1, 50, {
                filter: `created < "${cutoff}"`,
                fields: 'id',
            });
            for (const record of old.items) {
                await pb.collection('zoom_call_events').delete(record.id);
            }
        } catch { /* best-effort */ }
    }

    console.log(`[ZoomWebhook] Call ${callId}: ${event} | ${callerNumber} → ${calleeNumber} | ${status}`);

    return NextResponse.json({ status: 'ok' });
}
