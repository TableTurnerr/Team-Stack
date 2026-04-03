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

    // Store as a raw lookup record — agents query by phone number + timing
    // to find call_id for API operations. No CRM user is attached here.
    const pb = await getPbAdmin();
    if (pb) {
        try {
            await pb.collection('zoom_call_events').create({
                event_type: event,
                call_id: callId,
                callee_number: calleeNumber,
                caller_number: callerNumber,
                direction,
                zoom_user_id: zoomUserId,
                status,
                duration,
                raw_payload: JSON.stringify(eventPayload),
            });

            // Clean up events older than 24 hours (they're just a cache)
            try {
                const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace('T', ' ');
                const old = await pb.collection('zoom_call_events').getList(1, 50, {
                    filter: `created < "${cutoff}"`,
                    fields: 'id',
                });
                for (const record of old.items) {
                    await pb.collection('zoom_call_events').delete(record.id);
                }
            } catch { /* cleanup is best-effort */ }
        } catch (err) {
            // Collection might not exist yet — log but don't fail
            console.warn('[ZoomWebhook] Failed to store event:', err);
        }
    }

    console.log(`[ZoomWebhook] Call ${callId}: ${event} | ${callerNumber} → ${calleeNumber} | ${status}`);

    return NextResponse.json({ status: 'ok' });
}
