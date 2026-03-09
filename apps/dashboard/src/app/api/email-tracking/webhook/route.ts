import { NextResponse } from 'next/server';
import crypto from 'crypto';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;
const WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;

// Resend webhook event types we handle
type ResendEventType = 'email.delivered' | 'email.bounced' | 'email.complained' | 'email.opened' | 'email.clicked';

interface ResendWebhookPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    headers?: { name: string; value: string }[];
    [key: string]: unknown;
  };
}

function verifySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(request: Request) {
  if (!PB_URL) {
    return NextResponse.json({ error: 'Server not configured' }, { status: 500 });
  }

  const rawBody = await request.text();

  // Validate webhook signature — fail closed if secret is not configured
  if (!WEBHOOK_SECRET) {
    console.error('[email-tracking/webhook] RESEND_WEBHOOK_SECRET not configured — rejecting request');
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 });
  }

  const signature = request.headers.get('svix-signature') || request.headers.get('x-resend-signature');
  if (!verifySignature(rawBody, signature, WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const eventType = payload.type;
  if (!eventType) {
    return NextResponse.json({ error: 'Missing event type' }, { status: 400 });
  }

  try {
    // Extract tracking ID from custom headers (X-Tracking-Id) set during send
    const trackingId = payload.data.headers?.find(
      (h) => h.name.toLowerCase() === 'x-tracking-id'
    )?.value;

    if (!trackingId) {
      // Can't correlate without tracking ID — acknowledge anyway
      return NextResponse.json({ received: true, matched: false });
    }

    // Find the recipient by tracking_id
    const listRes = await fetch(
      `${PB_URL}/api/collections/email_recipients/records?filter=(tracking_id='${encodeURIComponent(trackingId)}')&perPage=1`,
      { cache: 'no-store' }
    );
    if (!listRes.ok) {
      return NextResponse.json({ received: true, matched: false });
    }

    const listData = await listRes.json();
    const recipient = listData.items?.[0];
    if (!recipient) {
      return NextResponse.json({ received: true, matched: false });
    }

    switch (eventType) {
      case 'email.delivered': {
        const updates: Record<string, unknown> = { delivered_at: new Date().toISOString() };
        if (recipient.status === 'sent' || recipient.status === 'pending') {
          updates.status = 'delivered';
        }
        await patchRecipient(recipient.id, updates);
        await createEvent(recipient.id, recipient.company, 'delivered', payload.data);
        break;
      }

      case 'email.bounced': {
        await patchRecipient(recipient.id, { status: 'bounced', bounced_at: new Date().toISOString() });
        await createEvent(recipient.id, recipient.company, 'bounced', payload.data);

        // Hard bounces: set do_not_contact on the company
        if (recipient.company) {
          await fetch(`${PB_URL}/api/collections/companies/records/${recipient.company}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ do_not_contact: true }),
            cache: 'no-store',
          });
        }

        // Create unsubscribe record for bounce
        await fetch(`${PB_URL}/api/collections/email_unsubscribes/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: recipient.company,
            email_address: recipient.email_address,
            reason: 'Hard bounce',
            source: 'bounce',
            campaign: recipient.campaign,
          }),
          cache: 'no-store',
        });
        break;
      }

      case 'email.complained': {
        await patchRecipient(recipient.id, { status: 'unsubscribed' });
        await createEvent(recipient.id, recipient.company, 'complained', payload.data);

        // Complaint: mark as do_not_contact
        if (recipient.company) {
          await fetch(`${PB_URL}/api/collections/companies/records/${recipient.company}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ do_not_contact: true }),
            cache: 'no-store',
          });
        }

        await fetch(`${PB_URL}/api/collections/email_unsubscribes/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: recipient.company,
            email_address: recipient.email_address,
            reason: 'Spam complaint',
            source: 'complaint',
            campaign: recipient.campaign,
          }),
          cache: 'no-store',
        });
        break;
      }

      case 'email.opened':
      case 'email.clicked':
        // These are also handled by our tracking pixel/links, but Resend may send them too
        break;

      default:
        break;
    }

    return NextResponse.json({ received: true, matched: true, event: eventType });
  } catch (e) {
    console.error('[email-tracking/webhook] error processing event:', e);
    return NextResponse.json({ error: 'Processing error' }, { status: 500 });
  }
}

async function patchRecipient(id: string, updates: Record<string, unknown>) {
  await fetch(`${PB_URL}/api/collections/email_recipients/records/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
    cache: 'no-store',
  });
}

async function createEvent(recipientId: string, companyId: string, eventType: string, eventData: unknown) {
  await fetch(`${PB_URL}/api/collections/email_events/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: recipientId,
      company: companyId,
      event_type: eventType,
      event_data: JSON.stringify(eventData),
    }),
    cache: 'no-store',
  });
}
