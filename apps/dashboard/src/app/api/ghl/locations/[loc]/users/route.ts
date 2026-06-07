import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { listUsers } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;
  try {
    const users = await listUsers(auth.user.id, loc);
    return NextResponse.json({ users });
  } catch (e) {
    return ghlError(e);
  }
}
