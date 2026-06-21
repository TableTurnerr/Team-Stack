import type { Env } from "../index";
import type { ExecCtx } from "../runtime/types";
import { toE164 } from "../phone";
import { uploadMedia } from "../ghl/api";
import { findCallStateByCallId, findCallStateByPhone, attachClipToCall } from "../calls";

const REVIEW_TTL_SECONDS = 60 * 60 * 24 * 30;

// Accepts a recorded call clip from a CRM agent and attaches it to the matching
// GHL call. The team shares one Zoom account, so correlation is by PHONE +
// CONNECT TIME (never the shared Zoom user_id — see docs §2): the clip is
// stored, then either attached immediately to an already-logged call
// (webhook-first) or left pending for the call-log handler to attach when the
// webhook arrives (clip-first). Rep attribution rides on the agent's repKey; the
// bridge owns direction via the correlated Zoom call.
export async function handleRecordingIngest(
  request: Request,
  env: Env,
  _ctx: ExecCtx,
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (auth !== `Bearer ${env.AGENT_SHARED_TOKEN}`) {
    return new Response("unauthorized", { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response("expected multipart/form-data", { status: 400 });
  }

  // clientCallId is the agent-minted dedup key. Accept the legacy `callId` and
  // `repUserId` field names so the current agent build keeps working until it's
  // updated to send repKey/clientCallId (W5).
  const clientCallId = str(form.get("clientCallId")) || str(form.get("callId"));
  const repKey = str(form.get("repKey")) || str(form.get("repUserId"));
  const channel = str(form.get("channel")) || "desktop";
  const phoneE164 = toE164(str(form.get("phoneE164")));
  const connectTsMs = num(form.get("connectTsMs"));
  const endTsMs = num(form.get("endTsMs"));
  const direction = str(form.get("direction")) || null; // advisory; correlated call wins
  const zoomCallId = str(form.get("zoomCallId")) || null; // real Zoom call_id, agent-resolved
  // The Workers runtime declared get() as string|null; the file part is a Blob.
  const clip = form.get("clip") as unknown;

  if (!clientCallId) return new Response("missing clientCallId/callId", { status: 400 });
  if (!(clip instanceof Blob)) return new Response("missing clip file", { status: 400 });

  // Dedup: a second upload for the same clientCallId is a no-op.
  const existingRaw = await env.STATE.get(`clip:${clientCallId}`);
  if (existingRaw) {
    const existing = JSON.parse(existingRaw) as { ghl_message_id: string };
    return Response.json({ ghlMessageId: existing.ghl_message_id }, { status: 409 });
  }

  const bytes = new Uint8Array(await clip.arrayBuffer());
  const contentType = clip.type || "audio/mpeg";

  // With neither a phone number NOR a resolved Zoom call_id we can't correlate
  // or contact-match; park for manual review.
  if (!phoneE164 && !zoomCallId) {
    console.log("ingest: no phone or call_id, parking for review", clientCallId, `(${bytes.byteLength}B)`);
    try {
      const ext = extFor(contentType);
      const mediaUrl = await uploadMedia(env, {
        audio: toArrayBuffer(bytes),
        filename: `review-${clientCallId}.${ext}`,
        contentType,
      });
      await env.STATE.put(
        `review:${clientCallId}`,
        JSON.stringify({ media_url: mediaUrl, repKey, channel, connectTsMs, endTsMs }),
        { expirationTtl: REVIEW_TTL_SECONDS },
      );
      console.log("ingest: parked for review", clientCallId, mediaUrl);
      return Response.json({ status: "review" }, { status: 202 });
    } catch (err) {
      console.error(
        "ingest: review-park via Medias FAILED for",
        clientCallId,
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
      return new Response("review park failed", { status: 500 });
    }
  }

  // Store the clip (covers the clip-arrived-before-webhook race and gives a
  // single attach path). Saving is idempotent on clientCallId, so an agent retry
  // just overwrites the pending row/file.
  const stored = await env.CLIPS.save(
    { clientCallId, zoomCallId, phoneE164: phoneE164 ?? "", connectTsMs, endTsMs, channel, repKey, direction, contentType },
    bytes,
  );

  // Webhook-first: if the Zoom call is already logged, attach now — by exact
  // Zoom call_id (agent resolved it via device-IP match), else by phone + time.
  let match = zoomCallId ? await findCallStateByCallId(env, zoomCallId) : null;
  if (!match && phoneE164) match = await findCallStateByPhone(env, phoneE164, connectTsMs);
  if (match) {
    try {
      const { messageId } = await attachClipToCall(env, stored, match.state);
      console.log("ingest: correlated + attached", clientCallId, "call", match.callId, "→ msg", messageId);
      return Response.json({ ghlMessageId: messageId, correlated: true }, { status: 200 });
    } catch (err) {
      console.error(
        "ingest: attach failed, leaving pending",
        clientCallId,
        err instanceof Error ? (err.stack ?? err.message) : String(err),
      );
      // fall through — clip stays pending; the webhook handler or sweep retries.
    }
  }

  // Clip-first: leave it pending; handleCallLog attaches it when the call logs.
  console.log("ingest: stored pending", clientCallId, "callId", zoomCallId ?? "(none)", "phone", phoneE164 ?? "(none)");
  return Response.json({ correlated: false, pending: true }, { status: 200 });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function extFor(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  return "mp3";
}

type FormValue = ReturnType<FormData["get"]>;

function str(v: FormValue): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: FormValue): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
