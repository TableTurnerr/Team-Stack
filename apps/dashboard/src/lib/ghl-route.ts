// Shared helpers for the /api/ghl/* route handlers: Bearer auth + error mapping.
import { NextResponse } from 'next/server';
import { authenticateRequest } from './api-auth';
import { isConfigured } from './ghl';

export async function requireUser(
  request: Request,
): Promise<{ user: { id: string; email: string }; error?: undefined } | { user?: undefined; error: NextResponse }> {
  if (!isConfigured()) {
    return { error: NextResponse.json({ error: 'ghl_not_configured' }, { status: 500 }) };
  }
  const user = await authenticateRequest(request);
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { user };
}

export function ghlError(e: unknown): NextResponse {
  const msg = e instanceof Error ? e.message : 'ghl_error';
  const status = msg === 'not_connected' ? 409 : msg === 'pb_unavailable' ? 503 : 502;
  return NextResponse.json({ error: msg }, { status });
}
