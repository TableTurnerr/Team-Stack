import { handleZoomWebhook } from "./zoom/webhook";
import { buildAuthorizeUrl, handleOAuthCallback } from "./ghl/oauth";
import { handleRecordingIngest } from "./recordings/ingest";
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
