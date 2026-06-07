import { NextResponse } from 'next/server';
import { verifyState, exchangeCode, saveConnection } from '@/lib/ghl';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GHL redirects the browser here after the user authorizes the app into a
// sub-account. No Bearer token is present; we recover the dashboard user from the
// signed state. The token is already scoped to the chosen location.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state');

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/connect?ghl=error&reason=${encodeURIComponent(reason)}`, request.url));

  if (!code || !state) return fail('missing_code');

  const userId = verifyState(state);
  if (!userId) return fail('bad_state');

  try {
    const tokens = await exchangeCode(code);
    await saveConnection(userId, tokens);
    return NextResponse.redirect(new URL('/connect?ghl=connected', request.url));
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'exchange_failed';
    return fail(msg);
  }
}
