import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { deleteLeadScrapingSession } from '@/lib/lead-scraping-sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Delete one saved scraping session by its client session id (ownership re-checked).
export async function DELETE(request: Request, { params }: { params: Promise<{ loc: string; id: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { id } = await params;
  try {
    await deleteLeadScrapingSession(auth.user.id, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return ghlError(e);
  }
}
