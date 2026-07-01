// Minimal, zero-dependency telemetry sender for the bridge.
//
// Ships structured log lines to the central ingest API on the parent site so
// failures (e.g. a call that never reached GHL) show up on the admin /logs
// dashboard and can trip error-spike alerts. The bridge is deliberately
// dependency-light and runs under tsx with no build step, so this is vendored
// here rather than importing the shared @crm-tableturnerr/telemetry-client
// package (used by the Node apps that have a build pipeline).
//
// Config is read from process.env (like PORT/HOST in server.ts):
//   TELEMETRY_URL   - parent-site base, e.g. https://tableturnerr.com
//   TELEMETRY_TOKEN - bearer for the ingest API (server-side secret)
//   SERVICE_KEY     - defaults to "zoomphone-bridge"
// If URL or TOKEN is unset, every call is a no-op (local dev stays quiet).
//
// The bridge is monitored over HTTP (/health), so it does NOT send heartbeats —
// only logs. All calls are fire-and-forget and never throw into the caller.

type Level = "debug" | "info" | "warn" | "error" | "fatal";

const URL_BASE = (process.env.TELEMETRY_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.TELEMETRY_TOKEN ?? "";
const SERVICE_KEY = process.env.SERVICE_KEY ?? "zoomphone-bridge";
const ENABLED = URL_BASE.length > 0 && TOKEN.length > 0;

let warnedDisabled = false;
if (!ENABLED && process.env.NODE_ENV !== "test") {
  // Warn once so a misconfigured box is noticeable without spamming logs.
  warnedDisabled = true;
}

export function telemetryLog(
  level: Level,
  message: string,
  opts?: { event?: string; context?: Record<string, unknown> },
): void {
  if (!ENABLED) {
    if (warnedDisabled) {
      warnedDisabled = false;
      console.warn("[telemetry] disabled (TELEMETRY_URL/TELEMETRY_TOKEN unset)");
    }
    return;
  }
  if (typeof fetch !== "function") return;
  const body = JSON.stringify({
    service_key: SERVICE_KEY,
    entries: [
      {
        level,
        message: message.slice(0, 8192),
        event: opts?.event,
        context: opts?.context ?? {},
        ts: new Date().toISOString(),
      },
    ],
  });
  // Fire-and-forget; swallow all errors (telemetry must never break the bridge).
  void fetch(`${URL_BASE}/api/telemetry/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
    body,
    signal: AbortSignal.timeout(5000),
  }).catch(() => {});
}
