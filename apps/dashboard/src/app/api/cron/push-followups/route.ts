import { NextResponse } from 'next/server';
import { getPbAdmin } from '@/lib/pb-admin';
import { sendPushToSubscription, isPushConfigured, type StoredSubscription } from '@/lib/push-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CRON_SECRET = process.env.CRON_SECRET || '';

// Window extends slightly into the future so a cron running at :00 catches
// follow-ups due at :00:30. Keep in sync with cron schedule (every minute).
const LOOKAHEAD_MS = 60 * 1000;
// Don't send pushes for follow-ups that are already very overdue
// (likely already handled in-app when they were due).
const MAX_OVERDUE_MS = 10 * 60 * 1000;

interface FollowUpRecord {
  id: string;
  company: string;
  assigned_to?: string;
  created_by?: string;
  notes?: string;
  scheduled_time: string;
  expand?: { company?: { company_name?: string } };
}

function authorized(request: Request): boolean {
  if (!CRON_SECRET) return false;
  const auth = request.headers.get('authorization') || request.headers.get('Authorization');
  if (auth === `Bearer ${CRON_SECRET}`) return true;
  // Vercel cron also supports header-less invocation via the Vercel-Cron header
  // when CRON_SECRET is not in use; we require the secret explicitly.
  return false;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isPushConfigured()) {
    return NextResponse.json({ error: 'push_unconfigured' }, { status: 503 });
  }

  const pb = await getPbAdmin();
  if (!pb) return NextResponse.json({ error: 'pb_unavailable' }, { status: 503 });

  const now = Date.now();
  const windowEndIso = new Date(now + LOOKAHEAD_MS).toISOString();
  const windowStartIso = new Date(now - MAX_OVERDUE_MS).toISOString();

  let followUps: FollowUpRecord[] = [];
  try {
    followUps = await pb.collection('follow_ups').getFullList<FollowUpRecord>({
      filter: pb.filter(
        'status = "pending" && reminder_sent != true && scheduled_time >= {:start} && scheduled_time <= {:end}',
        { start: windowStartIso, end: windowEndIso }
      ),
      expand: 'company',
      sort: 'scheduled_time',
    });
  } catch (err) {
    console.error('[cron/push-followups] query failed', err);
    return NextResponse.json({ error: 'query_failed' }, { status: 500 });
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const fu of followUps) {
    const userId = fu.assigned_to || fu.created_by;
    if (!userId) { skipped++; continue; }

    let subs: StoredSubscription[] = [];
    try {
      subs = await pb.collection('push_subscriptions').getFullList<StoredSubscription>({
        filter: pb.filter('user = {:user}', { user: userId }),
      });
    } catch (err) {
      console.error('[cron/push-followups] subs query failed', err);
    }

    if (subs.length === 0) { skipped++; }

    const companyName = fu.expand?.company?.company_name || 'a company';
    const payload = {
      title: `Follow-up due: ${companyName}`,
      body: fu.notes?.slice(0, 180) || `Scheduled follow-up is due now.`,
      tag: `followup-${fu.id}`,
      requireInteraction: true,
      data: { url: `/session?followup=${fu.id}`, followUpId: fu.id },
    };

    for (const sub of subs) {
      const res = await sendPushToSubscription(sub, payload, pb);
      if (res.ok) sent++;
      else failed++;
    }

    try {
      await pb.collection('follow_ups').update(fu.id, { reminder_sent: true });
    } catch (err) {
      console.error('[cron/push-followups] update reminder_sent failed', fu.id, err);
    }
  }

  return NextResponse.json({
    ok: true,
    checked: followUps.length,
    sent,
    failed,
    skipped,
  });
}
