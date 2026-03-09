import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'crm@tableturnerr.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Tableturnerr CRM';

interface SendRequest {
  to: string;
  subject: string;
  html: string;
  trackingId?: string;
  fromName?: string;
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  let body: SendRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { to, subject, html, trackingId, fromName } = body;

  if (!to || !subject || !html) {
    return NextResponse.json({ error: 'Missing required fields: to, subject, html' }, { status: 400 });
  }

  // Basic email validation (atomic groups via possessive-style to avoid ReDoS)
  if (!/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(to)) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
  }

  try {
    const from = `${fromName || EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`;

    const resendPayload: Record<string, unknown> = {
      from,
      to: [to],
      subject,
      html,
    };

    // Attach tracking ID as custom header for webhook correlation
    if (trackingId) {
      resendPayload.headers = { 'X-Tracking-Id': trackingId };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(resendPayload),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[email-send] Resend API error:', res.status, data);
      return NextResponse.json(
        { success: false, error: data.message || 'Failed to send email', statusCode: res.status },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, messageId: data.id });
  } catch (e) {
    console.error('[email-send] error:', e);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
