import type { Env } from "../index";
import { toE164 } from "../phone";
import { upsertContact, logCall, uploadAudio, uploadMedia } from "../ghl/api";

const CLIP_TTL_SECONDS = 60 * 60 * 24 * 30;
const CONVERSATIONS_MAX_BYTES = 5 * 1024 * 1024;

type ClipState = { ghl_message_id: string; ghl_conversation_id?: string; contact_id?: string };

export async function handleRecordingIngest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
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

  const callId = str(form.get("callId"));
  const repUserId = str(form.get("repUserId"));
  const channel = str(form.get("channel"));
  const phoneE164 = toE164(str(form.get("phoneE164")));
  const connectTsMs = num(form.get("connectTsMs"));
  const endTsMs = num(form.get("endTsMs"));
  // The Workers runtime returns a File/Blob for file parts even though the type
  // declares get() as string | null; narrow through unknown.
  const clip = form.get("clip") as unknown;

  if (!callId) return new Response("missing callId", { status: 400 });
  if (!(clip instanceof Blob)) {
    return new Response("missing clip file", { status: 400 });
  }

  // Dedup by callId: a second upload for the same call is a no-op.
  const existingRaw = await env.STATE.get(`clip:${callId}`);
  if (existingRaw) {
    const existing = JSON.parse(existingRaw) as ClipState;
    return Response.json({ ghlMessageId: existing.ghl_message_id }, { status: 409 });
  }

  const audio = await clip.arrayBuffer();
  const contentType = clip.type || "audio/mpeg";
  const ext = contentType.includes("wav") ? "wav" : contentType.includes("mp4") ? "m4a" : "mp3";
  const filename = `call-${callId}.${ext}`;
  const durationSeconds =
    endTsMs > 0 && connectTsMs > 0 ? Math.max(0, Math.round((endTsMs - connectTsMs) / 1000)) : 0;
  const startTimeIso = connectTsMs > 0 ? new Date(connectTsMs).toISOString() : new Date().toISOString();

  // No phone number → never drop; park the clip in Medias for manual review.
  if (!phoneE164) {
    const mediaUrl = await uploadMedia(env, { audio, filename, contentType });
    await env.STATE.put(
      `review:${callId}`,
      JSON.stringify({ media_url: mediaUrl, repUserId, channel, connectTsMs, endTsMs }),
      { expirationTtl: CLIP_TTL_SECONDS },
    );
    // TODO: create a GHL task/note pointing ops at the review clip.
    console.log("ingest: no phone, parked for review", callId, mediaUrl);
    return Response.json({ status: "review" }, { status: 202 });
  }

  // Local recordings are placed by the rep, so the call is outbound from GHL's
  // perspective: rep -> lead. We have no rep DID in the payload; attribute the
  // call to the rep via userId and label `from` with the repUserId.
  const repFrom = repUserId ? `rep:${repUserId}` : "rep";
  const contact = await upsertContact(env, { phone: phoneE164, source: "Local Recording" });
  const logged = await logCall(env, {
    direction: "outbound",
    contactId: contact.id,
    from: repFrom,
    to: phoneE164,
    status: "completed",
    durationSeconds,
    startTimeIso,
    message: `Local call recording (${channel || "desktop"})`,
    userId: repUserId || undefined,
  });

  // Attach the audio. GHL's conversation upload caps at 5 MB; larger clips go
  // to the Medias API and are attached as a link on a follow-up message.
  if (audio.byteLength <= CONVERSATIONS_MAX_BYTES) {
    const ghlUrl = await uploadAudio(env, {
      conversationId: logged.conversationId,
      audio,
      filename,
      contentType,
    });
    await logCall(env, {
      direction: "outbound",
      contactId: contact.id,
      from: repFrom,
      to: phoneE164,
      status: "completed",
      durationSeconds,
      startTimeIso,
      attachmentUrls: [ghlUrl],
      message: "Call recording",
      userId: repUserId || undefined,
    });
  } else {
    const mediaUrl = await uploadMedia(env, { audio, filename, contentType });
    await logCall(env, {
      direction: "outbound",
      contactId: contact.id,
      from: repFrom,
      to: phoneE164,
      status: "completed",
      durationSeconds,
      startTimeIso,
      attachmentUrls: [mediaUrl],
      message: `Call recording (large file): ${mediaUrl}`,
      userId: repUserId || undefined,
    });
  }

  const state: ClipState = {
    ghl_message_id: logged.messageId,
    ghl_conversation_id: logged.conversationId,
    contact_id: contact.id,
  };
  ctx.waitUntil(
    env.STATE.put(`clip:${callId}`, JSON.stringify(state), { expirationTtl: CLIP_TTL_SECONDS }),
  );
  console.log("ingest: attached", callId, "contact", contact.id, "msg", logged.messageId);
  return Response.json({ ghlMessageId: logged.messageId }, { status: 200 });
}

function str(v: string | null): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: string | null): number {
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
