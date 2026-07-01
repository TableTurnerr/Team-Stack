import type { Env } from "../index";

// Dead-letter store for Zoom webhook events that failed to process.
//
// The webhook acks Zoom with 204 immediately and dispatches in the background,
// so a failure (GHL token dead, transient 5xx, network blip) used to be logged
// and silently lost — Zoom never retries a 2xx. These helpers persist the failed
// envelope in the SQLite KV under a `dlq:` prefix so a periodic sweep can replay
// it, and `/health` can surface how many are stuck. After MAX_ATTEMPTS an entry
// is moved to `dlqfail:` (permanent) so the active queue can't grow unbounded.

const DLQ_PREFIX = "dlq:";
const DLQ_FAILED_PREFIX = "dlqfail:";

export const MAX_DLQ_ATTEMPTS = 6;
// Retained long enough to debug, then reclaimed by the KV TTL.
const DLQ_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface DeadLetterRecord {
  event: string;
  envelope: unknown;
  attempts: number;
  first_error: string;
  last_error: string;
  first_seen_ms: number;
  next_attempt_ms: number;
}

// Exponential backoff with a 1h cap: 1m, 2m, 4m, 8m, 16m, 32m, 60m...
function backoffMs(attempts: number): number {
  return Math.min(60 * 60 * 1000, 60 * 1000 * 2 ** Math.max(0, attempts - 1));
}

function key(prefix: string, event: string, seenMs: number): string {
  // Sortable, unique-enough key. Multiple failures in the same ms for the same
  // event are vanishingly rare here and would simply overwrite.
  return `${prefix}${seenMs}:${event}`;
}

/** Record a freshly failed event (first failure from the live dispatch path). */
export async function recordDeadLetter(
  env: Env,
  envelope: { event: string },
  errorMsg: string,
): Promise<void> {
  const now = Date.now();
  const rec: DeadLetterRecord = {
    event: envelope.event,
    envelope,
    attempts: 1,
    first_error: errorMsg,
    last_error: errorMsg,
    first_seen_ms: now,
    next_attempt_ms: now + backoffMs(1),
  };
  await env.STATE.put(key(DLQ_PREFIX, envelope.event, now), JSON.stringify(rec), {
    expirationTtl: DLQ_TTL_SECONDS,
  });
}

export interface DeadLetterEntry {
  key: string;
  record: DeadLetterRecord;
}

/** All active (replayable) dead-letter entries. */
export async function listDeadLetters(env: Env): Promise<DeadLetterEntry[]> {
  const keys = await env.STATE.list(DLQ_PREFIX);
  const out: DeadLetterEntry[] = [];
  for (const k of keys) {
    const raw = await env.STATE.get(k);
    if (!raw) continue;
    try {
      out.push({ key: k, record: JSON.parse(raw) as DeadLetterRecord });
    } catch {
      // Corrupt row — drop it so the queue stays clean.
      await env.STATE.delete(k);
    }
  }
  return out;
}

export async function removeDeadLetter(env: Env, k: string): Promise<void> {
  await env.STATE.delete(k);
}

/** Re-enqueue after a failed retry: bump attempts + schedule the next try, or
 *  retire to the permanent-failure prefix once attempts are exhausted. */
export async function rescheduleDeadLetter(
  env: Env,
  entry: DeadLetterEntry,
  errorMsg: string,
): Promise<void> {
  const rec = entry.record;
  const attempts = rec.attempts + 1;
  await removeDeadLetter(env, entry.key);
  if (attempts >= MAX_DLQ_ATTEMPTS) {
    await env.STATE.put(
      key(DLQ_FAILED_PREFIX, rec.event, rec.first_seen_ms),
      JSON.stringify({ ...rec, attempts, last_error: errorMsg } satisfies DeadLetterRecord),
      { expirationTtl: DLQ_TTL_SECONDS },
    );
    return;
  }
  const next: DeadLetterRecord = {
    ...rec,
    attempts,
    last_error: errorMsg,
    next_attempt_ms: Date.now() + backoffMs(attempts),
  };
  await env.STATE.put(key(DLQ_PREFIX, rec.event, rec.first_seen_ms), JSON.stringify(next), {
    expirationTtl: DLQ_TTL_SECONDS,
  });
}

/** Counts for /health surfacing. */
export async function deadLetterStats(
  env: Env,
): Promise<{ pending: number; failed: number; oldestMs: number | null }> {
  const pendingKeys = await env.STATE.list(DLQ_PREFIX);
  const failedKeys = await env.STATE.list(DLQ_FAILED_PREFIX);
  let oldest: number | null = null;
  for (const k of pendingKeys) {
    // key shape: `dlq:<seenMs>:<event>`
    const seen = Number(k.slice(DLQ_PREFIX.length).split(":")[0]);
    if (Number.isFinite(seen)) oldest = oldest == null ? seen : Math.min(oldest, seen);
  }
  return { pending: pendingKeys.length, failed: failedKeys.length, oldestMs: oldest };
}
