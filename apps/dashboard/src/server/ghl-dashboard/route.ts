import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/api-auth';
import { DashboardGhlError } from './models';

export async function requireDashboardUser(request: Request) {
  const user = await authenticateRequest(request);
  if (!user) return { error: NextResponse.json({ code: 'unauthorized', error: 'Your session has expired.' }, { status: 401 }) };
  return { user };
}

const messages: Record<string, string> = {
  ghl_not_configured: 'The GHL dashboard connection has not been configured.',
  ghl_invalid_configuration: 'The GHL dashboard configuration is invalid.',
  ghl_unauthorized: 'GHL rejected the private integration token.',
  ghl_forbidden: 'The GHL private integration is missing a required scope.',
  ghl_rate_limited: 'GHL is rate limiting requests. Wait briefly and retry.',
  ghl_timeout: 'GHL did not respond before the request timed out.',
  validation_failed: 'Check the highlighted fields.',
  attribution_store_unavailable: 'Lead attribution storage is unavailable. No GHL write was attempted.',
  ghl_user_not_matched: 'Your Tableturnerr email does not match a user in this GHL sub-account.',
  ghl_user_not_found: 'No GHL user was found with that user ID.',
  ghl_user_wrong_location: 'That GHL user does not belong to the configured sub-account.',
  invalid_ghl_user_id: 'Enter a valid GHL user ID.',
};

export function dashboardRouteError(error: unknown) {
  const known = error instanceof DashboardGhlError ? error : new DashboardGhlError('ghl_upstream_error');
  return NextResponse.json({
    code: known.code,
    error: messages[known.code] || known.code.replaceAll('_', ' '),
    fields: known.details,
    retryAfter: known.retryAfter,
  }, {
    status: known.status,
    headers: known.retryAfter ? { 'Retry-After': String(known.retryAfter) } : undefined,
  });
}
