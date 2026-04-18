import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getPbAdmin } from '@/lib/pb-admin';

export const runtime = 'nodejs';

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  userAgent?: string;
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let body: SubscribeBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const auth = body.keys?.auth?.trim();

  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const pb = await getPbAdmin();
  if (!pb) return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });

  const data = {
    user: user.id,
    endpoint,
    p256dh,
    auth,
    user_agent: (body.userAgent || '').slice(0, 500),
  };

  try {
    const existing = await pb.collection('push_subscriptions').getFirstListItem(
      pb.filter('endpoint = {:endpoint}', { endpoint })
    ).catch(() => null);

    if (existing) {
      await pb.collection('push_subscriptions').update(existing.id, data);
    } else {
      await pb.collection('push_subscriptions').create(data);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[push/subscribe] failed:', err);
    return NextResponse.json({ error: 'persist_failed' }, { status: 500 });
  }
}
