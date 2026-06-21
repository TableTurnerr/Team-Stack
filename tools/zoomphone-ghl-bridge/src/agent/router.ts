import type { Env } from "../index";
import type { RecordCommand } from "./contracts";

// All rep sockets live in a single named DO instance so any rep's phone webhook
// can reach any connected agent.
const HUB_NAME = "global";

function hub(env: Env): DurableObjectStub {
  return env.AGENT_HUB.get(env.AGENT_HUB.idFromName(HUB_NAME));
}

export function handleAgentConnect(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("token") !== env.AGENT_SHARED_TOKEN) {
    return Promise.resolve(new Response("unauthorized", { status: 401 }));
  }
  if (request.headers.get("Upgrade") !== "websocket") {
    return Promise.resolve(new Response("expected websocket", { status: 426 }));
  }
  return hub(env).fetch("https://agent-hub/connect", {
    headers: { Upgrade: "websocket" },
  });
}

// Returns true if a live agent received the command.
export async function pushToAgent(
  env: Env,
  repUserId: string,
  command: RecordCommand,
): Promise<boolean> {
  const res = await hub(env).fetch("https://agent-hub/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repUserId, command }),
  });
  if (!res.ok) {
    console.log("pushToAgent: hub returned", res.status);
    return false;
  }
  const json = (await res.json()) as { delivered?: boolean };
  return json.delivered ?? false;
}
