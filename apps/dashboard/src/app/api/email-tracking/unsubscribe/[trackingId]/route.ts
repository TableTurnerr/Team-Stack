import { NextResponse } from 'next/server';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;

// GET — renders a simple unsubscribe confirmation page
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribe</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { font-size: 24px; color: #1a1a1a; margin-bottom: 12px; }
    p { color: #666; line-height: 1.6; margin-bottom: 24px; }
    button { background: #dc2626; color: white; border: none; padding: 12px 32px; border-radius: 8px; font-size: 16px; cursor: pointer; transition: background 0.2s; }
    button:hover { background: #b91c1c; }
    button:disabled { background: #9ca3af; cursor: not-allowed; }
    .success { color: #16a34a; }
    .error { color: #dc2626; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Unsubscribe</h1>
    <p>Are you sure you want to unsubscribe from our emails? You will no longer receive marketing emails from us.</p>
    <div id="result"></div>
    <button id="unsub-btn" onclick="handleUnsubscribe()">Unsubscribe</button>
  </div>
  <script>
    async function handleUnsubscribe() {
      const btn = document.getElementById('unsub-btn');
      const result = document.getElementById('result');
      btn.disabled = true;
      btn.textContent = 'Processing...';
      try {
        const res = await fetch(window.location.href, { method: 'POST' });
        const data = await res.json();
        if (data.success) {
          result.innerHTML = '<p class="success">You have been successfully unsubscribed.</p>';
          btn.style.display = 'none';
        } else {
          result.innerHTML = '<p class="error">' + (data.error || 'Something went wrong.') + '</p>';
          btn.disabled = false;
          btn.textContent = 'Try Again';
        }
      } catch {
        result.innerHTML = '<p class="error">Network error. Please try again.</p>';
        btn.disabled = false;
        btn.textContent = 'Try Again';
      }
    }
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

// POST — processes the unsubscribe
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ trackingId: string }> }
) {
  const { trackingId } = await params;

  if (!PB_URL) {
    return NextResponse.json({ success: false, error: 'Server configuration error' }, { status: 500 });
  }

  try {
    // Find the recipient by tracking_id
    const listRes = await fetch(
      `${PB_URL}/api/collections/email_recipients/records?filter=(tracking_id='${encodeURIComponent(trackingId)}')&perPage=1`,
      { cache: 'no-store' }
    );
    if (!listRes.ok) {
      return NextResponse.json({ success: false, error: 'Could not find subscription' }, { status: 404 });
    }

    const listData = await listRes.json();
    const recipient = listData.items?.[0];
    if (!recipient) {
      return NextResponse.json({ success: false, error: 'Invalid unsubscribe link' }, { status: 404 });
    }

    // 1. Update recipient status
    await fetch(`${PB_URL}/api/collections/email_recipients/records/${recipient.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'unsubscribed' }),
      cache: 'no-store',
    });

    // 2. Create email_unsubscribes record
    await fetch(`${PB_URL}/api/collections/email_unsubscribes/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        company: recipient.company,
        email_address: recipient.email_address,
        reason: 'User clicked unsubscribe link',
        source: 'link_click',
        campaign: recipient.campaign,
      }),
      cache: 'no-store',
    });

    // 3. Set do_not_contact on the company
    if (recipient.company) {
      await fetch(`${PB_URL}/api/collections/companies/records/${recipient.company}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ do_not_contact: true }),
        cache: 'no-store',
      });
    }

    // 4. Create email_events record
    await fetch(`${PB_URL}/api/collections/email_events/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient: recipient.id,
        company: recipient.company,
        event_type: 'unsubscribed',
        event_data: JSON.stringify({ tracking_id: trackingId, source: 'link_click' }),
      }),
      cache: 'no-store',
    });

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[email-tracking/unsubscribe] error:', e);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
