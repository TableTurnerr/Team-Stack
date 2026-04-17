import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { getPbAdmin } from '@/lib/pb-admin';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let endpoint = '';
  try {
    const body = await request.json();
    endpoint = typeof body?.endpoint === 'string' ? body.endpoint.trim() : '';
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ error: 'missing_endpoint' }, { status: 400 });

  const pb = await getPbAdmin();
  if (!pb) return NextResponse.json({ error: 'server_misconfigured' }, { status: 500 });

  try {
    const existing = await pb.collection('push_subscriptions').getFirstListItem(
      pb.filter('endpoint = {:endpoint} && user = {:user}', { endpoint, user: user.id })
    ).catch(() => null);
    if (existing) await pb.collection('push_subscriptions').delete(existing.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[push/unsubscribe] failed:', err);
    return NextResponse.json({ error: 'delete_failed' }, { status: 500 });
  }
}
