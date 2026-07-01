import { handleZoomWebhook } from "./zoom/webhook";
import { buildAuthorizeUrl, handleOAuthCallback } from "./ghl/oauth";
import { handleRecordingIngest } from "./recordings/ingest";
import { deadLetterStats } from "./runtime/deadletter";
import {
  setRepMapping,
  getRepMapping,
  deleteRepMapping,
  listRepMappings,
} from "./reps";
import type { KvStore, ExecCtx, PendingClipStore } from "./runtime/types";

// Secrets + the stores the handlers need. On Cloudflare this was the Worker
// `Env` (KVNamespace + DurableObjectNamespace bindings); self-hosted it is built
// from process.env + SQLite (see runtime/env.ts). The Durable Object (AgentHub)
// is gone: live worker→agent push can't be routed on a shared Zoom account, so
// the agent self-detects and the bridge reconciles clips on upload.
export interface Env {
  STATE: KvStore;
  // Pending recorded clips awaiting correlation to a Zoom call.
  CLIPS: PendingClipStore;

  // Public https origin this service is reached at (e.g.
  // https://zoomphone.tableturnerr.com). Used to build the GHL OAuth
  // redirect_uri; falls back to X-Forwarded-Proto/Host when unset.
  PUBLIC_BASE_URL: string;

  ZOOM_SECRET_TOKEN: string;
  ZOOM_VERIFICATION_TOKEN: string;
  ZOOM_CLIENT_ID: string;
  ZOOM_CLIENT_SECRET: string;
  ZOOM_ACCOUNT_ID: string;
  // The shared Zoom account's user email or user_id. Handed to agents via
  // GET /agent/bootstrap so they can query call_history per-user (the agent
  // can't query the account-level token; it needs a user context).
  ZOOM_USER_ID: string;

  GHL_MARKETPLACE_CLIENT_ID: string;
  GHL_MARKETPLACE_CLIENT_SECRET: string;
  GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID: string;
  GHL_LOCATION_ID: string;

  AGENT_SHARED_TOKEN: string;
}

// Single web-standard request router, shared by the Node server (and trivially
// testable by passing a Request directly).
export async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecCtx,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return new Response("ok", { status: 200 });
  }

  // Diagnostics: surfaces how many Zoom events failed to reach GHL and are
  // queued for replay (the webhook acks 204 and dispatches in the background,
  // so failures are otherwise invisible). `degraded` flags a backlog so a
  // monitor/alert can fire without taking the service "down".
  if (request.method === "GET" && url.pathname === "/status") {
    const dlq = await deadLetterStats(env).catch(() => ({
      pending: -1,
      failed: -1,
      oldestMs: null as number | null,
    }));
    const ghlInstalled = (await env.STATE.get("ghl:tokens").catch(() => null)) != null;
    return Response.json(
      {
        status: "ok",
        ghlInstalled,
        deadLetters: dlq,
        degraded: !ghlInstalled || dlq.pending > 0,
      },
      { status: 200 },
    );
  }

  if (request.method === "GET" && url.pathname === "/oauth/install") {
    return Response.redirect(buildAuthorizeUrl(env, request), 302);
  }

  if (request.method === "GET" && url.pathname === "/oauth/callback") {
    return handleOAuthCallback(request, env);
  }

  if (request.method === "POST" && url.pathname === "/zoom/webhook") {
    return handleZoomWebhook(request, env, ctx);
  }

  if (request.method === "POST" && url.pathname === "/recordings/ingest") {
    return handleRecordingIngest(request, env, ctx);
  }

  if (request.method === "GET" && url.pathname === "/agent/bootstrap") {
    return handleAgentBootstrap(request, env);
  }

  // Rep-mapping admin (repKey → GHL userId). Guarded by the same shared bearer
  // the agents present. Mappings are OPTIONAL: with none set, repKey passes
  // through as the GHL userId (see src/reps.ts). Lets you override a rep's GHL
  // user without a code edit/redeploy.
  if (url.pathname === "/admin/reps" || url.pathname.startsWith("/admin/reps/")) {
    return handleAdminReps(request, env, url);
  }

  if (request.method === "POST" && url.pathname === "/delivery") {
    // GHL Conversation Provider delivery URL. Used only if someone tries to
    // initiate an outbound call from inside the GHL UI through this provider.
    // We don't support that flow yet; log the payload and ack so GHL stops retrying.
    const body = await request.text();
    console.log("delivery POST received:", body);
    return new Response(null, { status: 200 });
  }

  return new Response("not found", { status: 404 });
}

// Hands an authenticated agent the shared Zoom S2S creds so it can resolve a
// call's real call_id + external number from Zoom call_history (a device-IP
// match the worker can't do for it). The agent already holds AGENT_SHARED_TOKEN;
// this keeps the Zoom secret in one place (here) instead of shipping it in the
// installer, the extension, or every machine's disk. Bearer-guarded.
async function handleAgentBootstrap(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!env.AGENT_SHARED_TOKEN || auth !== `Bearer ${env.AGENT_SHARED_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }
  if (
    !env.ZOOM_ACCOUNT_ID ||
    !env.ZOOM_CLIENT_ID ||
    !env.ZOOM_CLIENT_SECRET ||
    !env.ZOOM_USER_ID
  ) {
    // The bridge itself isn't fully configured for Zoom S2S yet.
    return Response.json({ error: "zoom_not_configured" }, { status: 503 });
  }
  return Response.json(
    {
      zoom: {
        accountId: env.ZOOM_ACCOUNT_ID,
        clientId: env.ZOOM_CLIENT_ID,
        clientSecret: env.ZOOM_CLIENT_SECRET,
        zoomUserId: env.ZOOM_USER_ID,
      },
    },
    { status: 200 },
  );
}

// repKey → GHL userId mapping admin. Bearer-guarded by AGENT_SHARED_TOKEN.
//   GET    /admin/reps            → list all mappings
//   POST   /admin/reps            → { repKey, ghlUserId } upsert
//   DELETE /admin/reps/:repKey    → remove one
async function handleAdminReps(request: Request, env: Env, url: URL): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (!env.AGENT_SHARED_TOKEN || auth !== `Bearer ${env.AGENT_SHARED_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }

  if (request.method === "GET" && url.pathname === "/admin/reps") {
    return Response.json({ reps: await listRepMappings(env) }, { status: 200 });
  }

  if (request.method === "POST" && url.pathname === "/admin/reps") {
    let body: { repKey?: unknown; ghlUserId?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    const repKey = typeof body.repKey === "string" ? body.repKey.trim() : "";
    const ghlUserId = typeof body.ghlUserId === "string" ? body.ghlUserId.trim() : "";
    if (!repKey || !ghlUserId) {
      return new Response("repKey and ghlUserId are required", { status: 400 });
    }
    await setRepMapping(env, repKey, ghlUserId);
    return Response.json({ repKey, ghlUserId }, { status: 200 });
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/admin/reps/")) {
    const repKey = decodeURIComponent(url.pathname.slice("/admin/reps/".length)).trim();
    if (!repKey) return new Response("missing repKey", { status: 400 });
    const existing = await getRepMapping(env, repKey);
    await deleteRepMapping(env, repKey);
    return Response.json({ repKey, deleted: existing != null }, { status: 200 });
  }

  return new Response("method not allowed", { status: 405 });
}
