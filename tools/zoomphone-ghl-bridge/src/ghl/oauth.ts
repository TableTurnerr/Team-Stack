import type { Env } from "../index";

const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const AUTHORIZE_URL = "https://marketplace.leadconnectorhq.com/oauth/chooselocation";

const SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "conversations/message.readonly",
  "conversations/message.write",
  // Medias API: used to park no-phone clips for review and to attach
  // recordings larger than the 5 MB conversations-upload cap.
  "medias.readonly",
  "medias.write",
];

const STATE_KEY = "ghl:tokens";

type StoredTokens = {
  access_token: string;
  refresh_token: string;
  expires_at_ms: number;
  location_id: string;
};

export function buildAuthorizeUrl(env: Env, request: Request): string {
  const u = new URL(AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", env.GHL_MARKETPLACE_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirectUriFor(env, request));
  u.searchParams.set("scope", SCOPES.join(" "));
  return u.toString();
}

// The redirect_uri must be byte-identical in the authorize call, the GHL app's
// registered value, and the token exchange. Behind the Cloudflare Tunnel the
// origin hop is plain HTTP, so `request.url`'s scheme is `http` even though the
// public URL is `https` — using it directly produces an http:// URI that GHL
// rejects. Prefer an explicit PUBLIC_BASE_URL; otherwise honor the
// X-Forwarded-Proto/Host headers cloudflared sets.
function redirectUriFor(env: Env, request: Request): string {
  return `${publicOrigin(env, request)}/oauth/callback`;
}

function publicOrigin(env: Env, request: Request): string {
  if (env.PUBLIC_BASE_URL) return env.PUBLIC_BASE_URL.replace(/\/+$/, "");
  const u = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ?? u.host;
  return `${proto || u.protocol.replace(/:$/, "")}://${host}`;
}

export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (!code) return new Response("missing code", { status: 400 });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: env.GHL_MARKETPLACE_CLIENT_ID,
      client_secret: env.GHL_MARKETPLACE_CLIENT_SECRET,
      redirect_uri: redirectUriFor(env, request),
      user_type: "Location",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return new Response(`token exchange failed: ${res.status} ${body}`, { status: 500 });
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    locationId?: string;
  };
  const stored: StoredTokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at_ms: Date.now() + (json.expires_in - 60) * 1000,
    location_id: json.locationId ?? env.GHL_LOCATION_ID,
  };
  await env.STATE.put(STATE_KEY, JSON.stringify(stored));
  return new Response(
    `GHL install complete. Location: ${stored.location_id}. You can close this tab.`,
    { status: 200 },
  );
}

// Single-flight guard for the refresh exchange. GHL rotates the refresh_token on
// every refresh and revokes the whole grant if a rotated token is replayed. The
// call-log and recording webhooks for the same call arrive near-simultaneously,
// so without serialization two handlers read the same stale token and both POST
// the same refresh_token — GHL's reuse-detection then kills the grant and every
// subsequent call silently fails. This in-process promise ensures only one
// refresh runs at a time; concurrent callers await the same result. (The
// self-hosted bridge is a single Node process, so an in-process lock suffices.)
let inflightRefresh: Promise<string> | null = null;

export async function getGhlAccessToken(env: Env): Promise<string> {
  const raw = await env.STATE.get(STATE_KEY);
  if (!raw) throw new Error("GHL not installed: visit /ghl/install once to authorize");
  const tokens = JSON.parse(raw) as StoredTokens;
  if (Date.now() < tokens.expires_at_ms) return tokens.access_token;

  // Token expired: refresh under the single-flight lock.
  if (inflightRefresh) return inflightRefresh;
  inflightRefresh = (async () => {
    try {
      // Re-read in case another caller refreshed while we were queued.
      const fresh = await env.STATE.get(STATE_KEY);
      const current = fresh ? (JSON.parse(fresh) as StoredTokens) : tokens;
      if (Date.now() < current.expires_at_ms) return current.access_token;
      return await refreshGhlToken(env, current);
    } finally {
      inflightRefresh = null;
    }
  })();
  return inflightRefresh;
}

async function refreshGhlToken(env: Env, prev: StoredTokens): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: prev.refresh_token,
      client_id: env.GHL_MARKETPLACE_CLIENT_ID,
      client_secret: env.GHL_MARKETPLACE_CLIENT_SECRET,
      user_type: "Location",
    }),
  });
  if (!res.ok) {
    throw new Error(`GHL token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    locationId?: string;
  };
  const next: StoredTokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at_ms: Date.now() + (json.expires_in - 60) * 1000,
    location_id: json.locationId ?? prev.location_id,
  };
  await env.STATE.put(STATE_KEY, JSON.stringify(next));
  return next.access_token;
}
