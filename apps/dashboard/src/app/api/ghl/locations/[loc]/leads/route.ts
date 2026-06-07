import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { sendLead, type LeadPayload } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Composite send used by the Lead Scraper extension: upserts the contact,
// attaches the note, and (optionally) creates an opportunity in one call.
export async function POST(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;

  let body: LeadPayload;
  try {
    body = (await request.json()) as LeadPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body || !body.contact) {
    return NextResponse.json({ error: 'missing_contact' }, { status: 400 });
  }

  try {
    const result = await sendLead(auth.user.id, loc, body);
    return NextResponse.json(result);
  } catch (e) {
    return ghlError(e);
  }
}
