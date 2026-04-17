import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getPbAdmin } from '@/lib/pb-admin';
import { cancelFollowUpPush } from '@/lib/qstash';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  followUpId?: string;
}

interface FollowUpRecord {
  id: string;
  qstash_message_id?: string;
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

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
    return NextResponse.json({ ok: true, skipped: 'not_found' });
  }

  if (!fu.qstash_message_id) return NextResponse.json({ ok: true, skipped: 'no_message' });

  await cancelFollowUpPush(fu.qstash_message_id);

  try {
    await pb.collection('follow_ups').update(fu.id, { qstash_message_id: '' });
  } catch { /* ignore */ }

  return NextResponse.json({ ok: true });
}
