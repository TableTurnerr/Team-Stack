import {
  Env,
  WEBHOOK_PREFIX,
  bufferKey,
  fetchHome,
  hmacSha256Hex,
  json,
  timingSafeEqual,
} from "./util";

/**
 * A Zoom webhook captured verbatim. The home bridge re-validates the original
 * HMAC signature on replay, so we store exactly what Zoom sent — nothing more.
 */
export interface StoredWebhook {
  body: string;
  timestamp: string;
  signature: string;
  receivedAt: number;
}

export function forwardWebhook(env: Env, stored: StoredWebhook, timeoutMs = 15_000): Promise<Response> {
  return fetchHome(env, "/zoom/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zm-request-timestamp": stored.timestamp,
      "x-zm-signature": stored.signature,
    },
    body: stored.body,
    timeoutMs,
  });
}

/**
 * Always-up Zoom webhook receiver — forward-first to keep free-tier usage low.
 *
 * Happy path (home up): validate → forward with a short timeout → 204. Zero
 * storage operations; the worker is a pure proxy.
 *
 * Home down/slow/non-OK: persist the envelope to R2, then ack. Zoom only
 * retries on 5xx (3 attempts over ~85 minutes) and never retries a 2xx, and it
 * expects an answer within ~3 seconds — so the forward timeout is short and
 * the buffered copy is written BEFORE the 2xx goes out. The cron drain
 * delivers it once home returns. If home actually processed a forward that we
 * timed out on, the replay is harmless — the bridge dedupes on Zoom call_id.
 */
export async function handleZoomWebhook(request: Request, env: Env): Promise<Response> {
  const timestamp = request.headers.get("x-zm-request-timestamp");
  const signature = request.headers.get("x-zm-signature");
  const body = await request.text();
  if (!timestamp || !signature) return new Response("missing signature headers", { status: 401 });

  const expected = `v0=${await hmacSha256Hex(env.ZOOM_SECRET_TOKEN, `v0:${timestamp}:${body}`)}`;
  if (!timingSafeEqual(expected, signature)) return new Response("bad signature", { status: 401 });

  let event: { event?: string; payload?: { plainToken?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // Zoom's endpoint URL validation handshake — answered locally so the relay
  // stays verifiable even while the home server is down.
  if (event?.event === "endpoint.url_validation") {
    const plainToken = event?.payload?.plainToken ?? "";
    return json({ plainToken, encryptedToken: await hmacSha256Hex(env.ZOOM_SECRET_TOKEN, plainToken) });
  }

  const stored: StoredWebhook = { body, timestamp, signature, receivedAt: Date.now() };

  // Forward-first: when home is up this is the whole request — no R2, no KV.
  try {
    const res = await forwardWebhook(env, stored, 2_500);
    if (res.ok) return new Response(null, { status: 204 });
  } catch {
    // Home unreachable or too slow — buffer below.
  }

  // Home didn't take it — persist durably, THEN ack Zoom. The cron drain
  // delivers it when home returns.
  await env.BUFFER.put(bufferKey(WEBHOOK_PREFIX), JSON.stringify(stored));
  return new Response(null, { status: 204 });
}
