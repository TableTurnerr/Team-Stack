import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { listScrapingSessions, upsertScrapingSession } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// List the current user's saved scraping sessions (campaigns) in a sub-account.
// These live on a GHL custom object, scoped to the authenticated user — separate
// from the contacts/opportunities the extension pushes as leads.
export async function GET(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;
  try {
    const sessions = await listScrapingSessions(auth.user.id, loc);
    return NextResponse.json({ sessions });
  } catch (e) {
    return ghlError(e);
  }
}

// Create or update one saved session (idempotent by the extension's client id).
export async function POST(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;

  let body: { session?: Record<string, unknown> };
  try {
    body = (await request.json()) as { session?: Record<string, unknown> };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body?.session || typeof body.session !== 'object') {
    return NextResponse.json({ error: 'missing_session' }, { status: 400 });
  }

  try {
    const session = await upsertScrapingSession(auth.user.id, loc, body.session);
    return NextResponse.json({ session });
  } catch (e) {
    return ghlError(e);
  }
}
