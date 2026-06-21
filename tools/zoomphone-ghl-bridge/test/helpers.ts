import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, SqliteKv } from "../src/runtime/kv";
import { SqlitePendingClipStore } from "../src/runtime/clips";
import type { Env } from "../src/index";
import type { ExecCtx } from "../src/runtime/types";

// Hermetic test rig. Each test gets its own temp dir holding a fresh SQLite DB
// and a clips/ folder, plus a fetch stub that intercepts every outbound GHL /
// Zoom HTTP call so nothing touches the network. We exercise the REAL handler
// functions (handleRequest, handleCallLog via dispatch, handleRecordingIngest,
// sweepStalePendingClips) against this rig.

export type FetchCall = { url: string; method: string; body: unknown };

export interface TestRig {
  env: Env;
  kv: SqliteKv;
  clips: SqlitePendingClipStore;
  ctx: ExecCtx;
  /** Every intercepted outbound HTTP call, in order. */
  calls: FetchCall[];
  /** Monotonic id counters so each GHL "message"/"conversation"/"media" is unique. */
  cleanup(): void;
}

const SHARED_TOKEN = "test-agent-token";

// Synchronous waitUntil: tests await dispatch directly, but this keeps any
// fire-and-forget work observable and surfaces rejections.
function syncCtx(): ExecCtx {
  return { waitUntil: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}) };
}

export function makeRig(): TestRig {
  const dir = mkdtempSync(join(tmpdir(), "zpb-test-"));
  const db = openDb(join(dir, "bridge.db"));
  const kv = new SqliteKv(db);
  const clips = new SqlitePendingClipStore(db, join(dir, "clips"));

  const env: Env = {
    STATE: kv,
    CLIPS: clips,
    PUBLIC_BASE_URL: "https://test.example.com",
    ZOOM_SECRET_TOKEN: "zoom-secret",
    ZOOM_VERIFICATION_TOKEN: "zoom-verify",
    ZOOM_CLIENT_ID: "zoom-client",
    ZOOM_CLIENT_SECRET: "zoom-client-secret",
    ZOOM_ACCOUNT_ID: "zoom-account",
    GHL_MARKETPLACE_CLIENT_ID: "ghl-client",
    GHL_MARKETPLACE_CLIENT_SECRET: "ghl-client-secret",
    GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID: "ghl-provider",
    GHL_LOCATION_ID: "ghl-location",
    AGENT_SHARED_TOKEN: SHARED_TOKEN,
  };

  const calls: FetchCall[] = [];
  const realFetch = globalThis.fetch;
  let msgSeq = 0;
  let convSeq = 0;
  let mediaSeq = 0;

  // Pre-seed a long-lived GHL token so getGhlAccessToken() never needs network.
  void kv.put(
    "ghl:tokens",
    JSON.stringify({
      access_token: "test-access",
      refresh_token: "test-refresh",
      expires_at_ms: Date.now() + 60 * 60 * 1000,
      location_id: "ghl-location",
    }),
  );

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : (input as Request | URL).toString();
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        /* leave as string */
      }
    } else if (body instanceof FormData) {
      const entries: Record<string, string> = {};
      for (const [k, v] of body.entries()) entries[k] = v instanceof Blob ? `<blob:${v.size}>` : String(v);
      body = entries;
    }
    calls.push({ url, method, body });

    if (url.includes("/contacts/upsert")) {
      return jsonResponse({ contact: { id: "contact-1" }, new: true });
    }
    if (url.includes("/conversations/messages/upload")) {
      return jsonResponse({ uploadedFiles: { f: `https://ghl/upload/${++mediaSeq}.mp3` } });
    }
    if (url.includes("/conversations/messages/inbound") || url.includes("/conversations/messages/outbound")) {
      return jsonResponse({ messageId: `msg-${++msgSeq}`, conversationId: `conv-${++convSeq}` });
    }
    if (url.includes("/medias/upload-file")) {
      return jsonResponse({ url: `https://ghl/media/${++mediaSeq}.mp3` });
    }
    if (url.includes("/contacts/") && url.includes("/notes")) {
      return jsonResponse({ ok: true });
    }
    // Anything else (e.g. an unexpected Zoom download) → explicit failure so a
    // test that accidentally hits the network is obvious rather than silent.
    return new Response(`unhandled test fetch: ${method} ${url}`, { status: 599 });
  }) as typeof fetch;

  return {
    env,
    kv,
    clips,
    ctx: syncCtx(),
    calls,
    cleanup() {
      globalThis.fetch = realFetch;
      try {
        db.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function jsonResponse(obj: unknown): Response {
  return new Response(JSON.stringify(obj), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

export const TEST_SHARED_TOKEN = SHARED_TOKEN;

// ── builders for the fixtures the handlers consume ──

/** A Zoom *_call_log_completed envelope as pipeline.dispatch expects it. */
export function callLogEnvelope(opts: {
  direction: "inbound" | "outbound";
  callId: string;
  externalE164: string;
  internalE164?: string;
  dateIso?: string;
  duration?: number;
  result?: string;
}): { event: string; event_ts?: number; payload?: { object?: unknown } } {
  const { direction, callId, externalE164, internalE164 = "+18005550000", dateIso, duration = 42 } = opts;
  const log =
    direction === "outbound"
      ? {
          call_id: callId,
          caller_did_number: internalE164,
          caller_name: "Rep One",
          callee_did_number: externalE164,
          callee_name: "Lead",
          direction: "outbound",
          date_time: dateIso ?? new Date().toISOString(),
          duration,
          call_result: opts.result ?? "Call Connected",
        }
      : {
          call_id: callId,
          caller_did_number: externalE164,
          caller_name: "Lead",
          callee_did_number: internalE164,
          callee_name: "Rep One",
          direction: "inbound",
          date_time: dateIso ?? new Date().toISOString(),
          duration,
          call_result: opts.result ?? "Call Connected",
        };
  return {
    event:
      direction === "outbound"
        ? "phone.caller_call_log_completed"
        : "phone.callee_call_log_completed",
    event_ts: Date.now(),
    payload: { object: { call_logs: [log] } },
  };
}

/** Build a multipart Request for POST /recordings/ingest. */
export function ingestRequest(opts: {
  clientCallId: string;
  repKey?: string;
  phoneE164?: string;
  zoomCallId?: string;
  connectTsMs?: number;
  endTsMs?: number;
  channel?: string;
  direction?: string;
  audio?: Uint8Array;
  contentType?: string;
  token?: string;
}): Request {
  const form = new FormData();
  form.append("clientCallId", opts.clientCallId);
  if (opts.repKey != null) form.append("repKey", opts.repKey);
  if (opts.phoneE164 != null) form.append("phoneE164", opts.phoneE164);
  if (opts.zoomCallId != null) form.append("zoomCallId", opts.zoomCallId);
  if (opts.connectTsMs != null) form.append("connectTsMs", String(opts.connectTsMs));
  if (opts.endTsMs != null) form.append("endTsMs", String(opts.endTsMs));
  form.append("channel", opts.channel ?? "desktop");
  if (opts.direction != null) form.append("direction", opts.direction);
  const bytes = opts.audio ?? new Uint8Array([0x49, 0x44, 0x33, 0x04]); // "ID3"
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is exact.
  const part = new Uint8Array(bytes.byteLength);
  part.set(bytes);
  form.append("clip", new Blob([part], { type: opts.contentType ?? "audio/mpeg" }), "clip.mp3");

  return new Request("https://test.example.com/recordings/ingest", {
    method: "POST",
    headers: { Authorization: `Bearer ${opts.token ?? SHARED_TOKEN}` },
    body: form,
  });
}
