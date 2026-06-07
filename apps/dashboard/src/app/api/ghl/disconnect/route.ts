import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { disconnect } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Pass ?location=<id> to disconnect a single sub-account; omit it to disconnect
// every sub-account the user has connected.
export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  try {
    const locationId = new URL(request.url).searchParams.get('location') || undefined;
    await disconnect(auth.user.id, locationId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return ghlError(e);
  }
}
