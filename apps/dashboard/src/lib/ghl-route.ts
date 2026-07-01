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

// Friendly text for the codes thrown by lib/ghl. The extension shows `error`
// to the user; `code` stays stable for any programmatic handling.
const GHL_ERROR_MESSAGES: Record<string, string> = {
  not_connected: 'This sub-account isn’t connected. Open the extension popup and reconnect it.',
  reauth_required: 'The GoHighLevel session for this sub-account expired. Reconnect it from the popup.',
  pb_unavailable: 'The backend datastore is temporarily unavailable. Please try again shortly.',
  pb_read_failed: 'Couldn’t read the connection from the backend datastore. Please try again shortly.',
  scraping_object_setup_required: 'Scraping sessions storage isn’t set up in this sub-account yet. Reconnect GoHighLevel (to grant custom-object access), or ask an admin to add a “TT Scraping Session” custom object with a “Payload” large-text field.',
  session_not_found: 'That saved session no longer exists.',
  missing_session_id: 'The session is missing an id.',
};

export function ghlError(e: unknown): NextResponse {
  const code = e instanceof Error ? e.message : 'ghl_error';
  const status =
    code === 'not_connected' || code === 'reauth_required' ? 409 :
    code === 'scraping_object_setup_required' ? 409 :
    code === 'session_not_found' ? 404 :
    code === 'missing_session_id' ? 400 :
    code === 'pb_unavailable' || code === 'pb_read_failed' ? 503 :
    502;
  return NextResponse.json({ error: GHL_ERROR_MESSAGES[code] || code, code }, { status });
}
