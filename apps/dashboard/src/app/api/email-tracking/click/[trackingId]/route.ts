import { NextResponse } from 'next/server';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;
  const { searchParams } = new URL(request.url);
  const encodedUrl = searchParams.get('url');

  if (!encodedUrl) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  let destinationUrl: string;
  try {
    destinationUrl = Buffer.from(encodedUrl, 'base64').toString('utf-8');
  } catch {
    return new NextResponse('Invalid url parameter', { status: 400 });
  }

  // Validate destination URL to prevent open redirect
  try {
    const parsed = new URL(destinationUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return new NextResponse('Invalid url protocol', { status: 400 });
    }
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  // Record click event asynchronously
  if (PB_URL && trackingId) {
    recordClick(trackingId, destinationUrl).catch(() => {});
  }

  return NextResponse.redirect(destinationUrl, 302);
}

async function recordClick(trackingId: string, url: string) {
  try {
    const listRes = await fetch(
      `${PB_URL}/api/collections/email_recipients/records?filter=(tracking_id='${encodeURIComponent(trackingId)}')&perPage=1`,
      { cache: 'no-store' }
    );
    if (!listRes.ok) return;

    const listData = await listRes.json();
    const recipient = listData.items?.[0];
    if (!recipient) return;

    // Update recipient: increment click_count, set clicked_at if first, update status
    const updates: Record<string, unknown> = {
      click_count: (recipient.click_count || 0) + 1,
    };
    if (!recipient.clicked_at) {
      updates.clicked_at = new Date().toISOString();
    }
    if (['sent', 'delivered', 'opened'].includes(recipient.status)) {
      updates.status = 'clicked';
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
        event_type: 'clicked',
        event_data: JSON.stringify({ tracking_id: trackingId, url }),
      }),
      cache: 'no-store',
    });
  } catch (e) {
    console.error('[email-tracking/click] error recording click:', e);
  }
}
