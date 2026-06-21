import type { Env } from "../index";
import type { Hello, IncomingFrame, RecordCommand } from "./contracts";

type SocketMeta = { repUserId: string; machineId?: string };

// One Durable Object instance (fixed name "global") holds every connected rep
// agent's WebSocket, keyed by repUserId. Hibernatable: sockets survive eviction
// and are recovered via getWebSockets(); we also stash repUserId in the socket
// attachment so a recovered socket still knows which rep it belongs to.
export class AgentHub implements DurableObject {
  private readonly state: DurableObjectState;
  private readonly env: Env;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/connect") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("expected websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/push" && request.method === "POST") {
      const { repUserId, command } = (await request.json()) as {
        repUserId: string;
        command: RecordCommand;
      };
      const delivered = this.push(repUserId, command);
      return Response.json({ delivered });
    }

    return new Response("not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    let frame: IncomingFrame;
    try {
      frame = JSON.parse(text) as IncomingFrame;
    } catch {
      console.log("AgentHub: non-JSON frame, ignoring");
      return;
    }

    switch (frame.type) {
      case "HELLO":
        return this.onHello(ws, frame);
      case "PING":
        ws.send(JSON.stringify({ type: "PONG" }));
        return;
      case "PONG":
        return;
      default:
        console.log("AgentHub: unhandled frame", (frame as { type?: string }).type);
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const meta = this.metaOf(ws);
    console.log("AgentHub: socket closed", meta?.repUserId ?? "(unregistered)", code);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const meta = this.metaOf(ws);
    console.log("AgentHub: socket error", meta?.repUserId ?? "(unregistered)");
  }

  private onHello(ws: WebSocket, hello: Hello): void {
    if (hello.token !== this.env.AGENT_SHARED_TOKEN) {
      console.log("AgentHub: HELLO rejected (bad token) for", hello.repUserId);
      ws.close(4001, "unauthorized");
      return;
    }
    if (!hello.repUserId) {
      ws.close(4002, "missing repUserId");
      return;
    }
    // A rep can only have one live socket; drop any stale one for the same rep.
    for (const other of this.state.getWebSockets()) {
      if (other === ws) continue;
      if (this.metaOf(other)?.repUserId === hello.repUserId) {
        try {
          other.close(4003, "replaced");
        } catch {
          /* already closing */
        }
      }
    }
    const meta: SocketMeta = { repUserId: hello.repUserId, machineId: hello.machineId };
    ws.serializeAttachment(meta);
    console.log("AgentHub: registered", hello.repUserId, "machine", hello.machineId, "v", hello.agentVersion);
  }

  private push(repUserId: string, command: RecordCommand): boolean {
    let delivered = false;
    for (const ws of this.state.getWebSockets()) {
      if (this.metaOf(ws)?.repUserId !== repUserId) continue;
      try {
        ws.send(JSON.stringify(command));
        delivered = true;
      } catch (err) {
        console.log("AgentHub: send failed for", repUserId, String(err));
      }
    }
    if (!delivered) console.log("AgentHub: no live agent for rep", repUserId, "- noop");
    return delivered;
  }

  private metaOf(ws: WebSocket): SocketMeta | null {
    try {
      const att = ws.deserializeAttachment() as SocketMeta | null;
      return att && att.repUserId ? att : null;
    } catch {
      return null;
    }
  }
}
