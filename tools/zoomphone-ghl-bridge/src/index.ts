import { handleZoomWebhook } from "./zoom/webhook";
import { buildAuthorizeUrl, handleOAuthCallback } from "./ghl/oauth";
import { handleAgentConnect } from "./agent/router";
import { handleRecordingIngest } from "./recordings/ingest";

export { AgentHub } from "./agent/hub";

export interface Env {
  STATE: KVNamespace;
  AGENT_HUB: DurableObjectNamespace;

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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
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

    if (request.method === "GET" && url.pathname === "/agent/connect") {
      return handleAgentConnect(request, env);
    }

    if (request.method === "POST" && url.pathname === "/recordings/ingest") {
      return handleRecordingIngest(request, env, ctx);
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
  },
};
