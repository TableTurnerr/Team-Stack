# Zoom Phone call → local recording → GHL: implementation plan (v2, local-capture)

Status: v1 of all three components built; not yet verified end-to-end on hardware. Last updated 2026-06-19.
Supersedes the cloud-clipping approach in `meeting-recording-clipper-plan.md` (see §12).

## Implementation status (2026-06-19)

A first cut of all three components exists and compiles. End-to-end behavior is **not yet verified against live Zoom or real audio hardware.**

> **Update (2026-06-20):** the agent is **not** a separate `crm-agent` repo — the
> work landed in the existing **`CRM-Tableturnerr/tools/local-CRM-Agent`** app
> (managed by the Tool Manager). That agent records each call and now uploads the
> clip to this worker's `/recordings/ingest` (GHL); the old PocketBase upload was
> retired. The Native Messaging host (`com.tableturnerr.crm_agent`) is implemented
> and self-registers on launch for Chrome + Edge. See
> `tools/local-CRM-Agent/RECORDING-UPLOAD.md` and `NATIVE-MESSAGING.md`.

| Workstream | Repo | State |
|---|---|---|
| A — agent audio capture | `tools/local-CRM-Agent` | Built. Full-call WAV sink → MP3 (LameMP3FileWriter) with WAV fallback; whole-system loopback + mic. |
| B — agent control/upload/tray | `tools/local-CRM-Agent` | Built. Localhost WS command surface, **Native Messaging host**, durable upload queue → GHL worker ingest, tray. |
| C — worker AgentHub + push | `tools/zoomphone-ghl-bridge` | Built; `tsc --noEmit` clean. `AgentHub` Durable Object + `/agent/connect`. (Agent does not yet hold the AgentHub WS; desktop calls self-detect locally.) |
| D — worker ingest → GHL | `tools/zoomphone-ghl-bridge` | Built; `tsc --noEmit` clean. `/recordings/ingest`: dedup, contact match by phone, Medias fallback, review path. |
| E — extension web detection | `tools/chrome-extension/extension` | Built. MAIN-world `WebSocket` detector + MutationObserver fallback. **Selectors/URL hints need tuning against live Zoom.** |
| F — extension native bridge | `tools/chrome-extension/extension` | Built. `nativeMessaging` + START/STOP bridge; extension id pinned via `key`. Agent side now present. |
| G — installer / registration | `tools/local-CRM-Agent` + `tools/tool-manager` | Tool Manager installs/updates the agent; the agent self-registers autostart, `crm-agent://`, and the native host on launch. Code-signing still pending. |
| H — consent / tests | across repos | Consent tone done; broader end-to-end harness pending. |

Known gaps before a live test: tune the extension's Zoom-web detection, verify agent audio routing on hardware, deploy the worker and subscribe the four live phone events, and provision the per-rep token and `repUserId`. See §9 for decisions and §5 for per-workstream acceptance criteria.

## 1. Goal & approach

Reps make Zoom **Phone** calls from either the **Zoom desktop client** or the **Zoom web phone**
(the latter launched by our Chrome extension's click-to-call). We record each call's audio
**locally on the rep's machine**, one clip per call, and attach it to the matching GHL contact
(matched by the lead's phone number).

Recording locally (instead of Zoom cloud recording) removes the two worst constraints found
earlier: no need to buy/force Zoom cloud recording, and the "local files are invisible to the API"
problem disappears because *our own agent* is the thing on that machine. Clipping is trivial:
recording starts and stops with the call, so each call is already its own file. No FFmpeg cutting
of a big mixed file.

Three components, each gets the detection/recording right for its surface:

| Surface | Who detects the call | Who records | Who supplies the phone number |
|---|---|---|---|
| Zoom **desktop** client | Cloudflare worker (Zoom phone webhooks) → pushes to agent | CRM Agent app | Worker (webhook `caller`/`callee.phone_number`) |
| Zoom **web** phone | Chrome extension (it launched the call) | CRM Agent app | Extension (click-to-call) + worker (webhook), worker authoritative |

The worker is the **metadata + GHL brain** for both paths; the local pieces only decide *when* to
record and provide the audio.

## 2. Components

1. **CRM Agent app** — new. A .NET 8 Windows tray app on each rep's machine. Captures mic + system
   (or Zoom-process) audio into a rolling buffer, starts/stops on triggers, encodes one clip per
   call, uploads the clip + metadata to the worker. Holds **no GHL credentials**.
2. **Cloudflare worker** (`zoomphone-bridge`) — extend. Keeps the Zoom phone webhook intake and the
   existing GHL plumbing (contact upsert, call message, audio upload). Adds: a Durable Object that
   holds each agent's live WebSocket and pushes start/stop; an endpoint that ingests uploaded clips
   and attaches them to GHL.
3. **Chrome extension** (`tools/chrome-extension/extension`) — extend. Adds a `*.zoom.us` content script that detects
   web-phone call start/end + number, and a Native Messaging bridge that tells the local agent to
   start/stop. Reuses the existing click-to-call knowledge of the dialed number.

## 3. Architecture

```
 Zoom Phone (desktop OR web)
        │
        │ webhooks: phone.caller_connected / callee_answered / *_ended   (numbers, user_id, call_id)
        ▼
 ┌──────────────────────────────────────────────┐
 │ Cloudflare Worker  (ack <3s, async)            │
 │  • AgentHub Durable Object:                     │
 │     - holds 1 WebSocket per rep agent           │
 │     - registry: zoom user_id/ext → agent         │
 │     - on connected/answered → push START         │────► (WS) ──┐
 │     - on *_ended → push STOP                     │             │
 │  • POST /recordings/ingest:                      │◄─ (HTTPS) ─┐ │
 │     match contact by phone → logCall →            │           │ │
 │     uploadAudio (reuse ghl/api.ts)                │           │ │
 └──────────────────────────────────────────────┘           │ │
                                                                 │ │
 Chrome extension (tools/chrome-extension)                       │ │
  • content script on *.zoom.us: detect web call start/end + #   │ │
  • click-to-call already knows the number                       │ │
  • SW → Native Messaging ──► CRM Agent (START/STOP, number)      │ │
                                                                  │ │
 ┌──────────────────────────────────────────────┐  ◄── START/STOP ┘ │
 │ CRM Agent app (.NET tray, per machine)          │  (desktop via WS, │
 │  • WASAPI loopback (sys or Zoom proc) + mic     │   web via NativeMsg)│
 │  • rolling buffer (~30-60s) → recover true start │                   │
 │  • on STOP: encode 1 clip (m4a/mp3)              │── upload clip ─────┘
 │  • holds persistent WS to AgentHub (desktop path)│   + {callId, phone, repUserId, start, end}
 │  • registers rep identity + auth token           │
 └──────────────────────────────────────────────┘
```

### Why these choices (from research)
- **Persistent agent→worker WebSocket** (Durable Object, hibernatable): you cannot deliver an
  inbound webhook to a laptop behind NAT. The agent dials out and holds the connection; the worker
  pushes over it. Route by Zoom `user_id` (present on every phone event).
- **Native Messaging, not localhost socket**, for extension→agent: Chrome's Local Network Access
  rollout (~Chrome 142–147) gates page→localhost; https→`ws://localhost` is mixed-content-blocked;
  MV3 service-worker WebSockets need keepalive hacks. Native Messaging avoids all of it and
  authenticates by extension ID (`allowed_origins`). The agent installer registers the host manifest.
- **Rolling pre-roll buffer**: Zoom webhooks have no SLA and can lag 20–30s; `recording_completed`
  is minutes late and useless for live triggers. Connect anchors are `phone.caller_connected`
  (outbound) / `phone.callee_answered` (inbound); stop anchors `phone.caller_ended`/`callee_ended`.
  The agent records continuously into a ring buffer (armed by Zoom.exe audio-session-active), and on
  a late START flushes back to the true connect time (`event_ts` − margin). ~23 MB/min/stream PCM,
  trivial.
- **Lower latency option**: switch the worker's Zoom intake to a **Zoom WebSocket event
  subscription** (same payloads, persistent, faster than HTTP), keeping the HTTP webhook as a
  durable backstop (the WS drops events while disconnected).
- **Precision option**: a small **Zoom App embedded in the desktop client** fires
  `onPhoneCalleeAnswered` / `onPhoneCallerEnded` locally with zero latency and `getPhoneContext`
  for numbers; it would POST to the agent's local endpoint. Heavier to build; treat as a later
  upgrade, with the worker push as the baseline.

## 4. Shared contracts (freeze first)

### Trigger protocol (worker→agent over WS, and extension→agent over Native Messaging)
```ts
type RecordCommand =
  | { type: "START"; callId: string; repUserId: string; channel: "desktop" | "web";
      phoneE164: string | null; counterpartyName?: string; connectTsMs: number }
  | { type: "STOP"; callId: string; endTsMs: number }
  | { type: "PING" } | { type: "PONG" };
```
- `callId`: from the Zoom webhook for desktop; for web, the extension mints
  `web:{repUserId}:{connectTsMs}` and the worker reconciles it to the real `call_id` by
  `repUserId` + time window when its own webhook arrives.
- The agent treats START idempotently per `repUserId` (ignore a second START while already recording).

### Upload protocol (agent→worker)
```
POST /recordings/ingest        (multipart/form-data, bearer = agent token)
  fields: callId, repUserId, channel, phoneE164(optional), connectTsMs, endTsMs, sha256
  file:   clip  (audio/mp4 m4a | audio/mpeg mp3)
→ 200 { ghlMessageId } | 202 { status: "review" } (no phone) | 409 (dup callId)
```

### Native Messaging
- Host name: `com.tableturnerr.crm_agent`, `type: "stdio"`,
  `allowed_origins: ["chrome-extension://<EXT_ID>/"]`. Extension SW ↔ host JSON messages
  (content script relays, SW calls `connectNative`).

### Agent registration (agent→worker WS, first frame)
```ts
type Hello = { token: string; repUserId: string; zoomExtension?: string; machineId: string; agentVersion: string };
```

## 5. Multi-agent workstream breakdown

Each is sized for one agent/dev. §4 contracts are the interfaces; freeze them before fan-out.

### Agent A — CRM Agent: audio capture core (.NET)
- **Scope**: WASAPI capture — mic (`WasapiCapture`) + system loopback (`WasapiLoopbackCapture`),
  resample to a common 48 kHz format, mix (`MixingSampleProvider`), maintain a 30–60s ring buffer,
  encode a bounded clip to m4a/mp3 (NAudio `MediaFoundationEncoder` or bundled `ffmpeg.exe`).
  Handle device-change (`MMNotificationClient`) and the loopback-silence gap. Pure library with a
  `StartClip(meta)/StopClip()→file` API; no networking.
- **Optional upgrade**: per-process loopback (`AUDCLNT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, port MS
  `ApplicationLoopback` / reuse `bozbez/win-capture-audio`) to capture only Zoom.exe (desktop) or
  the browser (web) instead of the whole system.
- **Acceptance**: produces a clean mixed clip for a known start/stop; buffer flush recovers ~20s of
  pre-roll; survives a Bluetooth headset swap mid-clip.
- **Depends on**: nothing. **Blocks**: B.

### Agent B — CRM Agent: control surface, triggers, upload, tray
- **Scope**: persistent WS client to the worker AgentHub (register via `Hello`, receive START/STOP,
  ping/pong, auto-reconnect); Native Messaging host (`com.tableturnerr.crm_agent`) for extension
  START/STOP; local Zoom.exe audio-session detector to arm the buffer; idempotent record state
  machine + dedup; upload finished clip to `/recordings/ingest`; tray UI, settings (rep identity,
  token), auto-start. Consent/disclosure hook (see H).
- **Acceptance**: a START from either transport records and a STOP uploads exactly one clip;
  duplicate START ignored; reconnect after network drop; clip retried on upload failure.
- **Depends on**: A, §4 contracts. **Blocks**: G.

### Agent C — Worker: AgentHub Durable Object + push routing
- **Scope**: hibernatable-WebSocket Durable Object holding one connection per rep agent; registry
  `zoomUserId/extension → agent`; on `phone.caller_connected`/`callee_answered` push START, on
  `*_ended` push STOP, resolving phone numbers + `call_id` from the event. Agent auth (token).
  Optionally add the Zoom WebSocket event-subscription intake for lower latency (HTTP webhook stays
  as backstop). Extend `src/zoom/webhook.ts` dispatch for the live phone events.
- **Acceptance**: a simulated phone event pushes the correct command to the correct agent socket;
  unknown rep → logged, no crash; reconnect re-registers cleanly.
- **Depends on**: §4 contracts. **Blocks**: B integration, end-to-end.

### Agent D — Worker: recording ingest → GHL attach
- **Scope**: `POST /recordings/ingest` — verify agent token + sha256; normalize/confirm `phoneE164`;
  `upsertContact` by phone; `logCall` (outbound, rep `from`, lead `to`, duration from start/end);
  `uploadAudio` the clip (reuse `src/ghl/api.ts`); >5 MB → Medias API + link; dedup by `callId` in
  KV (`clip:{callId}`); no-phone → manual-review (Medias + GHL task/note, `review:{callId}`).
  Correlate web `callId` to the real Zoom `call_id` by rep + time window.
- **Acceptance**: real clip attaches to the right contact's conversation; duplicate ingest is a
  no-op; no-phone clip lands in review; >5 MB uses Medias.
- **Depends on**: §4 contracts, existing GHL module. **Blocks**: end-to-end.

### Agent E — Extension: Zoom web phone detection
- **Scope**: new content script matching `app.zoom.us`/`pwa.zoom.us`/`*.zoom.us` (`all_frames:true`).
  Detect call start/end primarily by leveraging the **existing click-to-call** (the extension
  initiates the call and knows the number), plus a hybrid detector: a `world:"MAIN"`,
  `run_at:"document_start"` script monkey-patching `window.WebSocket` for start/end timing, and a
  MutationObserver on the in-call timer + ARIA "End call" control as fallback. Reuse
  `normalizePhone()` from `ghl_enhancements.js`. Emit `chrome.runtime.sendMessage({type:'ZOOM_CALL_*'})`.
- **Best-case path**: if reps can use **Zoom Phone Smart Embed**, consume its documented
  `zp-call-ringing/connected/ended` postMessage events (number + state, stable contract) instead of
  DOM scraping — far lower maintenance. (Decision D2.)
- **Acceptance**: start/end fire on a real web call with the correct number; survives a Zoom release
  (timer/ARIA fallback) — at least one detector still fires.
- **Depends on**: §4 contracts. **Blocks**: F.

### Agent F — Extension: Native Messaging bridge
- **Scope**: `background.js` handler: on `ZOOM_CALL_*` → `chrome.runtime.connectNative(...)` →
  send START/STOP to the agent. `manifest.json`: add `"nativeMessaging"` permission + the Zoom
  content script entry. SW keepalive for the duration of a call.
- **Acceptance**: a detected web call drives the agent to start/stop via Native Messaging end-to-end.
- **Depends on**: E, B's host name/protocol. **Blocks**: end-to-end.

### Agent G — Agent installer, signing, auto-update
- **Scope**: MSIX or Inno Setup installer: install the .NET agent, **register the Native Messaging
  host manifest** (`HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.tableturnerr.crm_agent`),
  set auto-start (Task Scheduler logon trigger), bundle `ffmpeg.exe` if used, Authenticode
  **code-sign**, auto-update (Velopack/Squirrel). Per-rep config (token, repUserId) provisioning.
- **Acceptance**: clean install on a fresh Win11 box yields a running tray agent, registered native
  host, and a working extension→agent trigger; update replaces in place.
- **Depends on**: A, B, F (host name). **Blocks**: rollout.

### Agent H — Consent/disclosure, observability, test harness (cross-cutting)
- **Scope**: recording disclosure mechanism (per consent policy — audible notice/beep or scripted
  disclosure + rep consent capture; default to all-party-consent-safe behavior). Structured logging
  across worker + agent, dead-letter for failed ingests, a replay harness with fake phone events and
  a sample call, and a staged smoke test on a throwaway GHL sub-account.
- **Depends on**: contracts. **Runs alongside**: all.

## 6. Sequencing & dependency graph

```
W0 (decisions + Zoom app + signing cert) ── gates rollout, not coding
§4 contracts frozen
   ├─ A (capture core) ──► B (agent control+upload) ──► G (installer) ──► rollout
   ├─ C (AgentHub push) ─────────────┐
   ├─ D (ingest→GHL) ────────────────┤► end-to-end ◄── B, F
   ├─ E (web detection) ──► F (native bridge) ──┘
   └─ H (consent/obs/tests) runs alongside
```
Critical path: contracts → A → B → G. C/D (worker) and E/F (extension) parallelize after contracts.

## 7. Edge cases & fallbacks

| Case | Handling |
|------|----------|
| Webhook lag 20–30s (START arrives late) | Ring buffer flushes back to `connectTsMs − margin`; arm buffer on local Zoom audio-session-active. |
| No phone number (desktop, masked caller) | Upload with `phoneE164:null` → worker manual-review (never dropped). |
| Web call audio plays in browser, desktop in Zoom.exe | Whole-system loopback (simple v1) captures both; per-process targeting must pick browser vs Zoom.exe by `channel` (upgrade). |
| Double trigger (extension + worker both see a web call) | Idempotent START per `repUserId`; dedup by `callId`/rep+time in worker ingest. |
| Agent offline / laptop asleep at call time | No clip; worker still logs the call from webhook (existing behavior). Surface "missed recording". |
| Bluetooth/headset swap mid-call | `MMNotificationClient` re-attaches mic; per-process loopback is endpoint-agnostic. |
| Rep mutes mic | OS mic still captured unless hardware-muted; document intended behavior (consent risk). |
| Clip > 5 MB (long call) | Worker uses GHL Medias API (25 MB) + link, else 5 MB conversations upload. |
| Zoom web DOM changes | MAIN-world WebSocket detector + ARIA/timer fallback; click-to-call origin is the most stable signal. |

## 8. Security & privacy
- Agent holds **no GHL credentials** — only an agent token to the worker. GHL stays server-side
  (worker / `crm.tableturnerr.com`).
- Agent token per rep, provisioned at install; worker authenticates the WS `Hello` and `/ingest`.
- Native Messaging authenticates the extension by ID (`allowed_origins`). If a localhost socket is
  ever used instead, bind `127.0.0.1` only + shared install-time token + connect from the SW origin.
- **Consent (load-bearing)**: ~12 all-party-consent US states. Ship a disclosure/consent mechanism
  before go-live; apply the strictest applicable state law for interstate calls. (Not legal advice.)
- Clips contain call audio (PII): encrypt in transit (HTTPS/WSS), set GHL/Medias retention, and
  define an agent-side retention/cleanup of local temp files.

## 9. Decisions

**Decided 2026-06-19** (D2 by the user; the rest are my defaults, per the user's go-ahead):
- D1 → **Cloudflare worker** (`zoomphone-bridge`) owns AgentHub + `/recordings/ingest` + GHL attach.
- D2 → **No Zoom Smart Embed.** Web detection scrapes the Zoom web phone (MAIN-world `WebSocket`
  patch + MutationObserver on the in-call timer/ARIA controls), reusing the extension's
  click-to-call knowledge of the dialed number.
- D3 → **Whole-system loopback** for v1 (mic + system output mixed).
- D4 → **Worker webhook push + ring buffer** (no embedded Zoom App yet).
- D5 → **Recording disclosure on by default** (audible disclosure tone at record start + tray
  indicator while recording); ops owns the formal per-state policy.
- **`repUserId` is provisioned per rep to equal the rep's Zoom `user_id`**; the local agent is
  authoritative for `repUserId` on uploads, so the worker routes START/STOP to the agent whose
  `repUserId` matches the phone event's `user_id`.

### Original options (for reference)
- **D1 — Backend owner**: does the Cloudflare `zoomphone-bridge` worker own the AgentHub + ingest +
  GHL attach, or does `crm.tableturnerr.com` (which already proxies GHL for the extension)? Default:
  the worker (it already has the Zoom webhook intake + GHL conversation/upload code).
- **D2 — Web detection**: adopt **Zoom Phone Smart Embed** (stable event API, may need a UI change)
  vs scrape the existing web phone (no UI change, higher maintenance). Default: try Smart Embed.
- **D3 — Capture scope**: whole-system loopback (simple, records other sounds too) vs per-process
  (clean, more work, must target browser for web calls). Default: whole-system for v1.
- **D4 — Trigger source of truth for desktop**: worker webhook push (baseline) vs build an embedded
  Zoom App for in-client events (precise, more work). Default: worker push + ring buffer.
- **D5 — Consent policy**: beep / scripted disclosure / per-state gating — what's acceptable to ops?

## 10. Reuse from existing code
- Worker: `src/ghl/api.ts` (`upsertContact`, `logCall`, `uploadAudio`), `src/ghl/oauth.ts`,
  `src/zoom/webhook.ts` (signature verify + dispatch), `toE164`. Add Medias upload to `ghl/api.ts`.
- Extension: `ghl_enhancements.js` click-to-call + `normalizePhone()`, the
  `chrome.runtime.sendMessage` pattern, `zoom_phone_settings.js` settings UI, the GitHub
  auto-update mechanism.

## 11. Cost / ops
- Agent: per-machine .NET app; negligible runtime cost; code-signing cert (~annual) + update host.
- Worker: Durable Objects (per-agent WS) + ingest bandwidth; modest.
- GHL: within normal API usage; watch rate limits on bursty multi-call sessions.
- No Zoom cloud-recording storage cost (the whole point of going local).

## 12. Why not the cloud-clipping approach (set aside)
The earlier plan downloaded Zoom **cloud** recordings and clipped them with FFmpeg in a Cloudflare
Container. Rejected here because: (a) desktop local recordings are invisible to Zoom's API, forcing
account-wide cloud recording; (b) cloud recording adds licensing/storage cost; (c) it required
FFmpeg infra to cut one mixed file. Local capture avoids all three and makes each call its own file.
Kept on file in `meeting-recording-clipper-plan.md` in case the channel turns out to be Zoom
**Meetings** rather than Zoom **Phone**.
```
