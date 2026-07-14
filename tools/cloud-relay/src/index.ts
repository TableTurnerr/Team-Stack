import { drain } from "./drain";
import { handleBootstrap, handleRecordingsIngest } from "./recordings";
import { handleZoomWebhook } from "./zoom";
import {
  Env,
  FAILED_PREFIX,
  RECORDING_PREFIX,
  WEBHOOK_PREFIX,
  bearerOk,
  homeHealthy,
  json,
} from "./util";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "POST" && pathname === "/zoom/webhook") {
      return handleZoomWebhook(request, env);
    }
    if (request.method === "POST" && pathname === "/recordings/ingest") {
      return handleRecordingsIngest(request, env);
    }
    if (request.method === "GET" && pathname === "/agent/bootstrap") {
      return handleBootstrap(request, env);
    }
    if (request.method === "GET" && pathname === "/health") {
      return handleHealth(env);
    }
    if (request.method === "POST" && pathname === "/drain") {
      if (!bearerOk(request, env.AGENT_SHARED_TOKEN)) return json({ error: "unauthorized" }, 401);
      return json(await drain(env));
    }

    return new Response("not found", { status: 404 });
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      drain(env).then((result) => {
        if (result.webhooksSent || result.recordingsSent || result.movedToFailed || result.aborted) {
          console.log("drain:", JSON.stringify(result));
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;

async function handleHealth(env: Env): Promise<Response> {
  const [home, webhooks, recordings, failed] = await Promise.all([
    homeHealthy(env),
    env.BUFFER.list({ prefix: WEBHOOK_PREFIX, limit: 1000 }),
    env.BUFFER.list({ prefix: RECORDING_PREFIX, limit: 1000 }),
    env.BUFFER.list({ prefix: FAILED_PREFIX, limit: 1000 }),
  ]);
  const count = (l: R2Objects) => (l.truncated ? `${l.objects.length}+` : l.objects.length);
  return json({
    status: "ok",
    home: home ? "up" : "down",
    buffered: { webhooks: count(webhooks), recordings: count(recordings), failed: count(failed) },
  });
}
