import { Env, RECORDING_PREFIX, bearerOk, bufferKey, fetchHome, json } from "./util";

const BOOTSTRAP_CACHE_KEY = "bootstrap:v1";

/**
 * Pass-through/buffer for agent recording uploads.
 *
 * Happy path: proxy the multipart body straight to the home bridge and return
 * its response verbatim (200 attached / 202 review / 409 duplicate / 4xx).
 * Home unreachable or 5xx: persist the raw body to R2 and tell the agent it
 * succeeded — the cron drain re-posts it to the bridge later, where the
 * clientCallId dedup guard makes replays idempotent.
 */
export async function handleRecordingsIngest(request: Request, env: Env): Promise<Response> {
  if (!bearerOk(request, env.AGENT_SHARED_TOKEN)) return json({ error: "unauthorized" }, 401);

  const contentType = request.headers.get("content-type") ?? "application/octet-stream";
  const body = await request.arrayBuffer();

  try {
    const res = await fetchHome(env, "/recordings/ingest", {
      method: "POST",
      headers: { "content-type": contentType, authorization: `Bearer ${env.AGENT_SHARED_TOKEN}` },
      body,
      timeoutMs: 90_000, // clips can be tens of MB over a residential uplink
    });
    if (res.status < 500) {
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
      });
    }
    // 5xx from home → fall through to buffering.
  } catch {
    // Home unreachable → buffer.
  }

  const key = bufferKey(RECORDING_PREFIX);
  await env.BUFFER.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { receivedAt: String(Date.now()) },
  });
  return json({ status: "buffered", relay: true, correlated: false, pending: true });
}

/**
 * Agent bootstrap with a cloud-cached copy, so a freshly provisioned agent can
 * pull its Zoom credentials even while the home server is down. The cache is
 * refreshed on every successful pass-through and holds config only (no call
 * data), which is the one thing allowed to live in the cloud long-term.
 */
export async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  if (!bearerOk(request, env.AGENT_SHARED_TOKEN)) return json({ error: "unauthorized" }, 401);

  try {
    const res = await fetchHome(env, "/agent/bootstrap", {
      headers: { authorization: `Bearer ${env.AGENT_SHARED_TOKEN}` },
      timeoutMs: 10_000,
    });
    const text = await res.text();
    if (res.ok) {
      await env.KV.put(BOOTSTRAP_CACHE_KEY, text);
      return new Response(text, {
        status: 200,
        headers: { "content-type": "application/json", "x-relay-cache": "miss" },
      });
    }
    if (res.status < 500) {
      // e.g. 503 zoom_not_configured — a real answer from home, pass it through.
      return new Response(text, { status: res.status, headers: { "content-type": "application/json" } });
    }
  } catch {
    // Home down — try the cache.
  }

  const cached = await env.KV.get(BOOTSTRAP_CACHE_KEY);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: { "content-type": "application/json", "x-relay-cache": "hit" },
    });
  }
  return json({ error: "home_unreachable" }, 503);
}
