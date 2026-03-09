import { NextResponse } from 'next/server';

// 1x1 transparent GIF (43 bytes)
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  // Record open event asynchronously — don't block the pixel response
  if (PB_URL && trackingId) {
    recordOpen(trackingId).catch(() => {});
  }

  return new NextResponse(TRACKING_PIXEL, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(TRACKING_PIXEL.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  });
}

async function recordOpen(trackingId: string) {
  try {
    // Find the recipient by tracking_id
    const listRes = await fetch(
      `${PB_URL}/api/collections/email_recipients/records?filter=(tracking_id='${encodeURIComponent(trackingId)}')&perPage=1`,
      { cache: 'no-store' }
    );
    if (!listRes.ok) return;

    const listData = await listRes.json();
    const recipient = listData.items?.[0];
    if (!recipient) return;

    // Update recipient: increment open_count, set opened_at if first open, set status to opened if still sent/delivered
    const updates: Record<string, unknown> = {
      open_count: (recipient.open_count || 0) + 1,
    };
    if (!recipient.opened_at) {
      updates.opened_at = new Date().toISOString();
    }
    if (recipient.status === 'sent' || recipient.status === 'delivered') {
      updates.status = 'opened';
    }

    await fetch(`${PB_URL}/api/collections/email_recipients/records/${recipient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
      cache: 'no-store',
    });

    // Create email_events record
    await fetch(`${PB_URL}/api/collections/email_events/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: recipient.id,
        company: recipient.company,
        event_type: 'opened',
        event_data: JSON.stringify({ tracking_id: trackingId }),
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.error('[email-tracking/open] error recording open:', e);
  }
}
