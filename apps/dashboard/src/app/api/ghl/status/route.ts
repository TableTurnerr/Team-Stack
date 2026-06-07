import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { getStatus } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  try {
    const status = await getStatus(auth.user.id);
    return NextResponse.json(status);
  } catch (e) {
    return ghlError(e);
  }
}
