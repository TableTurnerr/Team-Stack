import { StoredWebhook, forwardWebhook } from "./zoom";
import { Env, FAILED_PREFIX, RECORDING_PREFIX, WEBHOOK_PREFIX, fetchHome, homeHealthy } from "./util";

const WEBHOOK_BATCH = 100;
const RECORDING_BATCH = 20;
const LOCK_KEY = "drain:lock";
const LOCK_TTL_SECONDS = 120;

export interface DrainResult {
  skipped: "empty" | "home_down" | "locked" | null;
  webhooksSent: number;
  recordingsSent: number;
  movedToFailed: number;
  aborted: string | null;
}

/**
 * Push everything buffered in R2 back to the home server, oldest first.
 *
 * Order matters: webhooks (call-log events) drain before recordings so the
 * bridge has call state to correlate clips against. The bridge is idempotent
 * on Zoom call_id / clientCallId, so re-delivery is always safe.
 *
 * Objects are deleted the moment home confirms them — the relay keeps nothing.
 * Definitive 4xx rejections move to `failed/` for manual review instead of
 * blocking the queue; 401/403 aborts the run (token mismatch is a config
 * problem, not a data problem).
 */
export async function drain(env: Env): Promise<DrainResult> {
  const result: DrainResult = { skipped: null, webhooksSent: 0, recordingsSent: 0, movedToFailed: 0, aborted: null };

  // Cheap empty probe first. The common case — nothing buffered because home
  // is healthy — must cost almost nothing: 1–2 R2 list calls, no KV writes,
  // no request to the home server. This keeps the every-2-min cron far inside
  // the free tier (KV free allows only 1,000 writes/day).
  const probeWebhooks = await env.BUFFER.list({ prefix: WEBHOOK_PREFIX, limit: 1 });
  let hasWork = probeWebhooks.objects.length > 0;
  if (!hasWork) {
    const probeRecordings = await env.BUFFER.list({ prefix: RECORDING_PREFIX, limit: 1 });
    hasWork = probeRecordings.objects.length > 0;
  }
  if (!hasWork) {
    result.skipped = "empty";
    return result;
  }

  if (!(await homeHealthy(env))) {
    result.skipped = "home_down";
    return result;
  }

  // Best-effort overlap guard (KV is eventually consistent; overlap is harmless
  // because the bridge dedupes — this just avoids wasted duplicate uploads).
  if (await env.KV.get(LOCK_KEY)) {
    result.skipped = "locked";
    return result;
  }
  await env.KV.put(LOCK_KEY, String(Date.now()), { expirationTtl: LOCK_TTL_SECONDS });

  try {
    // 1) Webhook envelopes — restore call/contact state on the bridge first.
    const webhooks = await env.BUFFER.list({ prefix: WEBHOOK_PREFIX, limit: WEBHOOK_BATCH });
    for (const obj of webhooks.objects) {
      const record = await env.BUFFER.get(obj.key);
      if (!record) continue;

      let stored: StoredWebhook;
      try {
        stored = JSON.parse(await record.text()) as StoredWebhook;
      } catch {
        await moveToFailed(env, obj.key, "unparseable webhook record");
        result.movedToFailed++;
        continue;
      }

      let res: Response;
      try {
        res = await forwardWebhook(env, stored);
      } catch {
        result.aborted = `home stopped responding while draining ${obj.key}`;
        return result; // home flaked mid-drain — stop, keep FIFO order
      }

      if (res.ok) {
        await env.BUFFER.delete(obj.key);
        result.webhooksSent++;
      } else if (res.status === 401 || res.status === 403) {
        result.aborted = `home rejected auth (${res.status}) — check ZOOM_SECRET_TOKEN parity`;
        return result;
      } else if (res.status >= 400 && res.status < 500) {
        await moveToFailed(env, obj.key, JSON.stringify(stored), "application/json");
        result.movedToFailed++;
      } else {
        result.aborted = `home returned ${res.status} while draining ${obj.key}`;
        return result;
      }
    }

    // 2) Recordings — replayed to the same ingest endpoint; 409 means the
    //    bridge already has this clientCallId (success).
    const recordings = await env.BUFFER.list({ prefix: RECORDING_PREFIX, limit: RECORDING_BATCH });
    for (const obj of recordings.objects) {
      const record = await env.BUFFER.get(obj.key);
      if (!record) continue;
      const contentType = record.httpMetadata?.contentType ?? "application/octet-stream";
      const body = await record.arrayBuffer();

      let res: Response;
      try {
        res = await fetchHome(env, "/recordings/ingest", {
          method: "POST",
          headers: { "content-type": contentType, authorization: `Bearer ${env.AGENT_SHARED_TOKEN}` },
          body,
          timeoutMs: 120_000,
        });
      } catch {
        result.aborted = `home stopped responding while draining ${obj.key}`;
        return result;
      }

      if (res.ok || res.status === 409) {
        await env.BUFFER.delete(obj.key);
        result.recordingsSent++;
      } else if (res.status === 401 || res.status === 403) {
        result.aborted = `home rejected auth (${res.status}) — check AGENT_SHARED_TOKEN parity`;
        return result;
      } else if (res.status >= 400 && res.status < 500) {
        await moveToFailed(env, obj.key, body, contentType);
        result.movedToFailed++;
      } else {
        result.aborted = `home returned ${res.status} while draining ${obj.key}`;
        return result;
      }
    }

    return result;
  } finally {
    await env.KV.delete(LOCK_KEY);
  }
}

async function moveToFailed(
  env: Env,
  key: string,
  body: ArrayBuffer | string,
  contentType?: string,
): Promise<void> {
  await env.BUFFER.put(`${FAILED_PREFIX}${key}`, body, {
    httpMetadata: contentType ? { contentType } : undefined,
    customMetadata: { originalKey: key, failedAt: String(Date.now()) },
  });
  await env.BUFFER.delete(key);
}
