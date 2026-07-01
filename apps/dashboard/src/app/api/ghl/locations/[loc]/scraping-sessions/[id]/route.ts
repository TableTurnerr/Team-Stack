import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { deleteScrapingSession } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delete one saved scraping session by its GHL record id (ownership re-checked).
export async function DELETE(request: Request, { params }: { params: Promise<{ loc: string; id: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc, id } = await params;
  try {
    await deleteScrapingSession(auth.user.id, loc, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return ghlError(e);
  }
}
