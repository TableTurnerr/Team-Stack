import type { Env } from "./index";
import { toE164 } from "./phone";
import { upsertContact, logCall, uploadAudio, addContactNote, type CallStatus } from "./ghl/api";
import { downloadZoomAudio, fetchTextWithAuth } from "./zoom/api";
import {
  readCallState,
  writeCallState,
  waitForCallState,
  lookupRepUserId,
  writeRecentCallIndex,
  reconcilePendingClips,
  type CallState,
} from "./calls";

type ZoomCallLog = {
  id?: string;
  call_id?: string;
  caller_number?: string;
  caller_name?: string;
  caller_did_number?: string;
  callee_number?: string;
  callee_name?: string;
  callee_did_number?: string;
  direction?: string;
  date_time?: string;
  duration?: number;
  call_result?: string;
  result?: string;
  has_recording?: boolean;
  has_voicemail?: boolean;
};

type ZoomRecording = {
  id: string;
  call_id: string;
  download_url: string;
  duration?: number;
  date_time?: string;
};

type ZoomVoicemail = {
  id: string;
  call_id?: string;
  download_url: string;
  duration?: number;
  caller_number?: string;
  caller_name?: string;
  callee_number?: string;
  date_time?: string;
};

type ZoomVoicemailTranscript = {
  id?: string;
  call_id?: string;
  voicemail_id?: string;
  transcript?: string;
  download_url?: string;
};

// Live phone events (phone.caller_connected / callee_answered / *_ended). Each
// carries the call_id plus a caller and callee leg; the rep is the caller on
// outbound (connected) and the callee on inbound (answered).
type ZoomLiveLeg = {
  user_id?: string;
  phone_number?: string;
  extension_number?: string;
  extension_type?: string;
  device_id?: string;
};

type ZoomLiveCall = {
  call_id?: string;
  caller?: ZoomLiveLeg;
  callee?: ZoomLiveLeg;
};

type Envelope = {
  event: string;
  event_ts?: number;
  payload?: { object?: unknown } | undefined;
};

export async function dispatch(envelope: Envelope, env: Env): Promise<void> {
  console.log(`EVENT ${envelope.event} PAYLOAD:`, JSON.stringify(envelope.payload));
  const obj = envelope.payload?.object;
  if (!obj || typeof obj !== "object") {
    console.log("dispatch: no payload.object", envelope.event);
    return;
  }
  try {
    switch (envelope.event) {
      case "phone.caller_call_log_completed":
      case "phone.callee_call_log_completed": {
        const direction =
          envelope.event === "phone.caller_call_log_completed" ? "outbound" : "inbound";
        const logs = (obj as { call_logs?: ZoomCallLog[] }).call_logs;
        if (!Array.isArray(logs) || logs.length === 0) {
          console.log("no call_logs in payload", envelope.event);
          return;
        }
        for (const log of logs) {
          await handleCallLog(env, log, direction);
        }
        return;
      }
      case "phone.recording_completed":
        return await handleRecording(env, obj as ZoomRecording);
      case "phone.voicemail_received":
        return await handleVoicemail(env, obj as ZoomVoicemail);
      case "phone.voicemail_transcription_completed":
        return await handleVoicemailTranscript(env, obj as ZoomVoicemailTranscript);
      case "phone.caller_connected":
        return await handleLiveStart(env, obj as ZoomLiveCall, "outbound", envelope.event_ts);
      case "phone.callee_answered":
        return await handleLiveStart(env, obj as ZoomLiveCall, "inbound", envelope.event_ts);
      case "phone.caller_ended":
      case "phone.callee_ended":
        return await handleLiveStop(env, obj as ZoomLiveCall, envelope.event_ts);
      default:
        console.log("dispatch: unhandled event", envelope.event);
    }
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    console.error(`dispatch error [${envelope.event}]:`, msg);
  }
}

// Live phone events (caller_connected / callee_answered / *_ended) used to push
// START/STOP to the rep's agent over a Durable Object WebSocket. On a SHARED
// Zoom account that routing is impossible: every event carries the same
// user_id, so the bridge can't tell which device should record. The agent now
// self-detects the call locally and records; the bridge reconciles the uploaded
// clip to this call by phone + time in /recordings/ingest. These handlers are
// retained only to observe live timing — W4 will seed a `recent:{phone}` index
// here to speed that correlation. For now they just log.
//
// Outbound (caller_connected): rep is the caller leg, external party is callee.
// Inbound (callee_answered): rep is the callee leg, external party is caller.
async function handleLiveStart(
  _env: Env,
  call: ZoomLiveCall,
  direction: "inbound" | "outbound",
  eventTs: number | undefined,
): Promise<void> {
  const callId = call.call_id;
  if (!callId) {
    console.log("live start missing call_id, skipping");
    return;
  }
  const externalLeg = direction === "outbound" ? call.callee : call.caller;
  const phoneE164 = toE164(externalLeg?.phone_number);
  console.log("live START seen", callId, direction, "phone", phoneE164, "ts", tsToMs(eventTs));
}

async function handleLiveStop(
  _env: Env,
  call: ZoomLiveCall,
  eventTs: number | undefined,
): Promise<void> {
  const callId = call.call_id;
  if (!callId) {
    console.log("live stop missing call_id, skipping");
    return;
  }
  console.log("live STOP seen", callId, "ts", tsToMs(eventTs));
}

function tsToMs(eventTs: number | undefined): number {
  // Zoom event_ts is already epoch milliseconds; fall back to now if absent.
  return typeof eventTs === "number" ? eventTs : Date.now();
}

async function handleCallLog(
  env: Env,
  call: ZoomCallLog,
  direction: "inbound" | "outbound",
): Promise<void> {
  const callId = call.call_id ?? call.id;
  if (!callId) {
    console.log("call log missing id/call_id, skipping:", JSON.stringify(call));
    return;
  }
  const existing = await readCallState(env, callId);
  if (existing) {
    console.log("call already logged, skipping", callId);
    return;
  }

  // For outbound: caller is the rep, callee is the contact.
  // For inbound: caller is the contact, callee is the rep.
  // Zoom's *_number field is often the Zoom extension (e.g. "800") while
  // *_did_number is the real PSTN E.164 — prefer DID for both sides.
  const externalRaw =
    direction === "outbound"
      ? (call.callee_did_number ?? call.callee_number)
      : (call.caller_number ?? call.caller_did_number);
  const externalName = direction === "outbound" ? call.callee_name : call.caller_name;
  const internalRaw =
    direction === "outbound"
      ? (call.caller_did_number ?? call.caller_number)
      : (call.callee_did_number ?? call.callee_number);
  const external = toE164(externalRaw);
  const internal = toE164(internalRaw);
  if (!external) {
    console.log("no external number on call, skipping", call.call_id);
    return;
  }

  const contact = await upsertContact(env, {
    phone: external,
    firstName: externalName,
    source: "Zoom Phone",
  });

  const status = mapCallResult(call.call_result ?? call.result);
  const startIso = call.date_time ?? new Date().toISOString();
  const from = direction === "outbound" ? (internal ?? "") : external;
  const to = direction === "outbound" ? external : (internal ?? "");
  const repName = direction === "outbound" ? call.caller_name : call.callee_name;
  const repLabel = formatRepLabel(repName, internal);
  const repUserId = await lookupRepUserId(env, internal);
  const message =
    direction === "outbound"
      ? `Outbound call by ${repLabel} to ${external}. Duration: ${call.duration ?? 0}s. Result: ${call.result ?? call.call_result ?? status}.`
      : `Inbound call to ${repLabel} from ${external}. Duration: ${call.duration ?? 0}s. Result: ${call.result ?? call.call_result ?? status}.`;

  const logged = await logCall(env, {
    direction,
    contactId: contact.id,
    from,
    to,
    status,
    durationSeconds: call.duration ?? 0,
    startTimeIso: startIso,
    message,
    userId: repUserId,
  });

  const state: CallState = {
    ghl_contact_id: contact.id,
    ghl_conversation_id: logged.conversationId,
    ghl_message_id: logged.messageId,
    direction,
    external_phone: external,
    internal_phone: internal ?? "",
    rep_name: repName ?? "",
    start_iso: startIso,
  };
  await writeCallState(env, callId, state);
  // Index by external phone so a clip upload can correlate (webhook-first), and
  // attach any clips that arrived before this webhook landed (clip-first), by
  // exact Zoom call_id or by phone + time.
  await writeRecentCallIndex(env, external, callId);
  await reconcilePendingClips(env, callId, external, state);
  console.log("logged call", callId, direction, status, "by", repLabel, "contact", contact.id);
}

async function handleRecording(env: Env, rec: ZoomRecording): Promise<void> {
  const state = await waitForCallState(env, rec.call_id);
  if (!state) {
    console.log("recording: no matching call_log state after wait, dropping", rec.call_id);
    return;
  }
  const { audio, contentType } = await downloadZoomAudio(env, rec.download_url);
  const ext = contentType.includes("wav") ? "wav" : "mp3";
  const ghlUrl = await uploadAudio(env, {
    conversationId: state.ghl_conversation_id,
    audio,
    filename: `zoom-call-${rec.call_id}.${ext}`,
    contentType,
  });
  // Post a follow-up Call entry that carries the recording attachment.
  // GHL has no PATCH endpoint for an existing call message, so this is a second
  // timeline entry. Users will see the original call entry plus a playback widget below it.
  const from = state.direction === "outbound" ? state.internal_phone : state.external_phone;
  const to = state.direction === "outbound" ? state.external_phone : state.internal_phone;
  const repLabel = formatRepLabel(state.rep_name, state.internal_phone);
  const repUserId = await lookupRepUserId(env, state.internal_phone || null);
  await logCall(env, {
    direction: state.direction,
    contactId: state.ghl_contact_id,
    from,
    to,
    status: "completed",
    durationSeconds: rec.duration ?? 0,
    startTimeIso: rec.date_time ?? state.start_iso,
    attachmentUrls: [ghlUrl],
    message:
      state.direction === "outbound"
        ? `Call recording — outbound by ${repLabel}`
        : `Call recording — inbound to ${repLabel}`,
    userId: repUserId,
  });
  console.log("attached recording", rec.call_id);
}

async function handleVoicemail(env: Env, vm: ZoomVoicemail): Promise<void> {
  const external = toE164(vm.caller_number);
  const internal = toE164(vm.callee_number);
  if (!external) {
    console.log("voicemail with no caller number, skipping", vm.id);
    return;
  }
  const contact = await upsertContact(env, {
    phone: external,
    firstName: vm.caller_name,
    source: "Zoom Phone",
  });
  const { audio, contentType } = await downloadZoomAudio(env, vm.download_url);
  const startIso = vm.date_time ?? new Date().toISOString();

  const repLabel = formatRepLabel(undefined, internal);
  const repUserId = await lookupRepUserId(env, internal);
  const initial = await logCall(env, {
    direction: "inbound",
    contactId: contact.id,
    from: external,
    to: internal ?? "",
    status: "voicemail",
    durationSeconds: vm.duration ?? 0,
    startTimeIso: startIso,
    message: `Voicemail to ${repLabel} from ${external}. Duration: ${vm.duration ?? 0}s.`,
    userId: repUserId,
  });

  const ext = contentType.includes("wav") ? "wav" : "mp3";
  const ghlUrl = await uploadAudio(env, {
    conversationId: initial.conversationId,
    audio,
    filename: `zoom-voicemail-${vm.id}.${ext}`,
    contentType,
  });
  await logCall(env, {
    direction: "inbound",
    contactId: contact.id,
    from: external,
    to: internal ?? "",
    status: "voicemail",
    durationSeconds: vm.duration ?? 0,
    startTimeIso: startIso,
    attachmentUrls: [ghlUrl],
    message: `Voicemail audio — to ${repLabel}`,
    userId: repUserId,
  });

  await writeCallState(env, `vm:${vm.id}`, {
    ghl_contact_id: contact.id,
    ghl_conversation_id: initial.conversationId,
    ghl_message_id: initial.messageId,
    direction: "inbound",
    external_phone: external,
    internal_phone: internal ?? "",
    rep_name: "",
    start_iso: startIso,
  });
  console.log("logged voicemail", vm.id);
}

async function handleVoicemailTranscript(
  env: Env,
  vt: ZoomVoicemailTranscript,
): Promise<void> {
  const vmId = vt.voicemail_id ?? vt.id;
  if (!vmId) {
    console.log("voicemail transcript missing id, skipping");
    return;
  }
  const state = await waitForCallState(env, `vm:${vmId}`);
  if (!state) {
    console.log("voicemail transcript: no matching voicemail state, dropping", vmId);
    return;
  }
  let transcript = vt.transcript;
  if (!transcript && vt.download_url) {
    transcript = await fetchTextWithAuth(env, vt.download_url);
  }
  if (!transcript?.trim()) {
    console.log("voicemail transcript empty, skipping", vmId);
    return;
  }
  await addContactNote(env, {
    contactId: state.ghl_contact_id,
    body: `Voicemail transcript (${state.external_phone}):\n${transcript.trim()}`,
  });
  console.log("attached voicemail transcript", vmId);
}

function formatRepLabel(name: string | undefined, did: string | null): string {
  const trimmedName = name?.trim();
  if (trimmedName && did) return `${trimmedName} (${did})`;
  if (trimmedName) return trimmedName;
  if (did) return did;
  return "Unknown";
}

function mapCallResult(result: string | undefined): CallStatus {
  if (!result) return "completed";
  const r = result.toLowerCase();
  if (r.includes("voicemail")) return "voicemail";
  if (r.includes("missed") || r.includes("no answer") || r.includes("no_answer")) {
    return "no-answer";
  }
  if (r.includes("busy")) return "busy";
  if (r.includes("fail") || r.includes("error")) return "failed";
  return "completed";
}

