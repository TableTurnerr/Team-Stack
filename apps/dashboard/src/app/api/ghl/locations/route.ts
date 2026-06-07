import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { listLocations } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  try {
    const locations = await listLocations(auth.user.id);
    return NextResponse.json({ locations });
  } catch (e) {
    return ghlError(e);
  }
}
