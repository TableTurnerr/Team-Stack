// GoHighLevel (LeadConnector) API v2 helper.
// ---------------------------------------------------------------------------
// Powers the /api/ghl/* proxy used by the Lead Scraper Chrome extension. This
// uses a SUB-ACCOUNT (Location) level Marketplace app: the user installs the app
// into one sub-account at a time (user_type=Location), and each install returns
// an OAuth token already scoped to that single location. We store one connection
// row per (dashboard user, location), so a user can connect several sub-accounts
// by running the install once per sub-account.
//
// There is no agency token and no /oauth/locationToken minting: the stored
// access_token IS the location token. All contact/opportunity calls use it
// directly + the `Version: 2021-07-28` header. The sub-account list the extension
// shows is simply the set of locations the user has connected.
// ---------------------------------------------------------------------------
import crypto from 'crypto';
import type PocketBase from 'pocketbase';
import { getPbAdmin } from './pb-admin';

export const GHL_API = 'https://services.leadconnectorhq.com';
export const GHL_VERSION = '2021-07-28';
export const GHL_AUTHORIZE = 'https://marketplace.leadconnectorhq.com/oauth/chooselocation';
export const GHL_SCOPES = [
  'locations.readonly',
  'locations/tags.readonly',
  'locations/tags.write',
  'contacts.readonly',
  'contacts.write',
  'opportunities.readonly',
  'opportunities.write',
  'users.readonly',
].join(' ');

const CLIENT_ID = process.env.GHL_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GHL_CLIENT_SECRET || '';
export const GHL_REDIRECT_URI = process.env.GHL_REDIRECT_URI || '';
const STATE_SECRET = process.env.GHL_STATE_SECRET || CLIENT_SECRET || 'ghl-state-secret';

export function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET && GHL_REDIRECT_URI);
}

// ---- OAuth state signing (stateless; no DB row needed) --------------------
// state = base64url("<userId>.<expEpoch>.<hmac>") so the callback can recover
// which dashboard user initiated the connect without a server-side session.
export function signState(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + 600; // 10 min
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac('sha256', STATE_SECRET).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}

export function verifyState(state: string): string | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf-8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [userId, exp, sig] = parts;
    const expected = crypto.createHmac('sha256', STATE_SECRET).update(`${userId}.${exp}`).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    if (Number(exp) * 1000 < Date.now()) return null;
    return userId;
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state: string): string {
  const qs = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: GHL_REDIRECT_URI,
    scope: GHL_SCOPES,
    state,
  });
  return `${GHL_AUTHORIZE}?${qs.toString()}`;
}

// ---- Token endpoints (form-urlencoded) ------------------------------------
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope?: string;
  companyId?: string;
  locationId?: string;
  userId?: string;
  userType?: string;
}

async function postForm(path: string, form: Record<string, string>, bearer?: string): Promise<TokenResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
    headers.Version = GHL_VERSION;
  }
  const res = await fetch(`${GHL_API}${path}`, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString(),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json as { message?: string } | null)?.message || `HTTP ${res.status}`;
    throw new Error(`GHL token error: ${msg}`);
  }
  return json as TokenResponse;
}

export function exchangeCode(code: string): Promise<TokenResponse> {
  return postForm('/oauth/token', {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: GHL_REDIRECT_URI,
    user_type: 'Location',
  });
}

function refreshLocationToken(refreshToken: string): Promise<TokenResponse> {
  return postForm('/oauth/token', {
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    user_type: 'Location',
  });
}

// ---- Connection storage (ghl_connections collection) ----------------------
// One row per (user, location_id). A user can hold several rows, one per
// connected sub-account.
export interface GhlConnection {
  id: string;
  user: string;
  company_id: string;
  location_id: string;
  location_name: string;
  access_token: string;
  refresh_token: string;
  token_expires: string;
  ghl_user_id?: string;
}

async function listConnectionRecords(pb: PocketBase, userId: string): Promise<GhlConnection[]> {
  try {
    const recs = await pb
      .collection('ghl_connections')
      .getFullList({ filter: pb.filter('user = {:user}', { user: userId }), sort: 'location_name' });
    return recs as unknown as GhlConnection[];
  } catch {
    return [];
  }
}

async function getConnectionRecord(pb: PocketBase, userId: string, locationId: string): Promise<GhlConnection | null> {
  try {
    const rec = await pb
      .collection('ghl_connections')
      .getFirstListItem(pb.filter('user = {:user} && location_id = {:loc}', { user: userId, loc: locationId }));
    return rec as unknown as GhlConnection;
  } catch {
    return null;
  }
}

export async function listConnections(userId: string): Promise<GhlConnection[]> {
  const pb = await getPbAdmin();
  if (!pb) return [];
  return listConnectionRecords(pb, userId);
}

// Look up the location's display name with its freshly-issued token. Best-effort:
// falls back to the id if the read fails, so a connect never breaks on naming.
async function fetchLocationName(token: string, locationId: string): Promise<string> {
  try {
    const res = await ghlFetch<{ location?: { name?: string }; name?: string }>(
      token, 'GET', `/locations/${locationId}`,
    );
    return res.data?.location?.name || res.data?.name || locationId;
  } catch {
    return locationId;
  }
}

// Persist (or refresh) the connection for the sub-account this token belongs to.
export async function saveConnection(userId: string, t: TokenResponse): Promise<void> {
  const pb = await getPbAdmin();
  if (!pb) throw new Error('pb_unavailable');
  const locationId = t.locationId || '';
  if (!locationId) throw new Error('no_location_in_token');
  const locationName = await fetchLocationName(t.access_token, locationId);
  const data = {
    user: userId,
    company_id: t.companyId || '',
    location_id: locationId,
    location_name: locationName,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    token_expires: new Date(Date.now() + (t.expires_in || 86399) * 1000).toISOString(),
    ghl_user_id: t.userId || '',
  };
  const existing = await getConnectionRecord(pb, userId, locationId);
  if (existing) {
    await pb.collection('ghl_connections').update(existing.id, data);
  } else {
    await pb.collection('ghl_connections').create(data);
  }
}

// Remove one sub-account connection, or all of the user's connections when no
// locationId is given.
export async function disconnect(userId: string, locationId?: string): Promise<void> {
  const pb = await getPbAdmin();
  if (!pb) return;
  if (locationId) {
    const existing = await getConnectionRecord(pb, userId, locationId);
    if (existing) await pb.collection('ghl_connections').delete(existing.id);
    return;
  }
  const all = await listConnectionRecords(pb, userId);
  for (const rec of all) {
    await pb.collection('ghl_connections').delete(rec.id).catch(() => null);
  }
}

// Returns a valid (refreshed if needed) location access token for one sub-account.
async function getValidLocationToken(userId: string, locationId: string): Promise<string> {
  const pb = await getPbAdmin();
  if (!pb) throw new Error('pb_unavailable');
  const conn = await getConnectionRecord(pb, userId, locationId);
  if (!conn) throw new Error('not_connected');

  const expMs = new Date(conn.token_expires).getTime();
  if (Number.isFinite(expMs) && expMs - Date.now() > 120_000) {
    return conn.access_token;
  }

  // Refresh (refresh tokens rotate — persist the new one).
  const t = await refreshLocationToken(conn.refresh_token);
  await pb.collection('ghl_connections').update(conn.id, {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    token_expires: new Date(Date.now() + (t.expires_in || 86399) * 1000).toISOString(),
    company_id: t.companyId || conn.company_id,
  });
  return t.access_token;
}

// ---- Generic data fetch ----------------------------------------------------
interface GhlResult<T> { ok: boolean; status: number; data: T | null; error?: string }

async function ghlFetch<T = unknown>(
  token: string,
  method: string,
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<GhlResult<T>> {
  let url = `${GHL_API}${path}`;
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) if (v != null && v !== '') qs.set(k, v);
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: 'application/json',
  };
  const init: RequestInit = { method, headers, cache: 'no-store' };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (json as { message?: string } | null)?.message || `HTTP ${res.status}`;
    return { ok: false, status: res.status, data: json as T, error: msg };
  }
  return { ok: true, status: res.status, data: json as T };
}

// ---- High-level operations used by the routes -----------------------------
export interface NamedItem { id: string; name: string }

export async function getStatus(userId: string): Promise<{ connected: boolean; agencyName: string; email: string }> {
  const conns = await listConnections(userId);
  const names = conns.map((c) => c.location_name || c.location_id).filter(Boolean);
  const summary = names.length > 1 ? `${names.length} sub-accounts` : (names[0] || '');
  return { connected: conns.length > 0, agencyName: summary, email: conns[0]?.ghl_user_id || '' };
}

// The "sub-accounts" the extension can target are exactly the ones the user has
// connected. No agency-wide enumeration with a location-level app.
export async function listLocations(userId: string): Promise<NamedItem[]> {
  const conns = await listConnections(userId);
  return conns.map((c) => ({ id: c.location_id, name: c.location_name || c.location_id }));
}

export async function listUsers(userId: string, locationId: string): Promise<Array<NamedItem & { email: string }>> {
  const token = await getValidLocationToken(userId, locationId);
  const res = await ghlFetch<{ users?: Array<{ id: string; name?: string; firstName?: string; lastName?: string; email?: string }> }>(
    token, 'GET', '/users/search', { query: { locationId } },
  );
  if (!res.ok || !res.data) throw new Error(res.error || 'failed_to_list_users');
  return (res.data.users || []).map((u) => ({
    id: u.id,
    name: u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || u.id,
    email: u.email || '',
  }));
}

export async function listPipelines(userId: string, locationId: string): Promise<Array<NamedItem & { stages: NamedItem[] }>> {
  const token = await getValidLocationToken(userId, locationId);
  const res = await ghlFetch<{ pipelines?: Array<{ id: string; name?: string; stages?: Array<{ id: string; name?: string }> }> }>(
    token, 'GET', '/opportunities/pipelines', { query: { locationId } },
  );
  if (!res.ok || !res.data) throw new Error(res.error || 'failed_to_list_pipelines');
  return (res.data.pipelines || []).map((p) => ({
    id: p.id,
    name: p.name || p.id,
    stages: (p.stages || []).map((s) => ({ id: s.id, name: s.name || s.id })),
  }));
}

export async function listTags(userId: string, locationId: string): Promise<NamedItem[]> {
  const token = await getValidLocationToken(userId, locationId);
  const res = await ghlFetch<{ tags?: Array<{ id?: string; name: string }> }>(
    token, 'GET', `/locations/${locationId}/tags`,
  );
  if (!res.ok || !res.data) throw new Error(res.error || 'failed_to_list_tags');
  return (res.data.tags || []).map((t) => ({ id: t.id || t.name, name: t.name }));
}

// Create a tag in the sub-account. GHL returns { tag: { id, name, locationId } };
// we normalise to the same { id, name } shape listTags returns.
export async function createTag(userId: string, locationId: string, name: string): Promise<NamedItem> {
  const clean = name.trim();
  if (!clean) throw new Error('empty_tag_name');
  const token = await getValidLocationToken(userId, locationId);
  const res = await ghlFetch<{ tag?: { id?: string; name?: string } }>(
    token, 'POST', `/locations/${locationId}/tags`, { body: { name: clean } },
  );
  if (!res.ok || !res.data) throw new Error(res.error || 'failed_to_create_tag');
  const t = res.data.tag || {};
  return { id: t.id || t.name || clean, name: t.name || clean };
}

export async function listCustomFields(userId: string, locationId: string): Promise<Array<NamedItem & { fieldKey: string }>> {
  const token = await getValidLocationToken(userId, locationId);
  const res = await ghlFetch<{ customFields?: Array<{ id: string; name?: string; fieldKey?: string }> }>(
    token, 'GET', `/locations/${locationId}/customFields`,
  );
  if (!res.ok || !res.data) throw new Error(res.error || 'failed_to_list_custom_fields');
  return (res.data.customFields || []).map((f) => ({ id: f.id, name: f.name || f.id, fieldKey: f.fieldKey || '' }));
}

export async function checkDuplicate(userId: string, locationId: string, phone?: string, email?: string): Promise<{ exists: boolean; contactId: string | null }> {
  if (!phone && !email) return { exists: false, contactId: null };
  const token = await getValidLocationToken(userId, locationId);
  const res = await ghlFetch<{ contact?: { id?: string } | null; id?: string }>(
    token, 'GET', '/contacts/search/duplicate', { query: { locationId, number: phone, email } },
  );
  // Any non-OK (incl. 404 "no duplicate") -> treat as not found so a flaky check
  // never blocks a send. Tolerate both { contact: { id } } and a bare { id }.
  if (!res.ok || !res.data) return { exists: false, contactId: null };
  const contactId = res.data.contact?.id || res.data.id || null;
  return { exists: Boolean(contactId), contactId };
}

// ---- Composite lead send (contact upsert + note + opportunity) -------------
export interface LeadPayload {
  contact: {
    name?: string;
    companyName?: string;
    firstName?: string;
    phone?: string;
    email?: string;
    address1?: string;
    city?: string;
    website?: string;
    source?: string;
    tags?: string[];
    assignedTo?: string;
    customFields?: Array<{ id: string; field_value: string }>;
  };
  note?: string;
  opportunity?: {
    create?: boolean;
    pipelineId?: string;
    stageId?: string;
    name?: string;
    status?: string;
    monetaryValue?: number;
    assignedTo?: string;
  };
}

export interface LeadResult {
  contactId: string | null;
  opportunityId: string | null;
  duplicate: boolean;
  status: 'created' | 'updated' | 'skipped';
}

export async function sendLead(userId: string, locationId: string, payload: LeadPayload): Promise<LeadResult> {
  const token = await getValidLocationToken(userId, locationId);

  // Upsert honours the sub-account "allow duplicate" setting (email-first, then
  // phone) and returns { new, contact } so we can report created vs updated.
  const body = { locationId, ...payload.contact };
  const up = await ghlFetch<{ new?: boolean; contact?: { id: string } }>(
    token, 'POST', '/contacts/upsert', { body },
  );
  if (!up.ok || !up.data?.contact?.id) {
    throw new Error(up.error || 'failed_to_upsert_contact');
  }
  const contactId = up.data.contact.id;
  const isNew = up.data.new !== false;

  // Note (best-effort — never fail the whole send because a note didn't stick).
  if (payload.note && payload.note.trim()) {
    await ghlFetch(token, 'POST', `/contacts/${contactId}/notes`, { body: { body: payload.note } }).catch(() => null);
  }

  // Opportunity (optional).
  let opportunityId: string | null = null;
  const opp = payload.opportunity;
  if (opp?.create && opp.pipelineId && opp.stageId) {
    const oppRes = await ghlFetch<{ opportunity?: { id: string }; id?: string }>(
      token, 'POST', '/opportunities/', {
        body: {
          locationId,
          pipelineId: opp.pipelineId,
          pipelineStageId: opp.stageId,
          name: opp.name || payload.contact.name || 'New Lead',
          status: opp.status || 'open',
          contactId,
          monetaryValue: opp.monetaryValue || 0,
          ...(opp.assignedTo ? { assignedTo: opp.assignedTo } : {}),
        },
      },
    );
    opportunityId = oppRes.data?.opportunity?.id || oppRes.data?.id || null;
  }

  return {
    contactId,
    opportunityId,
    duplicate: !isNew,
    status: isNew ? 'created' : 'updated',
  };
}
