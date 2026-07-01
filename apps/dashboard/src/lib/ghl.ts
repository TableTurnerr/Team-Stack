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
  // Custom objects — the Lead Scraper's saved scraping sessions live on a custom
  // object (see the "Scraping sessions" section below). Users connected before
  // these scopes were added must reconnect for sessions to work. The Marketplace
  // app must also have these scopes enabled.
  'objects/schema.readonly',
  'objects/schema.write',
  'objects/record.readonly',
  'objects/record.write',
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
  } catch (e) {
    // PocketBase throws 404 when nothing matches — that is a genuine "no
    // connection". Any other error (network, 5xx, expired admin auth) is a READ
    // FAILURE and must NOT be reported as not_connected, or a transient blip
    // looks like "you never connected this sub-account". Surface it distinctly.
    const status = (e && typeof e === 'object' && 'status' in e) ? (e as { status?: number }).status : undefined;
    if (status === 404) return null;
    throw new Error('pb_read_failed');
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

// In-flight refreshes, keyed by user:location. GHL refresh tokens are single-use
// and rotate on every refresh, so two concurrent refreshes with the same stored
// token race: the first rotates it, the rest present an already-consumed token and
// fail (and can clobber the freshly-saved row). A burst of parallel calls — e.g.
// the extension fetching users+pipelines+tags+duplicates at once — hits exactly
// that. Coalescing all concurrent refreshes for one sub-account onto a single
// promise means one refresh call, one DB write, and everyone gets the new token.
const refreshInFlight = new Map<string, Promise<string>>();

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

  const key = `${userId}:${locationId}`;
  let pending = refreshInFlight.get(key);
  if (!pending) {
    pending = (async () => {
      let t: TokenResponse;
      try {
        // Refresh (refresh tokens rotate — persist the new one).
        t = await refreshLocationToken(conn.refresh_token);
      } catch {
        // The stored refresh token is no longer valid (expired, or the app was
        // uninstalled/reinstalled on the sub-account). The user must reconnect.
        throw new Error('reauth_required');
      }
      await pb.collection('ghl_connections').update(conn.id, {
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        token_expires: new Date(Date.now() + (t.expires_in || 86399) * 1000).toISOString(),
        company_id: t.companyId || conn.company_id,
      });
      return t.access_token;
    })();
    refreshInFlight.set(key, pending);
    // Drop the lock once settled (success or failure) so the next expiry refreshes
    // again. Pass the same handler for both outcomes to avoid an unhandled reject.
    const release = () => { if (refreshInFlight.get(key) === pending) refreshInFlight.delete(key); };
    pending.then(release, release);
  }
  return pending;
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

export async function getStatus(
  userId: string,
): Promise<{ connected: boolean; agencyName: string; email: string; ghlUserId: string }> {
  const conns = await listConnections(userId);
  const names = conns.map((c) => c.location_name || c.location_id).filter(Boolean);
  const summary = names.length > 1 ? `${names.length} sub-accounts` : (names[0] || '');
  // ghlUserId is the rep's GoHighLevel user id, captured from the OAuth token at
  // connect time. The Lead Scraper extension reads it to attribute recorded calls
  // to this rep (repKey) without any per-machine setup. `email` is kept as-is for
  // backward compatibility with older extension builds.
  const ghlUserId = conns[0]?.ghl_user_id || '';
  return { connected: conns.length > 0, agencyName: summary, email: ghlUserId, ghlUserId };
}

// The "sub-accounts" the extension can target are exactly the ones the user has
// connected. No agency-wide enumeration with a location-level app.
export async function listLocations(userId: string): Promise<NamedItem[]> {
  const conns = await listConnections(userId);
  return conns.map((c) => ({ id: c.location_id, name: c.location_name || c.location_id }));
}

// Resolve the agency companyId for a sub-account. Prefers the value stored on the
// connection (captured from the OAuth token); if missing (older rows), reads it
// off the GHL location object and backfills the connection so later calls skip
// the extra fetch.
async function resolveCompanyId(userId: string, locationId: string, token: string): Promise<string> {
  const pb = await getPbAdmin();
  // Best-effort backfill: a read hiccup here must not fail the whole request.
  let conn: GhlConnection | null = null;
  if (pb) { try { conn = await getConnectionRecord(pb, userId, locationId); } catch { conn = null; } }
  if (conn?.company_id) return conn.company_id;
  let companyId = '';
  try {
    const res = await ghlFetch<{ location?: { companyId?: string }; companyId?: string }>(
      token, 'GET', `/locations/${locationId}`,
    );
    companyId = res.data?.location?.companyId || res.data?.companyId || '';
  } catch { /* best effort */ }
  if (companyId && pb && conn) {
    await pb.collection('ghl_connections').update(conn.id, { company_id: companyId }).catch(() => null);
  }
  return companyId;
}

export async function listUsers(userId: string, locationId: string): Promise<Array<NamedItem & { email: string }>> {
  const token = await getValidLocationToken(userId, locationId);
  // GHL's /users/search requires the agency companyId (locationId alone yields
  // nothing). We captured companyId from the OAuth token at connect; fall back to
  // reading it off the location object for connections saved before that.
  const companyId = await resolveCompanyId(userId, locationId, token);
  const res = await ghlFetch<{ users?: Array<{ id: string; name?: string; firstName?: string; lastName?: string; email?: string }> }>(
    token, 'GET', '/users/search', { query: { companyId, locationId } },
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
  return findExistingContact(token, locationId, phone, email);
}

// Resolve an existing contact in the sub-account by phone/email, using GHL's own
// duplicate search (the same dedup upsert uses). Returns { exists, contactId }.
// Any non-OK (incl. 404 "no duplicate") -> not found, so a flaky check never
// blocks a send. Tolerates both { contact: { id } } and a bare { id }.
async function findExistingContact(token: string, locationId: string, phone?: string, email?: string): Promise<{ exists: boolean; contactId: string | null }> {
  if (!phone && !email) return { exists: false, contactId: null };
  const res = await ghlFetch<{ contact?: { id?: string } | null; id?: string }>(
    token, 'GET', '/contacts/search/duplicate', { query: { locationId, number: phone, email } },
  );
  if (!res.ok || !res.data) return { exists: false, contactId: null };
  const contactId = res.data.contact?.id || res.data.id || null;
  return { exists: Boolean(contactId), contactId };
}

// The current GHL contact, used to decide which fields are already populated.
interface GhlContactRecord {
  id: string;
  name?: string; firstName?: string; lastName?: string; companyName?: string;
  email?: string; phone?: string;
  address1?: string; city?: string; state?: string; postalCode?: string; country?: string;
  timezone?: string; website?: string; source?: string; assignedTo?: string;
  tags?: string[];
  customFields?: Array<{ id: string; value?: unknown }>;
}

async function getContactRecord(token: string, contactId: string): Promise<GhlContactRecord | null> {
  const res = await ghlFetch<{ contact?: GhlContactRecord }>(token, 'GET', `/contacts/${contactId}`);
  if (!res.ok || !res.data?.contact) return null;
  return res.data.contact;
}

// A field counts as "not already populated" when it is missing, null, or blank.
function isBlankValue(v: unknown): boolean {
  return v == null || (typeof v === 'string' && v.trim() === '');
}

// ---- Composite lead send (contact upsert + note + opportunity) -------------
export interface LeadPayload {
  contact: {
    name?: string;
    companyName?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    address1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
    timezone?: string;
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

// GHL /contacts/upsert rejects unknown properties (a stray `latitude` →
// "property latitude should not exist") and validates `email` strictly (an empty
// string fails "email must be an email"). The extension sanitises its payload,
// but we whitelist here too so an older/un-reloaded extension build can't make a
// whole batch fail: forward only known contact fields, drop empty optionals, and
// omit a syntactically invalid email.
const CONTACT_STRING_FIELDS = [
  'name', 'firstName', 'lastName', 'companyName', 'phone',
  'address1', 'city', 'state', 'postalCode', 'country', 'timezone',
  'website', 'source', 'assignedTo',
] as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeContact(contact: LeadPayload['contact']): Record<string, unknown> {
  const src = contact as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of CONTACT_STRING_FIELDS) {
    const v = src[k];
    if (typeof v === 'string' && v.trim()) out[k] = v;
  }
  const email = (contact.email || '').trim();
  if (email && EMAIL_RE.test(email)) out.email = email;
  if (Array.isArray(contact.tags) && contact.tags.length) out.tags = contact.tags;
  if (Array.isArray(contact.customFields) && contact.customFields.length) out.customFields = contact.customFields;
  return out;
}

// A lead send either creates a brand-new contact or enriches one that already
// exists. For an EXISTING contact we never re-create it (so GHL is never given a
// duplicate) and we only fill the fields it is currently missing — a value the
// scraper has but GHL lacks is written; a field GHL already has is left untouched.
// Tags merge additively, so the chosen category is added without dropping any.
export async function sendLead(userId: string, locationId: string, payload: LeadPayload): Promise<LeadResult> {
  const token = await getValidLocationToken(userId, locationId);
  const desired = sanitizeContact(payload.contact);
  const phone = typeof desired.phone === 'string' ? desired.phone : undefined;
  const email = typeof desired.email === 'string' ? desired.email : undefined;

  // Resolve an existing contact first (same dedup GHL upsert uses) so we update
  // it by id rather than risk creating a second one.
  const { contactId: existingId } = await findExistingContact(token, locationId, phone, email);

  let contactId: string;
  let isNew: boolean;
  let attachNote: boolean;
  let allowOpportunity: boolean;

  if (existingId) {
    isNew = false;
    contactId = existingId;

    // Read the current contact so we only touch blank fields. If the read fails
    // we cannot tell what is populated, so we skip field updates entirely rather
    // than risk overwriting existing data.
    const existing = await getContactRecord(token, existingId);
    const updates: Record<string, unknown> = {};
    if (existing) {
      const existingRec = existing as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(desired)) {
        if (k === 'tags' || k === 'customFields') continue;
        if (isBlankValue(existingRec[k])) updates[k] = v;
      }
      if (Array.isArray(desired.customFields) && desired.customFields.length) {
        const have = new Map<string, unknown>();
        for (const cf of existing.customFields || []) have.set(cf.id, cf.value);
        const cfFill = (desired.customFields as Array<{ id: string }>).filter((f) => isBlankValue(have.get(f.id)));
        if (cfFill.length) updates.customFields = cfFill;
      }
    }

    const didUpdate = Object.keys(updates).length > 0;
    if (didUpdate) {
      const put = await ghlFetch(token, 'PUT', `/contacts/${contactId}`, { body: updates });
      // A rejected token must surface as reauth; other PUT failures are non-fatal
      // (the contact still exists — we just couldn't enrich it this time).
      if (!put.ok && (put.status === 401 || put.status === 403)) throw new Error('reauth_required');
    }
    // Tags add cumulatively in GHL, so this never removes a tag the contact has.
    if (Array.isArray(desired.tags) && desired.tags.length) {
      await ghlFetch(token, 'POST', `/contacts/${contactId}/tags`, { body: { tags: desired.tags } }).catch(() => null);
    }
    // Only note when we actually enriched something, so repeated sends of an
    // already-complete lead don't pile up duplicate notes. Existing contacts get
    // no new opportunity (backfill only) to avoid duplicating pipeline entries.
    attachNote = didUpdate;
    allowOpportunity = false;
  } else {
    // New contact. Upsert honours the sub-account "allow duplicate" setting
    // (email-first, then phone) and is idempotent on phone/email, so a retried
    // POST won't double-create. Returns { new, contact }.
    const body = { locationId, ...desired };
    const up = await ghlFetch<{ new?: boolean; contact?: { id: string } }>(
      token, 'POST', '/contacts/upsert', { body },
    );
    if (!up.ok || !up.data?.contact?.id) {
      // 401/403 from GHL means the token is rejected -> tell the user to reconnect
      // rather than surfacing an opaque upstream error.
      if (up.status === 401 || up.status === 403) throw new Error('reauth_required');
      throw new Error(up.error || 'failed_to_upsert_contact');
    }
    contactId = up.data.contact.id;
    isNew = up.data.new !== false;
    attachNote = true;
    allowOpportunity = true;
  }

  // Note (best-effort — never fail the whole send because a note didn't stick).
  if (attachNote && payload.note && payload.note.trim()) {
    await ghlFetch(token, 'POST', `/contacts/${contactId}/notes`, { body: { body: payload.note } }).catch(() => null);
  }

  // Opportunity (optional; new contacts only).
  let opportunityId: string | null = null;
  const opp = payload.opportunity;
  if (allowOpportunity && opp?.create && opp.pipelineId && opp.stageId) {
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

// ---- Scraping sessions (GHL custom object) ---------------------------------
// The Lead Scraper extension stores each saved scraping session/campaign as a
// record on a per-sub-account custom object. This is a database of scraping
// ACTIVITY (campaigns), explicitly separate from the contacts/opportunities the
// extension pushes as leads.
//
// Storage shape: two properties are used — the primary display field ("name")
// and a large-text "payload" field holding the full session JSON (metadata +,
// when small enough, the resumable snapshot). Everything else (owner, client id,
// stats) also lives inside that JSON, so we only depend on those two fields and
// don't have to provision a wide schema.
//
// Property-key discovery: rather than hardcode GHL's field-key format, we fetch
// the schema with fetchProperties=true and read the real keys, then use them for
// record writes. Provisioning (creating the object + payload field) is best
// effort; if it can't complete, callers get `scraping_object_setup_required` and
// an admin can create the object + a "Payload" large-text field once by hand.

const SCRAPING_OBJECT_KEY = 'custom_objects.tt_scraping_session';
const SCRAPING_OBJECT_SHORT = 'tt_scraping_session';
/** Cap on the JSON stored in GHL; larger sessions store metadata only (snapshot stays client-side). */
export const SCRAPING_PAYLOAD_MAX = 90_000;

export interface ScrapingSession {
  recordId: string;
  clientId: string;
  name: string;
  ownerUserId: string;
  updatedAt: number;
  payloadOmitted: boolean;
  session: Record<string, unknown>;
}

interface GhlObjectField { key?: string; dataType?: string; name?: string }
interface GhlRecord { id: string; properties?: Record<string, unknown>; dateUpdated?: string }
interface ScrapingSchemaKeys { nameKey: string; payloadKey: string }

// Per-location cache of the discovered field keys (best effort; resets on cold start).
const scrapingSchemaCache = new Map<string, ScrapingSchemaKeys>();

function shortFieldKey(fieldKey: string): string {
  const i = fieldKey.lastIndexOf('.');
  return i >= 0 ? fieldKey.slice(i + 1) : fieldKey;
}

// Read a property value tolerant of GHL returning either the full field key
// (custom_objects.tt_scraping_session.payload) or the short key (payload).
function readProp(props: Record<string, unknown> | undefined, shortKey: string): unknown {
  if (!props) return undefined;
  if (shortKey in props) return props[shortKey];
  for (const [k, v] of Object.entries(props)) if (shortFieldKey(k) === shortKey) return v;
  return undefined;
}

async function fetchScrapingSchemaKeys(token: string, locationId: string): Promise<ScrapingSchemaKeys | null> {
  const res = await ghlFetch<{ object?: { fields?: GhlObjectField[]; primaryDisplayProperty?: string }; fields?: GhlObjectField[] }>(
    token, 'GET', `/objects/${SCRAPING_OBJECT_KEY}`, { query: { locationId, fetchProperties: 'true' } },
  );
  if (!res.ok || !res.data) return null;
  const fields = res.data.fields || res.data.object?.fields || [];
  let nameKey = '';
  let payloadKey = '';
  for (const f of fields) {
    const sk = shortFieldKey(f.key || '');
    if (sk === 'payload') payloadKey = f.key || '';
    if (sk === 'name') nameKey = f.key || '';
  }
  if (!nameKey) nameKey = res.data.object?.primaryDisplayProperty || `${SCRAPING_OBJECT_KEY}.name`;
  if (!payloadKey) return null; // object exists but the payload field isn't there yet
  return { nameKey, payloadKey };
}

// Create the custom object (primary "name" field) and the large-text "payload"
// field. One-time per sub-account. Best effort — throws scraping_object_setup_required
// on failure so the caller can tell the user to create it manually.
async function provisionScrapingObject(token: string, locationId: string): Promise<void> {
  // Create the object schema (idempotent-ish: a duplicate create returns 4xx, which
  // we tolerate because the follow-up field create / schema fetch is what matters).
  await ghlFetch(token, 'POST', '/objects/', {
    body: {
      labels: { singular: 'TT Scraping Session', plural: 'TT Scraping Sessions' },
      key: SCRAPING_OBJECT_SHORT,
      description: 'Saved Lead Scraper campaigns (managed by TableTurnerr). Separate from contacts.',
      locationId,
      primaryDisplayPropertyDetails: { key: `${SCRAPING_OBJECT_SHORT}.name`, name: 'Name', dataType: 'TEXT' },
    },
  });
  // Create the payload field via Custom Fields V2 (scoped to the object).
  await ghlFetch(token, 'POST', '/custom-fields/', {
    body: {
      locationId,
      name: 'Payload',
      dataType: 'LARGE_TEXT',
      objectKey: SCRAPING_OBJECT_KEY,
      fieldKey: 'payload',
    },
  });
}

async function ensureScrapingSchema(token: string, locationId: string): Promise<ScrapingSchemaKeys> {
  const cached = scrapingSchemaCache.get(locationId);
  if (cached) return cached;
  let keys = await fetchScrapingSchemaKeys(token, locationId);
  if (!keys) {
    await provisionScrapingObject(token, locationId);
    keys = await fetchScrapingSchemaKeys(token, locationId);
  }
  if (!keys) throw new Error('scraping_object_setup_required');
  scrapingSchemaCache.set(locationId, keys);
  return keys;
}

// Turn a GHL record into our ScrapingSession, parsing the payload JSON.
function recordToSession(rec: GhlRecord): ScrapingSession | null {
  const raw = readProp(rec.properties, 'payload');
  let session: Record<string, unknown> = {};
  if (typeof raw === 'string' && raw) {
    try { session = JSON.parse(raw) as Record<string, unknown>; } catch { session = {}; }
  } else if (raw && typeof raw === 'object') {
    session = raw as Record<string, unknown>;
  }
  const meta = (session.__meta as Record<string, unknown>) || {};
  return {
    recordId: rec.id,
    clientId: String(meta.clientId || session.id || rec.id),
    name: String(readProp(rec.properties, 'name') || meta.name || session.name || 'Saved session'),
    ownerUserId: String(meta.ownerUserId || ''),
    updatedAt: Number(meta.updatedAt || session.updatedAt || 0) || 0,
    payloadOmitted: Boolean(meta.payloadOmitted),
    session,
  };
}

// List the current user's scraping sessions in a sub-account. GHL record search
// only matches the primary field reliably, so we page through and filter by owner.
export async function listScrapingSessions(userId: string, locationId: string): Promise<ScrapingSession[]> {
  const token = await getValidLocationToken(userId, locationId);
  await ensureScrapingSchema(token, locationId);
  const res = await ghlFetch<{ records?: GhlRecord[] }>(
    token, 'POST', `/objects/${SCRAPING_OBJECT_KEY}/records/search`,
    { body: { locationId, page: 1, pageLimit: 100 } },
  );
  if (!res.ok || !res.data) throw new Error(res.error || 'failed_to_list_sessions');
  return (res.data.records || [])
    .map(recordToSession)
    .filter((s): s is ScrapingSession => !!s && s.ownerUserId === userId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

// Create or update the current user's record for one session (idempotent by the
// extension's client session id). `session` is the full session object from the
// extension; we stamp owner/meta and enforce the payload size cap.
export async function upsertScrapingSession(
  userId: string, locationId: string, session: Record<string, unknown>,
): Promise<ScrapingSession> {
  const token = await getValidLocationToken(userId, locationId);
  const keys = await ensureScrapingSchema(token, locationId);
  const clientId = String(session.id || '');
  if (!clientId) throw new Error('missing_session_id');
  const name = String(session.name || 'Saved session');

  // Decide whether the full snapshot fits; if not, drop the heavy parts (leads +
  // grid points) and mark it omitted so the client keeps those locally for resume.
  let payloadObj: Record<string, unknown> = { ...session };
  let payloadOmitted = false;
  if (JSON.stringify(payloadObj).length > SCRAPING_PAYLOAD_MAX) {
    payloadOmitted = true;
    const { leads: _leads, gridState: _grid, ...light } = payloadObj;
    void _leads; void _grid;
    payloadObj = light;
  }
  payloadObj.__meta = { clientId, ownerUserId: userId, name, updatedAt: Date.now(), payloadOmitted };
  const payloadStr = JSON.stringify(payloadObj);

  const properties: Record<string, unknown> = {};
  properties[keys.nameKey] = name;
  properties[keys.payloadKey] = payloadStr;

  // Find an existing record for this client id owned by this user.
  const existing = (await listScrapingSessions(userId, locationId)).find((s) => s.clientId === clientId);
  if (existing) {
    const res = await ghlFetch<{ record?: GhlRecord } & GhlRecord>(
      token, 'PUT', `/objects/${SCRAPING_OBJECT_KEY}/records/${existing.recordId}`,
      { query: { locationId }, body: { properties } },
    );
    if (!res.ok) throw new Error(res.error || 'failed_to_update_session');
  } else {
    const res = await ghlFetch<{ record?: GhlRecord } & GhlRecord>(
      token, 'POST', `/objects/${SCRAPING_OBJECT_KEY}/records`,
      { body: { locationId, properties } },
    );
    if (!res.ok) throw new Error(res.error || 'failed_to_create_session');
  }
  return {
    recordId: existing?.recordId || '',
    clientId, name, ownerUserId: userId, updatedAt: Date.now(), payloadOmitted, session: payloadObj,
  };
}

// Delete one session record. Ownership is re-checked before deleting.
export async function deleteScrapingSession(userId: string, locationId: string, recordId: string): Promise<void> {
  const token = await getValidLocationToken(userId, locationId);
  const owned = (await listScrapingSessions(userId, locationId)).some((s) => s.recordId === recordId);
  if (!owned) throw new Error('session_not_found');
  const res = await ghlFetch(
    token, 'DELETE', `/objects/${SCRAPING_OBJECT_KEY}/records/${recordId}`, { query: { locationId } },
  );
  if (!res.ok) throw new Error(res.error || 'failed_to_delete_session');
}
