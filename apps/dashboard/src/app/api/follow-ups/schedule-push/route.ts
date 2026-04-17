import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getPbAdmin } from '@/lib/pb-admin';
import { scheduleFollowUpPush, cancelFollowUpPush, isQstashConfigured } from '@/lib/qstash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  followUpId?: string;
}

interface FollowUpRecord {
  id: string;
  scheduled_time: string;
  status: string;
  qstash_message_id?: string;
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!isQstashConfigured()) {
    return NextResponse.json({ ok: true, skipped: 'qstash_unconfigured' });
  }

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const followUpId = body.followUpId?.trim();
  if (!followUpId) return NextResponse.json({ error: 'missing_follow_up_id' }, { status: 400 });

  const pb = await getPbAdmin();
  if (!pb) return NextResponse.json({ error: 'pb_unavailable' }, { status: 503 });

  let fu: FollowUpRecord;
  try {
    fu = await pb.collection('follow_ups').getOne<FollowUpRecord>(followUpId);
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  if (fu.status !== 'pending') {
    return NextResponse.json({ ok: true, skipped: 'not_pending' });
  }

  if (fu.qstash_message_id) {
    await cancelFollowUpPush(fu.qstash_message_id);
  }

  const result = await scheduleFollowUpPush(fu.id, fu.scheduled_time);

  if ('skipped' in result) {
    if (fu.qstash_message_id) {
      try { await pb.collection('follow_ups').update(fu.id, { qstash_message_id: '' }); } catch { /* ignore */ }
    }
    return NextResponse.json({ ok: true, skipped: result.skipped });
  }

  try {
    await pb.collection('follow_ups').update(fu.id, { qstash_message_id: result.messageId });
  } catch (err) {
    console.error('[follow-ups/schedule-push] persist messageId failed', err);
  }

  return NextResponse.json({ ok: true, messageId: result.messageId });
}
