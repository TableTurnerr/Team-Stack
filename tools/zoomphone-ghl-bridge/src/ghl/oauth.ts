import type { Env } from "../index";

const TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const AUTHORIZE_URL = "https://marketplace.leadconnectorhq.com/oauth/chooselocation";

const SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "conversations/message.readonly",
  "conversations/message.write",
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
  u.searchParams.set("redirect_uri", redirectUriFor(request));
  u.searchParams.set("scope", SCOPES.join(" "));
  return u.toString();
}

function redirectUriFor(request: Request): string {
  const u = new URL(request.url);
  return `${u.origin}/oauth/callback`;
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
      redirect_uri: redirectUriFor(request),
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

export async function getGhlAccessToken(env: Env): Promise<string> {
  const raw = await env.STATE.get(STATE_KEY);
  if (!raw) throw new Error("GHL not installed: visit /ghl/install once to authorize");
  const tokens = JSON.parse(raw) as StoredTokens;
  if (Date.now() < tokens.expires_at_ms) return tokens.access_token;
  return refreshGhlToken(env, tokens);
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
