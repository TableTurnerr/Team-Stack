import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { checkDuplicate } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;
  const { searchParams } = new URL(request.url);
  const phone = searchParams.get('phone') || undefined;
  const email = searchParams.get('email') || undefined;
  try {
    const result = await checkDuplicate(auth.user.id, loc, phone, email);
    return NextResponse.json(result);
  } catch (e) {
    return ghlError(e);
  }
}
