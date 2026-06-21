import type { Env } from "../index";

const TOKEN_URL = "https://zoom.us/oauth/token";
const TOKEN_KEY = "zoom:token";

type StoredToken = {
  access_token: string;
  expires_at_ms: number;
};

export async function getZoomAccessToken(env: Env): Promise<string> {
  const cached = await env.STATE.get(TOKEN_KEY);
  if (cached) {
    const parsed = JSON.parse(cached) as StoredToken;
    if (Date.now() < parsed.expires_at_ms) return parsed.access_token;
  }
  return refreshZoomToken(env);
}

async function refreshZoomToken(env: Env): Promise<string> {
  const basic = btoa(`${env.ZOOM_CLIENT_ID}:${env.ZOOM_CLIENT_SECRET}`);
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "account_credentials",
      account_id: env.ZOOM_ACCOUNT_ID,
    }),
  });
  if (!res.ok) {
    throw new Error(`Zoom token failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  const stored: StoredToken = {
    access_token: json.access_token,
    expires_at_ms: Date.now() + (json.expires_in - 60) * 1000,
  };
  await env.STATE.put(TOKEN_KEY, JSON.stringify(stored), {
    expirationTtl: json.expires_in,
  });
  return stored.access_token;
}

export async function downloadZoomAudio(
  env: Env,
  downloadUrl: string,
): Promise<{ audio: ArrayBuffer; contentType: string }> {
  const token = await getZoomAccessToken(env);
  const res = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Zoom download failed: ${res.status}`);
  }
  return {
    audio: await res.arrayBuffer(),
    contentType: res.headers.get("content-type") ?? "audio/mpeg",
  };
}

export async function fetchTextWithAuth(env: Env, url: string): Promise<string> {
  const token = await getZoomAccessToken(env);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Zoom fetch failed: ${res.status}`);
  }
  return res.text();
}
