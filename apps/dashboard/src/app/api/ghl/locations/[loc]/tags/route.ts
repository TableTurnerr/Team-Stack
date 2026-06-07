import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { listTags, createTag } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;
  try {
    const tags = await listTags(auth.user.id, loc);
    return NextResponse.json({ tags });
  } catch (e) {
    return ghlError(e);
  }
}

// Create a tag from the extension's "+ Create new tag…" picker option.
export async function POST(request: Request, { params }: { params: Promise<{ loc: string }> }) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  const { loc } = await params;

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const name = (body?.name || '').trim();
  if (!name) {
    return NextResponse.json({ error: 'missing_name' }, { status: 400 });
  }

  try {
    const tag = await createTag(auth.user.id, loc, name);
    return NextResponse.json({ tag });
  } catch (e) {
    return ghlError(e);
  }
}
