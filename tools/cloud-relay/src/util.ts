export interface Env {
  BUFFER: R2Bucket;
  KV: KVNamespace;
  HOME_BASE_URL: string;
  /** Same secret the bridge validates Zoom webhooks with. */
  ZOOM_SECRET_TOKEN: string;
  /** Same bearer token the agents and bridge share for /recordings/ingest. */
  AGENT_SHARED_TOKEN: string;
}

/** R2 key prefixes. Objects only exist while waiting for handoff to the home server. */
export const WEBHOOK_PREFIX = "webhook/";
export const RECORDING_PREFIX = "recording/";
/** Items the home server definitively rejected (4xx) — kept for manual review, never replayed. */
export const FAILED_PREFIX = "failed/";

/** Sortable key: zero-padded ms timestamp + uuid. R2 lists lexicographically = oldest first. */
export function bufferKey(prefix: string): string {
  return `${prefix}${String(Date.now()).padStart(14, "0")}-${crypto.randomUUID()}`;
}

export function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

export function fetchHome(
  env: Env,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  return fetch(`${env.HOME_BASE_URL}${path}`, { ...rest, signal: AbortSignal.timeout(timeoutMs) });
}

export async function homeHealthy(env: Env): Promise<boolean> {
  try {
    const res = await fetchHome(env, "/health", { timeoutMs: 5_000 });
    return res.ok;
  } catch {
    return false;
  }
}

export function bearerOk(request: Request, token: string): boolean {
  const auth = request.headers.get("authorization") ?? "";
  return token.length > 0 && timingSafeEqual(auth, `Bearer ${token}`);
}

export function timingSafeEqual(a: string, b: string): boolean {
  const bytesA = new TextEncoder().encode(a);
  const bytesB = new TextEncoder().encode(b);
  if (bytesA.length !== bytesB.length) return false;
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) diff |= bytesA[i] ^ bytesB[i];
  return diff === 0;
}

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
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
