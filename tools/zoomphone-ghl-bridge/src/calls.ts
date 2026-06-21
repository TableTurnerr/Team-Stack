import type { Env } from "./index";
import type { StoredClip } from "./runtime/types";
import { logCall, uploadAudio, uploadMedia } from "./ghl/api";
import { resolveRepUserId } from "./reps";

// Call-state persistence + recorded-clip correlation. Shared by the webhook
// pipeline (which logs calls) and the recording-ingest route (which uploads
// clips). The whole team shares one Zoom account, so a clip is matched to its
// Zoom call by PHONE + CONNECT TIME only — never by the (shared) Zoom user_id —
// and rep attribution comes from the agent's device-provisioned repKey. See
// docs/selfhost-and-responsibility-split-plan.md §2.

const STATE_TTL_SECONDS = 60 * 60 * 24 * 30; // call:{id} — 30 days
const RECENT_TTL_SECONDS = 60 * 60; // recent:{phone} — 1 hour
const CLIP_DEDUP_TTL_SECONDS = 60 * 60 * 24 * 30; // clip:{clientCallId} — 30 days
const CORRELATION_WINDOW_MS = 5 * 60 * 1000; // ±5 min phone+time match
const CONVERSATIONS_MAX_BYTES = 5 * 1024 * 1024; // GHL conversation upload cap

export type CallState = {
  ghl_contact_id: string;
  ghl_conversation_id: string;
  ghl_message_id: string;
  direction: "inbound" | "outbound";
  external_phone: string;
  internal_phone: string;
  rep_name: string;
  start_iso: string;
};

export async function readCallState(env: Env, key: string): Promise<CallState | null> {
  const raw = await env.STATE.get(`call:${key}`);
  return raw ? (JSON.parse(raw) as CallState) : null;
}

export async function writeCallState(env: Env, key: string, state: CallState): Promise<void> {
  await env.STATE.put(`call:${key}`, JSON.stringify(state), { expirationTtl: STATE_TTL_SECONDS });
}

export async function waitForCallState(
  env: Env,
  key: string,
  attempts = 6,
  delayMs = 5000,
): Promise<CallState | null> {
  for (let i = 0; i < attempts; i++) {
    const state = await readCallState(env, key);
    if (state) return state;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export async function lookupRepUserId(env: Env, did: string | null): Promise<string | undefined> {
  if (!did) return undefined;
  const raw = await env.STATE.get(`rep:${did}`);
  if (!raw) return undefined;
  try {
    const mapping = JSON.parse(raw) as { ghl_user_id?: string };
    return mapping.ghl_user_id;
  } catch {
    return undefined;
  }
}

// Forward index: external phone -> most recent logged Zoom call_id. Lets a clip
// upload find a call the bridge already logged (webhook-arrived-first ordering).
export async function writeRecentCallIndex(env: Env, phoneE164: string, callId: string): Promise<void> {
  if (!phoneE164) return;
  await env.STATE.put(`recent:${phoneE164}`, callId, { expirationTtl: RECENT_TTL_SECONDS });
}

// Exact correlation: the agent resolved the real Zoom call_id (device-IP match
// against call_history), so we attach straight to that logged call.
export async function findCallStateByCallId(
  env: Env,
  callId: string,
): Promise<{ callId: string; state: CallState } | null> {
  if (!callId) return null;
  const state = await readCallState(env, callId);
  return state ? { callId, state } : null;
}

export async function findCallStateByPhone(
  env: Env,
  phoneE164: string,
  connectTsMs: number,
  windowMs = CORRELATION_WINDOW_MS,
): Promise<{ callId: string; state: CallState } | null> {
  if (!phoneE164) return null;
  const callId = await env.STATE.get(`recent:${phoneE164}`);
  if (!callId) return null;
  const state = await readCallState(env, callId);
  if (!state) return null;
  const startMs = Date.parse(state.start_iso);
  if (Number.isFinite(startMs) && connectTsMs > 0 && Math.abs(startMs - connectTsMs) > windowMs) {
    return null;
  }
  return { callId, state };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function extFor(contentType: string): string {
  if (contentType.includes("wav")) return "wav";
  if (contentType.includes("mp4") || contentType.includes("m4a")) return "m4a";
  return "mp3";
}

/**
 * Attach a recorded clip to the GHL conversation of an already-logged call,
 * using the call's authoritative direction/contact and the clip's rep identity.
 * Idempotent per clientCallId via the clip:{id} guard, so the forward (ingest)
 * and reverse (webhook) paths can't double-attach.
 */
export async function attachClipToCall(
  env: Env,
  clip: StoredClip,
  state: CallState,
): Promise<{ messageId: string }> {
  const guardRaw = await env.STATE.get(`clip:${clip.clientCallId}`);
  if (guardRaw) {
    const g = JSON.parse(guardRaw) as { ghl_message_id: string };
    await env.CLIPS.remove(clip.clientCallId);
    return { messageId: g.ghl_message_id };
  }

  const audio = toArrayBuffer(await env.CLIPS.readBytes(clip));
  const filename = `local-call-${clip.clientCallId}.${extFor(clip.contentType)}`;
  const from = state.direction === "outbound" ? state.internal_phone : state.external_phone;
  const to = state.direction === "outbound" ? state.external_phone : state.internal_phone;
  // Rep attribution comes from the agent's device-provisioned repKey (the shared
  // Zoom account can't supply it). repKey resolves to a GHL userId via the rep
  // mapping (passthrough default: repKey IS the GHL userId). Fall back to the
  // webhook-derived rep DID map only when the clip carries no repKey.
  const repUserId =
    (await resolveRepUserId(env, clip.repKey)) ??
    (await lookupRepUserId(env, state.internal_phone || null));
  const durationSeconds =
    clip.endTsMs > clip.connectTsMs ? Math.round((clip.endTsMs - clip.connectTsMs) / 1000) : 0;

  const attachmentUrl =
    audio.byteLength <= CONVERSATIONS_MAX_BYTES
      ? await uploadAudio(env, {
          conversationId: state.ghl_conversation_id,
          audio,
          filename,
          contentType: clip.contentType,
        })
      : await uploadMedia(env, { audio, filename, contentType: clip.contentType });

  const logged = await logCall(env, {
    direction: state.direction,
    contactId: state.ghl_contact_id,
    from,
    to,
    status: "completed",
    durationSeconds,
    startTimeIso: state.start_iso,
    attachmentUrls: [attachmentUrl],
    message: `Call recording (local, ${clip.channel})`,
    userId: repUserId,
  });

  await env.STATE.put(
    `clip:${clip.clientCallId}`,
    JSON.stringify({
      ghl_message_id: logged.messageId,
      ghl_conversation_id: logged.conversationId,
      contact_id: state.ghl_contact_id,
    }),
    { expirationTtl: CLIP_DEDUP_TTL_SECONDS },
  );
  await env.CLIPS.remove(clip.clientCallId);
  return { messageId: logged.messageId };
}

/**
 * Reverse path: when a call is logged, attach any clips that were uploaded
 * before its webhook arrived (clip-arrived-first ordering). Matches clips that
 * already carry this Zoom call_id (exact), then by phone + time (fallback).
 */
export async function reconcilePendingClips(
  env: Env,
  callId: string,
  phoneE164: string,
  state: CallState,
): Promise<void> {
  const seen = new Set<string>();
  const clips: StoredClip[] = [];
  for (const c of await env.CLIPS.findByZoomCallId(callId)) {
    if (!seen.has(c.clientCallId)) {
      seen.add(c.clientCallId);
      clips.push(c);
    }
  }
  if (phoneE164) {
    const startMs = Date.parse(state.start_iso);
    const around = Number.isFinite(startMs) ? startMs : Date.now();
    for (const c of await env.CLIPS.findMatches(phoneE164, around, CORRELATION_WINDOW_MS)) {
      if (!seen.has(c.clientCallId)) {
        seen.add(c.clientCallId);
        clips.push(c);
      }
    }
  }
  for (const clip of clips) {
    try {
      const { messageId } = await attachClipToCall(env, clip, state);
      console.log("reverse-attached clip", clip.clientCallId, "→ msg", messageId);
    } catch (err) {
      console.error(
        "reverse-attach failed",
        clip.clientCallId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

/**
 * Park stale pending clips (no call ever correlated them — e.g. a dropped
 * webhook) into GHL Medias for manual review so audio is never silently lost.
 * Called on an interval by the server.
 */
export async function sweepStalePendingClips(env: Env, olderThanMs: number): Promise<void> {
  const stale = await env.CLIPS.listStale(olderThanMs);
  for (const clip of stale) {
    // Last chance: a matching call may have been logged since it was queued —
    // by exact Zoom call_id first, then phone + time.
    const match =
      (clip.zoomCallId ? await findCallStateByCallId(env, clip.zoomCallId) : null) ??
      (await findCallStateByPhone(env, clip.phoneE164, clip.connectTsMs));
    if (match) {
      try {
        await attachClipToCall(env, clip, match.state);
        continue;
      } catch {
        /* fall through to review parking */
      }
    }
    try {
      const audio = toArrayBuffer(await env.CLIPS.readBytes(clip));
      const mediaUrl = await uploadMedia(env, {
        audio,
        filename: `review-${clip.clientCallId}.${extFor(clip.contentType)}`,
        contentType: clip.contentType,
      });
      await env.STATE.put(
        `review:${clip.clientCallId}`,
        JSON.stringify({
          media_url: mediaUrl,
          phoneE164: clip.phoneE164,
          repKey: clip.repKey,
          channel: clip.channel,
          connectTsMs: clip.connectTsMs,
          endTsMs: clip.endTsMs,
        }),
        { expirationTtl: STATE_TTL_SECONDS },
      );
      console.log("parked stale clip for review", clip.clientCallId, mediaUrl);
      await env.CLIPS.remove(clip.clientCallId);
    } catch (err) {
      console.error(
        "stale-clip review failed",
        clip.clientCallId,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}
