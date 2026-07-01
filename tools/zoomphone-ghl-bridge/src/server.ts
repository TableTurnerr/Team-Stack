// Self-hosted Node entrypoint. Replaces the Cloudflare Worker: builds an Env
// from process.env + SQLite, then serves the same `handleRequest` router over
// HTTP via @hono/node-server (which bridges Node's req/res to web Request/
// Response, including multipart bodies for the recording upload).
//
// Runs behind the Cloudflare Tunnel, so it binds to localhost by default.
//
// node:sqlite prints a one-time ExperimentalWarning at load. It's benign; to
// silence it in production launch with NODE_OPTIONS=--disable-warning=ExperimentalWarning.

import { serve } from "@hono/node-server";
import { handleRequest } from "./index";
import { buildEnv } from "./runtime/env";
import { createExecCtx } from "./runtime/context";
import { sweepStalePendingClips } from "./calls";
import { retryDeadLetters } from "./pipeline";

const { env, kv } = buildEnv();
const ctx = createExecCtx();

// Reclaim expired KV rows periodically (lazy expiry on read covers correctness;
// this keeps the table from growing unbounded). unref so it never holds the
// process open on its own.
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  try {
    const n = kv.sweep();
    if (n > 0) console.log(`[kv] swept ${n} expired row(s)`);
  } catch (err) {
    console.error("[kv] sweep failed:", err);
  }
}, SWEEP_INTERVAL_MS).unref();

// Park recorded clips that never correlated to a call (e.g. a dropped webhook)
// into GHL for manual review, so audio is never silently lost.
const CLIP_STALE_AFTER_MS = 15 * 60 * 1000;
setInterval(() => {
  sweepStalePendingClips(env, CLIP_STALE_AFTER_MS).catch((err) =>
    console.error("[clips] stale sweep failed:", err),
  );
}, SWEEP_INTERVAL_MS).unref();

// Replay dead-lettered Zoom events whose backoff has elapsed (e.g. a call that
// failed to reach GHL because the OAuth token had lapsed). Runs more often than
// the KV sweep so a transient outage recovers quickly. Failures keep the entry
// queued with exponential backoff until MAX_DLQ_ATTEMPTS.
const DLQ_RETRY_INTERVAL_MS = 60 * 1000;
setInterval(() => {
  retryDeadLetters(env).catch((err) => console.error("[dlq] retry sweep failed:", err));
}, DLQ_RETRY_INTERVAL_MS).unref();

const port = Number(process.env.PORT ?? 8787);
const hostname = process.env.HOST ?? "127.0.0.1";

serve(
  {
    fetch: (request: Request) => handleRequest(request, env, ctx),
    port,
    hostname,
  },
  (info) => {
    console.log(`[bridge] listening on http://${hostname}:${info.port}`);
  },
);
