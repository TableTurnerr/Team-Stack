import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { listLeadScrapingSessions, upsertLeadScrapingSession } from '@/lib/lead-scraping-sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// List the current user's saved scraping sessions (campaigns). These live under
// the authenticated TableTurnerr/PocketBase account so full resume payloads are
// available from any device signed in as the same user.
export async function GET(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  await params;
  try {
    const sessions = await listLeadScrapingSessions(auth.user.id);
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
    const session = await upsertLeadScrapingSession(auth.user.id, loc, body.session);
    return NextResponse.json({ session });
  } catch (e) {
    return ghlError(e);
  }
}
