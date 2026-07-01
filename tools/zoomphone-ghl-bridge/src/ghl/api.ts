import type { Env } from "../index";
import { getGhlAccessToken, getGhlLocationId } from "./oauth";

const BASE = "https://services.leadconnectorhq.com";

export type UpsertedContact = {
  id: string;
  isNew: boolean;
};

export async function upsertContact(
  env: Env,
  params: { phone: string; firstName?: string; source?: string },
): Promise<UpsertedContact> {
  const token = await getGhlAccessToken(env);
  const locationId = await getGhlLocationId(env);
  const res = await fetch(`${BASE}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      locationId,
      phone: params.phone,
      ...(params.firstName ? { firstName: params.firstName } : {}),
      ...(params.source ? { source: params.source } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`GHL upsert failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    contact?: { id: string };
    new?: boolean;
  };
  if (!json.contact?.id) {
    throw new Error(`GHL upsert returned no contact id: ${JSON.stringify(json)}`);
  }
  return { id: json.contact.id, isNew: json.new ?? false };
}

export type CallStatus =
  | "completed"
  | "no-answer"
  | "busy"
  | "failed"
  | "voicemail";

export type LogCallParams = {
  direction: "inbound" | "outbound";
  contactId: string;
  from: string;
  to: string;
  status: CallStatus;
  durationSeconds: number;
  startTimeIso: string;
  attachmentUrls?: string[];
  message?: string;
  userId?: string;
};

export type LoggedCall = {
  messageId: string;
  conversationId: string;
};

export async function logCall(env: Env, params: LogCallParams): Promise<LoggedCall> {
  const token = await getGhlAccessToken(env);
  const endpoint = params.direction === "inbound" ? "inbound" : "outbound";
  const body: Record<string, unknown> = {
    type: "Call",
    contactId: params.contactId,
    conversationProviderId: env.GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID,
    date: params.startTimeIso,
    call: {
      from: params.from,
      to: params.to,
      status: params.status,
      duration: params.durationSeconds,
    },
  };
  if (params.attachmentUrls?.length) body.attachments = params.attachmentUrls;
  if (params.message) body.message = params.message;
  if (params.userId) body.userId = params.userId;

  const res = await fetch(`${BASE}/conversations/messages/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-04-15",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`GHL log ${endpoint} call failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    messageId?: string;
    conversationId?: string;
  };
  if (!json.messageId || !json.conversationId) {
    throw new Error(`GHL log call returned malformed body: ${JSON.stringify(json)}`);
  }
  return { messageId: json.messageId, conversationId: json.conversationId };
}

export async function uploadAudio(
  env: Env,
  params: { conversationId: string; audio: ArrayBuffer; filename: string; contentType: string },
): Promise<string> {
  const token = await getGhlAccessToken(env);
  const locationId = await getGhlLocationId(env);
  const form = new FormData();
  form.append("conversationId", params.conversationId);
  form.append("locationId", locationId);
  form.append(
    "fileAttachment",
    new Blob([params.audio], { type: params.contentType }),
    params.filename,
  );
  const res = await fetch(`${BASE}/conversations/messages/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-04-15",
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`GHL upload failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as {
    uploadedFiles?: Record<string, string>;
  };
  const files = Object.values(json.uploadedFiles ?? {});
  const first = files[0];
  if (!first) throw new Error("GHL upload returned no files");
  return first;
}

// Medias API: larger files (up to 25 MB) than the 5 MB conversations upload.
// Returns a public media URL we attach to a message as a link.
export async function uploadMedia(
  env: Env,
  params: { audio: ArrayBuffer; filename: string; contentType: string },
): Promise<string> {
  const token = await getGhlAccessToken(env);
  const form = new FormData();
  form.append("file", new Blob([params.audio], { type: params.contentType }), params.filename);
  form.append("hosted", "false");
  form.append("fileName", params.filename);
  const res = await fetch(`${BASE}/medias/upload-file`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      Accept: "application/json",
    },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`GHL media upload failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { url?: string; fileUrl?: string; id?: string };
  const url = json.url ?? json.fileUrl;
  if (!url) throw new Error(`GHL media upload returned no url: ${JSON.stringify(json)}`);
  return url;
}

export async function addContactNote(
  env: Env,
  params: { contactId: string; body: string },
): Promise<void> {
  const token = await getGhlAccessToken(env);
  const res = await fetch(`${BASE}/contacts/${params.contactId}/notes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ body: params.body }),
  });
  if (!res.ok) {
    throw new Error(`GHL note failed: ${res.status} ${await res.text()}`);
  }
}
