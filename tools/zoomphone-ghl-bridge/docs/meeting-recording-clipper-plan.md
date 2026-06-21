# Zoom Meeting → per-call clip → GHL: implementation plan

Status: proposal / spec for build. Last updated 2026-06-19.

## 1. Goal

Reps run sales calls inside **Zoom Meetings** (not Zoom Phone). They dial leads' phone
numbers into a meeting one at a time, so a single cloud recording contains several
back-to-back calls. We want to:

1. Detect each individual call inside the meeting recording.
2. Clip the recording into one audio file per call.
3. Match each clip to the right GHL contact by the lead's phone number and attach it.

The existing `zoomphone-bridge` worker logs **Zoom Phone** events and already knows how to
talk to GHL (OAuth, contact upsert, call message, audio upload). We **reuse the GHL plumbing**
and **add a new Meetings pipeline**. The Phone pipeline is orthogonal (see Decision D1).

## 2. Hard truths from research (these drive the design)

| # | Finding | Source | Consequence |
|---|---------|--------|-------------|
| T1 | **Local recordings are invisible to every Zoom API and webhook.** The desktop app can record locally; the web client is cloud-only. | Zoom platform comparison KB0065520; cloud-recording build guide | We cannot fetch desktop-local files. We **must force cloud recording at the account level** (precondition W0), or those calls are unrecoverable via API. |
| T2 | **Cloud recording produces ONE mixed `audio_only` M4A per recording segment** — there is no per-participant track in cloud recording (that's a local-only feature). | Zoom devforum (staff), cloud-recording build guide | We get one mixed file and must cut it ourselves. We cannot ask Zoom to "split per lead". |
| T3 | **Workers cannot run FFmpeg / decode audio** (128 MB isolate, CPU caps, no native binaries). | CF Workers limits | Clipping must run in **Cloudflare Containers (FFmpeg)** or an external FFmpeg service. The Worker only orchestrates and streams bytes. |
| T4 | **The lead's phone number only appears on the participant webhooks**, not the report API. `meeting.participant_joined.payload.object.participant.phone_number` (bare digits, no `+`); empty `id`/`email` marks a PSTN participant. | Zoom events docs; report-API schema | Call detection is **participant-event based**, and we must persist webhook events (can't reconstruct numbers later from REST). |
| T5 | Cloud recording **pause/resume compresses audio time** (audio duration < wall-clock span); **stop/start creates multiple files**. `recording_start`/`recording_end` are per-segment wall-clock UTC. | cloud-recording build guide; community | Offset math must be per segment and must detect/handle pause drift, else clips drift late. |
| T6 | GHL conversation upload caps at **5 MB/file**; accepts m4a/mp3. Larger → Medias API (25 MB) + link. | GHL marketplace docs | Transcode clips to MP3 ~64 kbps (≈28 min < 5 MB); fall back to Medias for the rare long call. |
| T7 | Webhook `download_token` (Bearer JWT) expires in **24 h**; recordings are subject to account auto-delete. | Zoom devforum (staff) | Stage the source to R2 **promptly** on `recording.completed`; never persist the URL, persist the meeting UUID + refetch via S2S OAuth if needed. |
| T8 | "Call Out / Invite by phone" **cannot be triggered via API**; reps dial manually. No phone-specific webhook exists. | Zoom devforum (staff) | We are purely a consumer of standard participant webhooks; nothing to automate on the dial side. |

## 3. Recommended architecture

```
                      Zoom (cloud recording enforced, W0)
                               │
   meeting.participant_joined ─┤  meeting.participant_left ─┐  recording.completed ─┐
                               ▼                            ▼                       ▼
                       ┌─────────────────────────────────────────────────────────────┐
                       │  Worker: /zoom/webhook  (verify sig, ack <200ms, ctx.waitUntil)│
                       └─────────────────────────────────────────────────────────────┘
                               │ route by meeting UUID
                               ▼
                    ┌────────────────────────────────────┐
                    │  Durable Object: MeetingAggregator   │   (one per meeting UUID)
                    │  • collects phone-participant windows │
                    │  • on recording.completed:            │
                    │     - stage source M4A → R2           │───────────────► R2 (source/)
                    │     - compute per-call clip windows   │
                    │     - enqueue 1 clip-job per call     │
                    │  • alarm: flush late / missing events │
                    └────────────────────────────────────┘
                               │ Queue: clip-jobs (R2 key + windows)
                               ▼
                    ┌────────────────────────────────────┐
                    │  Cloudflare Container (FFmpeg)        │
                    │  read source from R2 → ffmpeg clip    │───────────────► R2 (clips/)
                    │  → transcode mp3 64k if >5MB           │
                    │  enqueue upload-job                    │
                    └────────────────────────────────────┘
                               │ Queue: upload-jobs (clip key + phone + meta)
                               ▼
                    ┌────────────────────────────────────┐
                    │  Worker queue-consumer: GHL uploader  │
                    │  upsertContact(phone) → logCall →      │──────────────► GoHighLevel
                    │  uploadAudio(clip). Fallback: review.  │
                    └────────────────────────────────────┘
```

Detection of "a call" = a **phone participant's join→leave window** (T4), not audio-silence
analysis. This is far more reliable and gives us the phone number for matching for free.

### Why these components
- **Durable Object, not KV, for aggregation.** Many participant webhooks arrive concurrently
  and out of order, then `recording.completed` lands later. KV is last-write-wins and eventually
  consistent — it would drop concurrent window writes. A DO gives serialized state per meeting
  plus an **alarm** to handle "recording arrived before all `participant_left`" and "recording
  never arrives". (Token cache + dedupe maps stay in the existing KV.)
- **R2 staging.** The source M4A can be tens–hundreds of MB; streaming it into R2 once (T3/T7)
  lets every clip job reuse it and makes retries cheap. Clips also land in R2 so the GHL upload
  step is independently retriable.
- **Containers for FFmpeg** (T3). Audio-only M4A clips cleanly with stream copy
  (`-ss <start> -i in.m4a -to <end> -c:a copy`) because AAC frames are ~21 ms (no video-GOP
  snapping). Transcode to MP3 only when needed for the 5 MB GHL cap (T6).

### Alternative (if you want to avoid the Containers beta)
Swap the Container consumer for a small external FFmpeg service (Fly.io / Cloud Run) invoked over
HTTP from the queue consumer. Everything else is identical. Containers is the CF-native default;
the external service is the conservative fallback. (Decision D2.)

### Minimal-viable variant
A single Container that, per meeting, downloads from Zoom, clips, and uploads to GHL inline (no
R2, no second queue). Fewer moving parts, but no cheap retries and re-downloads per failure. Use
the full design for production; the MVV is acceptable for a first proof of concept.

## 4. Precondition W0 — Zoom account configuration (BLOCKING, non-code)

Nothing downstream works until cloud recording is guaranteed (T1). In Zoom Admin:

1. **Account Settings → Recording & Transcript**
   - **Lock OFF** "Record to computer files" (kills local recording so desktop can't bypass).
   - **Lock ON** "Automatic recording" → **Record in the cloud** (every meeting auto-records to cloud; web is already cloud-only).
   - Enable the **audio-only** recording file so an `audio_only` M4A is produced.
   - (Optional) disable host pause/resume to avoid T5 time-drift.
2. **Cloud storage**: ensure licensed seats + storage quota; set retention generously or rely on prompt R2 archival (T7). Watch the 80% alert.
3. **Server-to-Server OAuth app — Event Subscriptions**: subscribe to
   - `meeting.participant_joined`
   - `meeting.participant_left`
   - `recording.completed`
   (Keep the existing Phone events only if Decision D1 keeps the Phone path.)
4. **Scopes** (granular): `meeting:read:meeting:admin` (or classic `meeting:read:admin`),
   `cloud_recording:read:list_recording_files:admin` (or classic `cloud_recording:read:admin`),
   plus existing token scopes. Report scope optional (not used for phone numbers — T4).
5. **Consent/compliance**: confirm call-recording disclosure meets the jurisdictions you call into.

## 5. Shared contracts (frozen first; every workstream depends on these)

All in a new `src/meetings/types.ts` plus queue/key conventions. Agent A owns these.

### Domain types
```ts
// A single detected call inside a meeting (one phone participant lifecycle).
type CallWindow = {
  participantUuid: string;       // dedupe key within a meeting
  phoneRaw: string;              // as Zoom sent it, bare digits
  phoneE164: string | null;      // normalized; null => manual-review path
  joinIso: string;               // participant.date_time (UTC)
  leaveIso: string | null;       // participant.leave_time (UTC); null if still open at recording time
  displayName?: string;
};

type RecordingSegment = {
  fileId: string;
  startIso: string;              // recording_start (UTC)
  endIso: string;                // recording_end (UTC)
  downloadUrl: string;           // ephemeral; do not persist long-term
  fileExtension: string;         // "M4A"
};

type MeetingState = {
  meetingUuid: string;
  hostEmail?: string;
  windows: Record<string, CallWindow>;   // keyed by participantUuid
  recordingReady: boolean;
  sourceR2Keys: string[];                 // staged segment objects
  emittedCallIds: string[];               // idempotency
};
```

### Queue messages
```ts
// Queue: clip-jobs  (DO → Container)
type ClipJob = {
  callId: string;                // `${meetingUuid}:${participantUuid}` (stable, idempotent)
  meetingUuid: string;
  sourceR2Key: string;           // the staged segment this clip comes from
  startOffsetSec: number;        // padded, clamped to [0, audioDuration]
  endOffsetSec: number;
  phoneE164: string | null;
  joinIso: string;
  displayName?: string;
};

// Queue: upload-jobs  (Container → GHL uploader)
type UploadJob = {
  callId: string;
  clipR2Key: string;             // mp3/m4a clip in R2
  contentType: string;           // "audio/mpeg" | "audio/mp4"
  phoneE164: string | null;
  joinIso: string;
  durationSec: number;
  displayName?: string;
  needsReview: boolean;          // true when phoneE164 is null or alignment was flagged
};
```

### Key conventions
- R2 source: `source/{meetingUuid}/{fileId}.m4a`
- R2 clip:   `clips/{meetingUuid}/{participantUuid}.{mp3|m4a}`
- DO id:     `idFromName(meetingUuid)`
- KV dedupe: `clip:{callId}` → `{ ghlMessageId }` (skip if present)
- KV review: `review:{callId}` → job payload for the manual-review path

## 6. Multi-agent workstream breakdown

Each workstream is sized for one agent/dev. Contracts in §5 are the interfaces between them.

### Agent A — Ingestion, types, routing (foundation)
- **Scope**: Add Meetings event handling to `src/zoom/webhook.ts` dispatch. Parse
  `meeting.participant_joined`, `meeting.participant_left`, `recording.completed`. Identify phone
  participants (empty `id`/`email`, non-empty `phone_number`); ignore the host/internal participants.
  Author `src/meetings/types.ts` (§5) and the DO routing stub. Reuse existing signature verify.
- **Files**: `src/zoom/webhook.ts`, `src/meetings/types.ts`, `src/meetings/router.ts`, `src/index.ts` (bindings).
- **Inputs**: raw Zoom envelopes. **Outputs**: typed events routed to the DO; frozen §5 contracts.
- **Acceptance**: unit tests over captured payload fixtures classify host vs phone participant
  correctly; recording.completed parsed into `RecordingSegment[]` (audio_only only); contracts compile.
- **Depends on**: nothing. **Blocks**: B, C, D, E.

### Agent B — MeetingAggregator Durable Object (correlation + alignment) ← most complex
- **Scope**: DO keyed by meeting UUID. Accumulate `CallWindow`s from participant events. On
  `recording.completed`: ensure source staged in R2 (calls C), then compute per-call clip offsets
  and enqueue one `ClipJob` per window. Implement the **alignment algorithm** (§7). Set an **alarm**
  to (a) flush windows whose `participant_left` never arrived (use recording_end), and (b) detect a
  recording that never arrives (give up after N hours, log). Idempotent via `emittedCallIds`.
- **Files**: `src/meetings/aggregator.ts` (DO), `src/meetings/align.ts` (pure functions).
- **Inputs**: typed events (A), R2 staging (C). **Outputs**: `ClipJob`s on the `clip-jobs` queue.
- **Acceptance**: unit tests on `align.ts` for: single segment happy path; multi-segment intersect;
  pause-drift flag; window clamped/padded; window fully outside a segment dropped; rejoining phone
  number → two calls. DO test: out-of-order events still produce correct job set exactly once.
- **Depends on**: A, C. **Blocks**: D, E (via job contract).

### Agent C — Recording fetch + R2 staging
- **Scope**: Given `RecordingSegment` (download_url + webhook `download_token`, or S2S OAuth if
  token expired — T7), **stream** the M4A into R2 at `source/{meetingUuid}/{fileId}.m4a` without
  buffering (T3). Idempotent (skip if object exists). Extend `src/zoom/api.ts` for Meetings
  recordings + token handling. Expose `stageRecording(env, segment): Promise<r2Key>`.
- **Files**: `src/zoom/api.ts`, `src/meetings/stage.ts`.
- **Acceptance**: a 100 MB+ file streams to R2 within Worker limits (no OOM); re-invoke is a no-op;
  expired-token path refreshes via S2S OAuth and still downloads.
- **Depends on**: A. **Blocks**: B (B calls it), D (D reads the staged object).

### Agent D — Container FFmpeg clipper
- **Scope**: `linux/amd64` image with FFmpeg + a tiny HTTP/consumer entrypoint. Consume `clip-jobs`.
  Read source from R2 (S3 API), `ffprobe` to get true audio duration, **detect pause drift** (audio
  duration materially < segment wall-clock span → set `needsReview`), clip
  `ffmpeg -ss <start> -i in.m4a -to <end> -c:a copy out.m4a`; if the clip would exceed 5 MB,
  transcode `-c:a libmp3lame -b:a 64k out.mp3` (T6). Write to `clips/...`, enqueue `UploadJob`.
- **Files**: `containers/clipper/Dockerfile`, `containers/clipper/main.(ts|go)`, wrangler container binding.
- **Acceptance**: given a known M4A + offsets, produces a correctly bounded clip; >5 MB path yields
  <5 MB MP3; pause-drift fixture flags `needsReview`; bad/missing source fails the job for retry.
- **Depends on**: B (job contract), C (R2 layout), F (container infra). **Blocks**: E.

### Agent E — GHL uploader (queue consumer) + matching/fallback
- **Scope**: Consume `upload-jobs`. Normalize/confirm `phoneE164`; `upsertContact` by phone;
  `logCall` (Call message: direction outbound, from rep, to lead, duration); `uploadAudio` the clip
  (reuse `src/ghl/api.ts`). Dedupe via `clip:{callId}` KV. If `phoneE164` is null OR `needsReview`:
  route to **manual-review** — upload the clip to GHL Medias and create a contact-less GHL task/note
  with the meeting/time so a human can attach it, and record `review:{callId}`. >5 MB even as MP3 →
  Medias API + link (T6).
- **Files**: `src/meetings/upload-consumer.ts`, small extensions to `src/ghl/api.ts` (Medias upload).
- **Acceptance**: a real clip attaches to the correct contact's conversation; duplicate job is a
  no-op; null-phone job lands in review without throwing; >5 MB clip uses Medias + link.
- **Depends on**: D (clip output), existing GHL module. **Blocks**: nothing.

### Agent F — Infrastructure as code + deploy + observability
- **Scope**: `wrangler.toml`: add R2 bucket binding, two Queues (`clip-jobs`, `upload-jobs`) with
  producers/consumers, the DO binding + migration, the Container binding, `cpu_ms` bump if needed.
  Create R2 bucket + queues via wrangler. Document new secrets/vars. Add structured logging +
  a `/health` deep-check and a dead-letter strategy (max retries → DLQ → review).
- **Files**: `wrangler.toml`, `README.md` (new section), deploy notes.
- **Acceptance**: `wrangler deploy` provisions everything; bindings resolve; DLQ catches poison jobs.
- **Depends on**: A (knows the bindings needed). **Blocks**: D/E integration + end-to-end.

### Agent G — Test fixtures + end-to-end harness (cross-cutting)
- **Scope**: Capture/scrub real webhook payloads (`participant_joined/left`, `recording.completed`)
  into `test/fixtures/`. Build a local replay that posts fixtures to `/zoom/webhook` and asserts the
  resulting clip jobs and (mocked) GHL calls. Provide one real meeting recording for D's clip tests.
  Document a staged smoke test on a throwaway sub-account.
- **Files**: `test/fixtures/*.json`, `test/replay.mjs`, `test/align.test.ts`.
- **Depends on**: A contracts. **Runs alongside**: B/D/E.

## 7. Alignment algorithm (the core of Agent B)

For each `CallWindow` w and each `RecordingSegment` s (sorted by `startIso`):

```
segStart = epoch(s.startIso); segEnd = epoch(s.endIso)
wJoin    = epoch(w.joinIso);  wLeave  = w.leaveIso ? epoch(w.leaveIso) : segEnd
// intersect the call with this segment
isectStart = max(wJoin, segStart); isectEnd = min(wLeave, segEnd)
if (isectEnd <= isectStart) continue            // call not in this segment
startOffset = (isectStart - segStart)/1000 - PAD // PAD ≈ 5s
endOffset   = (isectEnd   - segStart)/1000 + PAD
clamp to [0, audioDurationFromFfprobe]
emit ClipJob{ sourceR2Key: s, startOffset, endOffset, ... }
```

Notes:
- **Padding** (±5 s) absorbs clock skew between participant and recording timestamps (T5).
- **Pause/resume drift** (T5): the Container compares `ffprobe` duration to `segEnd-segStart`; if
  audio is materially shorter, offsets computed from wall-clock are unreliable → set `needsReview`
  (the clip is still produced, but flagged for human spot-check). Disabling host pause (W0.1) avoids this.
- A call spanning a stop/start gap yields a clip per segment; uploader attaches both (rare).
- `participant_left` missing at recording time → `leaveIso=null` → clamp to segment end.

## 8. Edge cases & fallbacks

| Case | Handling |
|------|----------|
| `phone_number` empty on a phone participant (T4 fragility) | `phoneE164=null` → manual-review path (Medias upload + task), never dropped. |
| Lead rejoins (new `participant_uuid`) | Treated as a separate call/clip. Acceptable. |
| Overlapping participants (mini-conference) | Each clipped by its own window; mixed audio is fine. |
| Desktop user recorded locally despite W0 | No webhook fires → nothing to do. W0 lock is the only prevention; surface a periodic "users with local recording on" audit. |
| Recording auto-deleted before staging (T7) | Stage immediately on `recording.completed`; alarm + DLQ if download 404s. |
| Clip > 5 MB as MP3 (very long call) | Medias API (25 MB) + link in message (T6). |
| Host/internal extension mistaken for a lead | Exclude participants with populated `email`/`id`/account membership. |
| Duplicate webhooks / retries | Idempotency via `callId`, `emittedCallIds`, `clip:{callId}` KV. |

## 9. Sequencing & dependency graph

```
W0 (Zoom admin) ─────────────┐ (blocks end-to-end test, not coding)
                             │
A (contracts+ingest) ──┬─► B (aggregator+align) ──► D (container clip) ──► E (GHL upload)
                       ├─► C (R2 staging) ─────────► (feeds B and D)
                       └─► F (infra) ──────────────► (enables D/E deploy)
                                                     G (tests) runs alongside B/D/E
```

Critical path: **A → B → D → E**. C and F parallelize after A. G parallelizes after A.
Freeze §5 contracts at the end of A before fanning out B/C/D/E/F.

## 10. Decisions needed (owner: you)

- **D1 — Phone pipeline**: keep the existing Zoom Phone call-logging path running alongside the new
  Meetings pipeline, or retire it? (If reps now only call via Meetings, the Phone events are dead weight.)
- **D2 — Clip compute**: Cloudflare Containers (CF-native, beta) vs external FFmpeg service
  (Fly.io/Cloud Run). Default recommendation: Containers.
- **D3 — Call direction/labeling**: log clips as outbound calls with the rep as `from`? Confirm the
  rep identity source (host email → rep mapping, reuse `rep:{did}` KV idea keyed by host email).
- **D4 — Manual-review surface**: GHL task vs note vs a dedicated "Unmatched recordings" contact —
  where should null-phone clips land?

## 11. Cost / ops notes
- Cloud recording: paid Zoom seats + storage (~10 GB/user; Enterprise unlimited).
- R2: source + clips storage (cheap; set lifecycle expiry once attached to GHL).
- Containers: Workers Paid + per-10 ms compute (scales to zero); small for audio stream-copy.
- GHL: within free API usage; watch rate limits on bursts of many clips per meeting.
```
