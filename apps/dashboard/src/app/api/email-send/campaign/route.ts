import { NextResponse } from 'next/server';
import crypto from 'crypto';

const PB_URL = process.env.NEXT_PUBLIC_POCKETBASE_URL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'crm@tableturnerr.com';
const EMAIL_FROM_NAME = process.env.EMAIL_FROM_NAME || 'Tableturnerr CRM';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

interface CampaignSendRequest {
  campaignId: string;
}

export async function POST(request: Request) {
  if (!PB_URL) {
    return NextResponse.json({ error: 'PocketBase URL not configured' }, { status: 500 });
  }
  if (!RESEND_API_KEY) {
    return NextResponse.json({ error: 'RESEND_API_KEY not configured' }, { status: 500 });
  }

  let body: CampaignSendRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { campaignId } = body;
  if (!campaignId) {
    return NextResponse.json({ error: 'Missing campaignId' }, { status: 400 });
  }

  try {
    // 1. Fetch the campaign
    const campaignRes = await fetch(
      `${PB_URL}/api/collections/email_campaigns/records/${campaignId}`,
      { cache: 'no-store' }
    );
    if (!campaignRes.ok) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    const campaign = await campaignRes.json();

    if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
      return NextResponse.json({ error: `Campaign cannot be sent (status: ${campaign.status})` }, { status: 400 });
    }

    // 2. Set status to 'sending'
    await fetch(`${PB_URL}/api/collections/email_campaigns/records/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sending' }),
      cache: 'no-store',
    });

    // 3. Resolve audience
    const companies = await resolveAudience(campaign.audience_list, campaign.exclusion_list);

    if (companies.length === 0) {
      await fetch(`${PB_URL}/api/collections/email_campaigns/records/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }),
        cache: 'no-store',
      });
      return NextResponse.json({ success: true, sent: 0, message: 'No eligible recipients' });
    }

    // 4. Create recipients and send emails
    let sentCount = 0;
    let bouncedCount = 0;

    for (const company of companies) {
      const trackingId = crypto.randomUUID();
      const emailAddress = company.email;

      // Create recipient record
      const recipientRes = await fetch(`${PB_URL}/api/collections/email_recipients/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign: campaignId,
          company: company.id,
          email_address: emailAddress,
          status: 'pending',
          tracking_id: trackingId,
          open_count: 0,
          click_count: 0,
          personalization_data: JSON.stringify({
            company_name: company.company_name || '',
            owner_name: company.owner_name || '',
            email: company.email || '',
            status: Array.isArray(company.status) ? company.status.join(', ') : (company.status || ''),
            source: company.source || '',
            instagram_handle: company.instagram_handle || '',
          }),
        }),
        cache: 'no-store',
      });

      if (!recipientRes.ok) continue;
      const recipient = await recipientRes.json();

      // Resolve personalization variables in HTML
      let html = campaign.html_body || '';
      html = resolveVariables(html, company);

      // Inject tracking pixel
      html = injectTrackingPixel(html, trackingId);

      // Rewrite links for click tracking
      html = rewriteLinks(html, trackingId);

      // Add unsubscribe link
      html = addUnsubscribeLink(html, trackingId);

      // Send via Resend
      const sendResult = await sendEmail(emailAddress, campaign.subject || '', html, trackingId);

      if (sendResult.success) {
        sentCount++;
        await fetch(`${PB_URL}/api/collections/email_recipients/records/${recipient.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString() }),
          cache: 'no-store',
        });

        // Create sent event
        await fetch(`${PB_URL}/api/collections/email_events/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            recipient: recipient.id,
            company: company.id,
            event_type: 'sent',
            event_data: JSON.stringify({ message_id: sendResult.messageId }),
          }),
          cache: 'no-store',
        });

        // Create interaction record for CRM timeline
        await fetch(`${PB_URL}/api/collections/interactions/records`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            company: company.id,
            channel: 'email',
            direction: 'outbound',
            notes: `Campaign: ${campaign.name} — Subject: ${campaign.subject}`,
          }),
          cache: 'no-store',
        });
      } else {
        bouncedCount++;
      }

      // Rate limiting: small delay between sends
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 5. Update campaign counters and status
    await fetch(`${PB_URL}/api/collections/email_campaigns/records/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'sent',
        sent_at: new Date().toISOString(),
        sent_count: sentCount,
        bounced_count: bouncedCount,
      }),
      cache: 'no-store',
    });

    return NextResponse.json({ success: true, sent: sentCount, bounced: bouncedCount });
  } catch (e) {
    console.error('[email-send/campaign] error:', e);

    // Try to reset campaign status on failure
    try {
      await fetch(`${PB_URL}/api/collections/email_campaigns/records/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'draft' }),
        cache: 'no-store',
      });
    } catch { /* best effort */ }

    return NextResponse.json({ success: false, error: 'Campaign send failed' }, { status: 500 });
  }
}

// --- Helpers ---

async function resolveAudience(
  audienceListId: string | null,
  exclusionListId: string | null
): Promise<Record<string, string>[]> {
  if (!audienceListId) return [];

  // Fetch the audience list
  const listRes = await fetch(
    `${PB_URL}/api/collections/email_lists/records/${audienceListId}`,
    { cache: 'no-store' }
  );
  if (!listRes.ok) return [];
  const list = await listRes.json();

  let companies: Record<string, string>[] = [];

  if (list.list_type === 'static' && list.company_ids) {
    // Static list: fetch companies by IDs
    const ids: string[] = typeof list.company_ids === 'string' ? JSON.parse(list.company_ids) : list.company_ids;
    for (const id of ids) {
      try {
        const res = await fetch(`${PB_URL}/api/collections/companies/records/${id}`, { cache: 'no-store' });
        if (res.ok) companies.push(await res.json());
      } catch { /* skip */ }
    }
  } else if (list.list_type === 'dynamic' && list.filter_json) {
    // Dynamic list: build PocketBase filter from filter_json
    const filterConfig = typeof list.filter_json === 'string' ? JSON.parse(list.filter_json) : list.filter_json;
    const pbFilter = buildDynamicFilter(filterConfig);
    const res = await fetch(
      `${PB_URL}/api/collections/companies/records?filter=${encodeURIComponent(pbFilter)}&perPage=500`,
      { cache: 'no-store' }
    );
    if (res.ok) {
      const data = await res.json();
      companies = data.items || [];
    }
  }

  // Filter: must have email, must not have do_not_contact
  companies = companies.filter(
    (c) => c.email && c.email.includes('@') && !c.do_not_contact
  );

  // Check suppression list (email_unsubscribes)
  const suppressedEmails = new Set<string>();
  try {
    const unsubRes = await fetch(
      `${PB_URL}/api/collections/email_unsubscribes/records?perPage=500`,
      { cache: 'no-store' }
    );
    if (unsubRes.ok) {
      const unsubData = await unsubRes.json();
      for (const u of unsubData.items || []) {
        if (u.email_address) suppressedEmails.add(u.email_address.toLowerCase());
      }
    }
  } catch { /* continue without suppression check */ }

  companies = companies.filter((c) => !suppressedEmails.has(c.email.toLowerCase()));

  // Apply exclusion list
  if (exclusionListId) {
    try {
      const exclRes = await fetch(
        `${PB_URL}/api/collections/email_lists/records/${exclusionListId}`,
        { cache: 'no-store' }
      );
      if (exclRes.ok) {
        const exclList = await exclRes.json();
        if (exclList.company_ids) {
          const exclIds = new Set(
            typeof exclList.company_ids === 'string' ? JSON.parse(exclList.company_ids) : exclList.company_ids
          );
          companies = companies.filter((c) => !exclIds.has(c.id));
        }
      }
    } catch { /* continue */ }
  }

  return companies;
}

function buildDynamicFilter(filterConfig: Record<string, unknown>): string {
  const conditions: string[] = [];

  if (filterConfig.status) {
    conditions.push(`status = '${filterConfig.status}'`);
  }
  if (filterConfig.source) {
    conditions.push(`source = '${filterConfig.source}'`);
  }
  if (filterConfig.has_email) {
    conditions.push(`email != ''`);
  }
  if (filterConfig.date_from) {
    conditions.push(`created >= '${filterConfig.date_from}'`);
  }
  if (filterConfig.date_to) {
    conditions.push(`created <= '${filterConfig.date_to}'`);
  }

  // Always exclude do_not_contact
  conditions.push(`do_not_contact != true`);

  return conditions.length > 0 ? conditions.join(' && ') : 'id != ""';
}

function resolveVariables(html: string, company: Record<string, string>): string {
  return html.replace(/\{\{(\w+)(?:\|([^}]*))?\}\}/g, (_match, varName: string, fallback: string) => {
    const key = varName.toLowerCase();
    const mapping: Record<string, string> = {
      company_name: company.company_name || '',
      owner_name: company.owner_name || '',
      email: company.email || '',
      status: Array.isArray(company.status) ? company.status.join(', ') : (company.status || ''),
      source: company.source || '',
      instagram_handle: company.instagram_handle || '',
      company_location: company.company_location || '',
      google_rating: company.google_rating || '',
    };
    const value = mapping[key] || '';
    return value || fallback || '';
  });
}

function injectTrackingPixel(html: string, trackingId: string): string {
  const pixel = `<img src="${APP_URL}/api/email-tracking/open/${trackingId}" width="1" height="1" style="display:none" alt="" />`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`);
  }
  return html + pixel;
}

function rewriteLinks(html: string, trackingId: string): string {
  // Rewrite <a href="..."> links (but not unsubscribe or tracking links)
  return html.replace(
    /<a\s([^>]*?)href="(https?:\/\/[^"]+)"([^>]*?)>/gi,
    (_match, before: string, url: string, after: string) => {
      // Don't rewrite tracking or unsubscribe links
      if (url.includes('/api/email-tracking/')) return _match;
      const encoded = Buffer.from(url).toString('base64');
      return `<a ${before}href="${APP_URL}/api/email-tracking/click/${trackingId}?url=${encoded}"${after}>`;
    }
  );
}

function addUnsubscribeLink(html: string, trackingId: string): string {
  const unsubLink = `${APP_URL}/api/email-tracking/unsubscribe/${trackingId}`;
  const footer = `<div style="text-align:center;padding:20px 0 10px;font-size:12px;color:#999;">
    <a href="${unsubLink}" style="color:#999;text-decoration:underline;">Unsubscribe</a>
  </div>`;
  if (html.includes('</body>')) {
    return html.replace('</body>', `${footer}</body>`);
  }
  return html + footer;
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  trackingId: string
): Promise<{ success: boolean; messageId?: string }> {
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${EMAIL_FROM_NAME} <${EMAIL_FROM_ADDRESS}>`,
        to: [to],
        subject,
        html,
        headers: { 'X-Tracking-Id': trackingId },
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[email-send/campaign] Resend error:', res.status, data);
      return { success: false };
    }

    return { success: true, messageId: data.id };
  } catch (e) {
    console.error('[email-send/campaign] send error:', e);
    return { success: false };
  }
}
