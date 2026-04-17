import { NextResponse } from 'next/server';
import { getPbAdmin } from '@/lib/pb-admin';
import { getReceiver } from '@/lib/qstash';
import { sendPushToSubscription, isPushConfigured, type StoredSubscription } from '@/lib/push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FollowUpRecord {
  id: string;
  company: string;
  assigned_to?: string;
  created_by?: string;
  notes?: string;
  scheduled_time: string;
  status: string;
  reminder_sent?: boolean;
  expand?: { company?: { company_name?: string } };
}

interface Body {
  followUpId?: string;
}

export async function POST(request: Request) {
  const receiver = getReceiver();
  if (!receiver) {
    return NextResponse.json({ error: 'qstash_unconfigured' }, { status: 503 });
  }

  const signature = request.headers.get('upstash-signature') || '';
  const rawBody = await request.text();

  try {
    await receiver.verify({ signature, body: rawBody });
  } catch {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let parsed: Body;
  try {
    parsed = JSON.parse(rawBody) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const followUpId = parsed.followUpId;
  if (!followUpId) return NextResponse.json({ error: 'missing_follow_up_id' }, { status: 400 });

  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'push_unconfigured' }, { status: 503 });
  }

  const pb = await getPbAdmin();
  if (!pb) return NextResponse.json({ error: 'pb_unavailable' }, { status: 503 });

  let fu: FollowUpRecord;
  try {
    fu = await pb.collection('follow_ups').getOne<FollowUpRecord>(followUpId, { expand: 'company' });
  } catch {
    return NextResponse.json({ ok: true, skipped: 'not_found' });
  }

  if (fu.status !== 'pending' || fu.reminder_sent) {
    return NextResponse.json({ ok: true, skipped: 'stale' });
  }

  const userId = fu.assigned_to || fu.created_by;
  if (!userId) return NextResponse.json({ ok: true, skipped: 'no_user' });

  let subs: StoredSubscription[] = [];
  try {
    subs = await pb.collection('push_subscriptions').getFullList<StoredSubscription>({
      filter: pb.filter('user = {:user}', { user: userId }),
    });
  } catch (err) {
    console.error('[qstash/push-followup] subs query failed', err);
  }

  const companyName = fu.expand?.company?.company_name || 'a company';
  const payload = {
    title: `Follow-up due: ${companyName}`,
    body: fu.notes?.slice(0, 180) || 'Scheduled follow-up is due now.',
    tag: `followup-${fu.id}`,
    requireInteraction: true,
    data: { url: `/session?followup=${fu.id}`, followUpId: fu.id },
  };

  let sent = 0;
  let failed = 0;
  for (const sub of subs) {
    const res = await sendPushToSubscription(sub, payload, pb);
    if (res.ok) sent++;
    else failed++;
  }

  try {
    await pb.collection('follow_ups').update(fu.id, { reminder_sent: true, qstash_message_id: '' });
  } catch (err) {
    console.error('[qstash/push-followup] update reminder_sent failed', fu.id, err);
  }

  return NextResponse.json({ ok: true, sent, failed, subscriptions: subs.length });
}
