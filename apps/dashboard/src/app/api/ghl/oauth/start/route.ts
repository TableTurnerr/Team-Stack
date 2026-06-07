import { NextResponse } from 'next/server';
import { requireUser, ghlError } from '@/lib/ghl-route';
import { buildAuthorizeUrl, signState } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Called (with the dashboard Bearer token) from the /connect page. Returns the
// GHL authorize URL carrying a signed state so the callback knows which user
// initiated the install. The page then navigates the tab to that URL.
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (auth.error) return auth.error;
  try {
    const state = signState(auth.user.id);
    return NextResponse.json({ authorizeUrl: buildAuthorizeUrl(state) });
  } catch (e) {
    return ghlError(e);
  }
}
