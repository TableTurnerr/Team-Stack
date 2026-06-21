import type { Env } from "../index";
import type { ExecCtx } from "../runtime/types";
import { dispatch } from "../pipeline";

type ZoomEnvelope = {
  event: string;
  event_ts?: number;
  payload?: ({ object?: unknown; plainToken?: string } & Record<string, unknown>) | undefined;
};

export async function handleZoomWebhook(
  request: Request,
  env: Env,
  ctx: ExecCtx,
): Promise<Response> {
  const rawBody = await request.text();

  if (!(await verifyZoomSignature(request, rawBody, env.ZOOM_SECRET_TOKEN))) {
    return new Response("invalid signature", { status: 401 });
  }

  let envelope: ZoomEnvelope;
  try {
    envelope = JSON.parse(rawBody) as ZoomEnvelope;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  if (envelope.event === "endpoint.url_validation") {
    return handleUrlValidation(envelope, env.ZOOM_SECRET_TOKEN);
  }

  ctx.waitUntil(dispatch(envelope, env));
  return new Response(null, { status: 204 });
}

async function verifyZoomSignature(
  request: Request,
  rawBody: string,
  secretToken: string,
): Promise<boolean> {
  const ts = request.headers.get("x-zm-request-timestamp");
  const sig = request.headers.get("x-zm-signature");
  if (!ts || !sig) return false;
  const expected = `v0=${await hmacSha256Hex(secretToken, `v0:${ts}:${rawBody}`)}`;
  return timingSafeEqual(expected, sig);
}

async function handleUrlValidation(
  envelope: ZoomEnvelope,
  secretToken: string,
): Promise<Response> {
  const plainToken = envelope.payload?.plainToken;
  if (typeof plainToken !== "string") {
    return new Response("missing plainToken", { status: 400 });
  }
  const encryptedToken = await hmacSha256Hex(secretToken, plainToken);
  return Response.json({ plainToken, encryptedToken });
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
