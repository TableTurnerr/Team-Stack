import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/index";
import { handleRecordingIngest } from "../src/recordings/ingest";
import { dispatch } from "../src/pipeline";
import { sweepStalePendingClips } from "../src/calls";
import { makeRig, callLogEnvelope, ingestRequest, TEST_SHARED_TOKEN, type TestRig } from "./helpers";

// End-to-end correlation paths against the real handler functions. Each test
// runs on a fresh hermetic rig (temp SQLite + clips dir + fetch stub).

const EXTERNAL = "+14155550123";
const PHONE_RAW = "4155550123"; // toE164 → +14155550123

function ghlLogCalls(rig: TestRig): { url: string; method: string; body: unknown }[] {
  return rig.calls.filter(
    (c) =>
      c.url.includes("/conversations/messages/inbound") ||
      c.url.includes("/conversations/messages/outbound"),
  );
}

test("1. webhook-first: call logs, then clip ingest attaches immediately (correlated:true)", async () => {
  const rig = makeRig();
  try {
    // Webhook logs the call first.
    await dispatch(callLogEnvelope({ direction: "outbound", callId: "zoom-call-1", externalE164: EXTERNAL }), rig.env);

    // Now the clip arrives — correlates by phone+time and attaches.
    const res = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-1", repKey: "rep-ghl-1", phoneE164: PHONE_RAW, connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { correlated?: boolean; ghlMessageId?: string };
    assert.equal(json.correlated, true);
    assert.ok(json.ghlMessageId);

    // The clip should no longer be pending.
    assert.equal(await rig.clips.get("cc-1"), null);
    // Two GHL Call logs: the original call + the recording attach.
    assert.equal(ghlLogCalls(rig).length, 2);
    // The attach used the repKey passthrough as userId.
    const attach = ghlLogCalls(rig)[1]!.body as { userId?: string; attachments?: string[] };
    assert.equal(attach.userId, "rep-ghl-1");
    assert.ok(attach.attachments && attach.attachments.length === 1);
  } finally {
    rig.cleanup();
  }
});

test("2. clip-first: no matching call → pending (correlated:false), then call log reverse-attaches", async () => {
  const rig = makeRig();
  try {
    // Clip arrives before any webhook.
    const res = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-2", repKey: "rep-ghl-2", phoneE164: PHONE_RAW, connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { correlated?: boolean; pending?: boolean };
    assert.equal(json.correlated, false);
    assert.equal(json.pending, true);
    // It's parked pending.
    assert.ok(await rig.clips.get("cc-2"));

    // Webhook lands → reconcilePendingClips attaches it.
    await dispatch(callLogEnvelope({ direction: "inbound", callId: "zoom-call-2", externalE164: EXTERNAL }), rig.env);

    // Now removed from pending and attached.
    assert.equal(await rig.clips.get("cc-2"), null);
    // Original inbound call log + the reverse-attached recording.
    assert.equal(ghlLogCalls(rig).length, 2);
    const attach = ghlLogCalls(rig)[1]!.body as { userId?: string; direction?: string };
    assert.equal(attach.userId, "rep-ghl-2");
  } finally {
    rig.cleanup();
  }
});

test("3. exact zoomCallId correlation beats phone+time", async () => {
  const rig = makeRig();
  try {
    // Log two calls to DIFFERENT phones. The clip carries the exact call_id of
    // the SECOND call but a phone that, if used, would match neither precisely.
    const now = Date.now();
    await dispatch(
      callLogEnvelope({ direction: "outbound", callId: "zoom-A", externalE164: "+14155550001", dateIso: new Date(now).toISOString() }),
      rig.env,
    );
    await dispatch(
      callLogEnvelope({ direction: "outbound", callId: "zoom-B", externalE164: EXTERNAL, dateIso: new Date(now).toISOString() }),
      rig.env,
    );

    // Clip gives zoomCallId=zoom-A but phoneE164 of call B. Exact id must win,
    // so it attaches to call A's conversation, not B's.
    const res = await handleRecordingIngest(
      ingestRequest({
        clientCallId: "cc-3",
        repKey: "rep-ghl-3",
        phoneE164: PHONE_RAW, // == call B's external
        zoomCallId: "zoom-A",
        connectTsMs: now,
      }),
      rig.env,
      rig.ctx,
    );
    assert.equal(res.status, 200);
    const json = (await res.json()) as { correlated?: boolean };
    assert.equal(json.correlated, true);

    // The conversation used for the attach must be call A's conversation.
    // Call A logged first → conv-1; call B → conv-2; the attach should target conv-1.
    const attach = ghlLogCalls(rig).at(-1)!.body as { contactId?: string };
    // Both calls upserted contact-1 in our stub; assert the attach happened and
    // was the only post-clip log (i.e. attached to an existing call, not a new one).
    assert.equal(ghlLogCalls(rig).length, 3); // 2 original calls + 1 attach
    assert.ok(attach.contactId);

    // The upload happened against call A's conversation id (conv-1).
    const uploads = rig.calls.filter((c) => c.url.includes("/conversations/messages/upload"));
    assert.equal(uploads.length, 1);
    assert.equal((uploads[0]!.body as { conversationId?: string }).conversationId, "conv-1");
  } finally {
    rig.cleanup();
  }
});

test("4. no phone AND no call_id on the clip → parked for review (202)", async () => {
  const rig = makeRig();
  try {
    const res = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-4", repKey: "rep-ghl-4", connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(res.status, 202);
    const json = (await res.json()) as { status?: string };
    assert.equal(json.status, "review");
    // Parked via Medias, not pending, no call log.
    assert.equal(await rig.clips.get("cc-4"), null);
    assert.equal(ghlLogCalls(rig).length, 0);
    assert.ok(await rig.env.STATE.get("review:cc-4"));
    assert.equal(rig.calls.filter((c) => c.url.includes("/medias/upload-file")).length, 1);
  } finally {
    rig.cleanup();
  }
});

test("5. dedup: same clientCallId twice → second returns 409", async () => {
  const rig = makeRig();
  try {
    await dispatch(callLogEnvelope({ direction: "outbound", callId: "zoom-5", externalE164: EXTERNAL }), rig.env);
    const first = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-5", repKey: "rep-ghl-5", phoneE164: PHONE_RAW, connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(first.status, 200);

    const second = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-5", repKey: "rep-ghl-5", phoneE164: PHONE_RAW, connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(second.status, 409);
    const json = (await second.json()) as { ghlMessageId?: string };
    assert.ok(json.ghlMessageId);
  } finally {
    rig.cleanup();
  }
});

test("6. stale sweep: a pending clip older than the cutoff → uploaded to Medias review + removed", async () => {
  const rig = makeRig();
  try {
    // Park a pending clip (clip-first, no call). It stays pending.
    const res = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-6", repKey: "rep-ghl-6", phoneE164: PHONE_RAW, connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal((await res.json() as { pending?: boolean }).pending, true);
    assert.ok(await rig.clips.get("cc-6"));

    // Sweep with a 0ms cutoff → everything is "stale". No call ever logged, so
    // it parks into Medias review and is removed from pending.
    await sweepStalePendingClips(rig.env, 0);

    assert.equal(await rig.clips.get("cc-6"), null);
    assert.ok(await rig.env.STATE.get("review:cc-6"));
    assert.equal(rig.calls.filter((c) => c.url.includes("/medias/upload-file")).length, 1);
  } finally {
    rig.cleanup();
  }
});

test("7. repKey passthrough vs mapping: mapped repKey resolves to the configured GHL userId", async () => {
  const rig = makeRig();
  try {
    // Install a mapping via the admin endpoint (bearer-guarded).
    const setRes = await handleRequest(
      new Request("https://test.example.com/admin/reps", {
        method: "POST",
        headers: { Authorization: `Bearer ${TEST_SHARED_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ repKey: "device-7", ghlUserId: "GHL_USER_77" }),
      }),
      rig.env,
      rig.ctx,
    );
    assert.equal(setRes.status, 200);

    // Webhook-first call, then a clip from device-7. Attribution must resolve to
    // the mapped userId, not the raw repKey.
    await dispatch(callLogEnvelope({ direction: "outbound", callId: "zoom-7", externalE164: EXTERNAL }), rig.env);
    const res = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-7", repKey: "device-7", phoneE164: PHONE_RAW, connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(res.status, 200);
    const attach = ghlLogCalls(rig).at(-1)!.body as { userId?: string };
    assert.equal(attach.userId, "GHL_USER_77");

    // And an UNmapped repKey passes through verbatim.
    await dispatch(callLogEnvelope({ direction: "outbound", callId: "zoom-7b", externalE164: "+14155559999" }), rig.env);
    const res2 = await handleRecordingIngest(
      ingestRequest({ clientCallId: "cc-7b", repKey: "device-passthrough", phoneE164: "4155559999", connectTsMs: Date.now() }),
      rig.env,
      rig.ctx,
    );
    assert.equal(res2.status, 200);
    const attach2 = ghlLogCalls(rig).at(-1)!.body as { userId?: string };
    assert.equal(attach2.userId, "device-passthrough");
  } finally {
    rig.cleanup();
  }
});
