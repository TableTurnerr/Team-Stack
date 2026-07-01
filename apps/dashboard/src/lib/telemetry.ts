/**
 * Serverless-safe telemetry for the CRM dashboard.
 *
 * The dashboard runs on Vercel Functions, so the batch-on-a-timer client in
 * `@crm-tableturnerr/telemetry-client` won't survive a function freeze. This is
 * a dependency-free, fire-per-call helper: each log is a single POST to the
 * parent-site ingest API. Callers collect the returned promises and await them
 * (via `flushTelemetry`) right before responding, so nothing is dropped when
 * the function suspends.
 *
 * Config (Vercel env on the dashboard project):
 *   TELEMETRY_URL    parent-site base, e.g. https://tableturnerr.com
 *   TELEMETRY_TOKEN  bearer for the ingest API (server-side secret)
 *   SERVICE_KEY      defaults to "crm-dashboard"
 *
 * No-op when TELEMETRY_URL / TELEMETRY_TOKEN are unset.
 */

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

interface LogEntry {
  level: Level;
  message: string;
  event?: string;
  context?: Record<string, unknown>;
  ts?: string;
}

const URL_BASE = (process.env.TELEMETRY_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.TELEMETRY_TOKEN || '';
const SERVICE_KEY = process.env.SERVICE_KEY || 'crm-dashboard';
const ENABLED = Boolean(URL_BASE && TOKEN);
const SEND_TIMEOUT_MS = 3000;

/**
 * Send a single log entry to the ingest API. Best-effort: resolves even on
 * failure so telemetry can never break the caller. Returns immediately (a
 * resolved promise) when telemetry is unconfigured.
 */
export function telemetryLog(entry: LogEntry): Promise<void> {
  if (!ENABLED) return Promise.resolve();
  const body = JSON.stringify({
    service_key: SERVICE_KEY,
    entries: [{ ...entry, ts: entry.ts ?? new Date().toISOString() }],
  });
  return fetch(`${URL_BASE}/api/telemetry/logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body,
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/** Await a batch of in-flight telemetry sends without ever throwing. */
export async function flushTelemetry(
  ...sends: Array<Promise<void> | undefined>
): Promise<void> {
  const pending = sends.filter((p): p is Promise<void> => Boolean(p));
  if (pending.length === 0) return;
  await Promise.allSettled(pending);
}
