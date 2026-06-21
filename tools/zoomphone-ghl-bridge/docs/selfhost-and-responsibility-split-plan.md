# Self-host the bridge + agent/worker responsibility split: implementation plan

Status: in progress. Created 2026-06-21. Owns two changes that travel together:

**Progress (2026-06-21):** W1–W4 done and **deployed** to the `home` box as the
`zoomphone-bridge` Node service (user systemd, behind the `home-server` Cloudflare
Tunnel at `https://zoomphone.tableturnerr.com`); GHL OAuth installed (incl. `medias`
scopes). Verified live: a real Zoom desktop call logged correctly to GHL via the webhook.
Recording correlation: the bridge attaches clips by exact Zoom `call_id`, else phone+time,
with pending-clip race handling + stale-clip review sweep. **W5 (agent) implemented + VALIDATED END-TO-END (2026-06-21)** — a real Zoom desktop
call recorded, the agent resolved the real `call_id` + number from `call_history` by
**device-IP match** (`Δ0s, ip 192.168.18.96`, no UI scraping / memory / traffic sniffing),
uploaded `zoomCallId`, and the bridge attached the clip to the call by exact `call_id`
(`ingest: correlated + attached … call 06a37e420c54813f43d → msg …`). Also fixed two agent
gaps this required: the recorder was gated on a known phone number (now records without
one) and tentative-end never finalized without a dashboard (added a ~20s auto-confirm
backstop in `CallStateFusion`).

Remaining: **mic capture fails** ("Source must be stereo") so recordings are currently
one-sided (system/remote audio only, not the rep's mic) — needs fixing for two-way audio;
W6 (extension verify), W7 (rep mapping — repKey→GHL user, currently empty), W8 (publish the
new agent via Tool Manager + decommission the CF Worker + git-based deploy), W9 (tests).



1. **Responsibility split** — the local agent and Chrome extension stop deciding call
   *direction* (and other metadata). They detect the call and forward a unique
   identifier (Zoom `call_id` when available, else `repUserId` + `phoneE164` + connect
   time). The bridge owns direction, contact match, and GHL logging, because Zoom's
   webhooks already give it that authoritatively.
2. **Self-host the bridge** — move the `zoomphone-bridge` Cloudflare Worker onto the box
   that already runs PocketBase, behind the existing Cloudflare Tunnel, to escape the
   Workers free-tier limits.

These are sequenced together because the correlation fix (#1) lands cleanly in the
ported bridge (#2), and self-hosting removes the one piece (the Durable Object) that the
old design needed for the live push.

## 0. Why this is small

The Worker depends on exactly two Cloudflare primitives:

| CF primitive | Where it's used | Self-host replacement |
|---|---|---|
| **KV** (`env.STATE`) | `zoom/api.ts` (Zoom S2S token cache), `ghl/oauth.ts` (GHL tokens), `pipeline.ts` (`rep:*`, `call:*`), `ingest.ts` (`clip:*`, `review:*`) | A `KvStore` over **SQLite** (`kv(key, value, expires_at)`), same `get`/`put({expirationTtl})` surface |
| **Durable Object** `AgentHub` + `WebSocketPair` | `agent/hub.ts`, `agent/router.ts` — holds one WS per rep to push START/STOP | **Dropped for v1** (agent self-detects). If the live-push precision path is wanted later, a `ws` server with an in-process `Map<repUserId, ws>` replaces it — no DO needed in a long-running process. |

Everything else is standard and unchanged on Node 22:
- `crypto.subtle` HMAC (`zoom/webhook.ts`) → Node `globalThis.crypto`.
- `fetch`, `FormData`, `Blob`, `Response.json` (`ghl/api.ts`, `zoom/api.ts`) → native in Node 18+.
- `ctx.waitUntil(p)` → a one-line shim: `{ waitUntil: (p) => void p.catch(logErr) }` (ack the webhook, run work async).
- `Date.now`, `setTimeout` → unchanged.

Recommended stack: **Node 22 LTS + Hono + `@hono/node-server`**. Hono accepts the
existing Web-standard `Request`/`Response` handlers nearly verbatim, so the route
bodies (`handleZoomWebhook`, `handleRecordingIngest`, OAuth handlers) port with minimal
diff. SQLite via **`node:sqlite`** (built-in, no native build on the box; needs Node
≥ 22.5) with **`better-sqlite3`** as the fallback if an older Node is pinned.

## 1. State store decision (recommendation)

You left this to me. Recommendation: **all bridge state in SQLite, local to the
service.** It's the hot path (multiple reads/writes per call), wants TTL semantics, and
shouldn't take a network hop or couple the bridge's correctness to PocketBase
availability. One file, trivial to back up alongside PB's data.

The one piece that benefits from admin visibility is the **rep mapping** (Zoom
`user_id` ↔ rep DID ↔ GHL `user_id` ↔ display name) — it's edited by humans when reps
join/leave. Plan: keep it as a SQLite table seeded by a small CLI/JSON now, and
optionally **mirror it into a PocketBase collection later** if you want to manage reps
from the PB admin (the bridge would read it cached). Not required for v1.

SQLite tables:
```
kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER NULL)   -- replaces env.STATE
reps(zoom_user_id TEXT PK, rep_did TEXT, ghl_user_id TEXT, name TEXT)    -- rep mapping
pending_clips(corr_key TEXT PK, call_id TEXT, rep_user_id TEXT,          -- clip-before-webhook race
              phone_e164 TEXT, connect_ts_ms INTEGER, end_ts_ms INTEGER,
              channel TEXT, file_path TEXT, created_at INTEGER)
```
A periodic sweep (every few minutes) deletes expired `kv` rows and stale `pending_clips`.

## The shared Zoom account (read this — it shapes §2 and §4)

The whole team signs into **one shared Zoom account**, dials from **occasionally
different phone numbers**, and always from **different physical devices** (one agent per
machine). Consequences that drive the design:

- **Zoom `user_id` is not a rep key.** Every webhook (live + call-log) carries the same
  shared `user_id`. It can't tell reps apart, can't route a push to a device, and can't
  attribute a call to a person. Anything in the old plan keyed on `repUserId` == Zoom
  `user_id` is invalid here.
- **The device is the rep.** The only reliable per-rep signal is which machine recorded
  the audio. So **rep identity is provisioned per machine** and the agent is the
  authoritative source of it on upload (`repKey` → GHL user). This is *why* point #1's
  "agent identifies, worker enriches" split is not just cleaner but necessary.
- **DID (caller number) is a weak rep hint.** Reps "occasionally" share numbers, so the
  rep's DID can attribute a webhook-only call (no clip) to a GHL user, but it is not a
  dependable per-rep key. Prefer the device-provisioned `repKey` first.
- **The live worker→agent push is dead, not deferred.** On an inbound call the worker
  can't know which device will answer; on outbound the dialing device already self-knows
  via the dashboard dial-intent. Routing START/STOP by the shared `user_id` is
  meaningless, so the Durable Object / WS hub is removed outright (W3).
- **Per-call, exactly one device records.** `CallStateFusion` already uses local audio
  flow + dial-intent to decide "is *this* device on the call" (its header notes the
  shared-account ambiguity). So there is one clip per real call, from the right machine —
  the bridge just has to join it to the matching Zoom call by phone + time.

## 2. The correlation design (the core of point #1)

Today: agent uploads a clip → bridge blindly logs a new outbound call + attaches audio.
Target: agent uploads a clip → bridge attaches it to the **Zoom-derived** call record,
using that record's authoritative direction/contact.

The hard part is **ordering**: Zoom's `*_call_log_completed` webhook (which writes
`call:{callId}` state) can land seconds-to-minutes after the call ends, while the
agent's upload fires as soon as WAV→MP3 conversion finishes. The clip and the webhook
race. Handle both orderings:

- **Webhook-first (clip arrives after the call is logged):** ingest correlates and
  attaches immediately.
- **Clip-first (clip arrives before the webhook):** ingest stashes the clip in
  `pending_clips` (local disk + row); the webhook handler attaches it when the call is
  logged.

Because the team shares one Zoom account, the webhook `user_id` is identical across reps
and useless as a key. Correlation and attribution split into two questions:

- **Which Zoom call is this clip?** The agent resolves the **real Zoom `call_id`**
  itself (see "device-IP match" below) and sends it; the bridge attaches straight to
  `call:{callId}`. When `call_id` is absent it falls back to **`phoneE164` +
  connect-time window** (a `recent:{phoneE164}` → `callId` index, ±N-second match). The
  shared `user_id` is never part of the key.
- **Which rep / GHL user gets it?** The **agent** decides — rep identity is provisioned
  per machine (≅ device), because the shared Zoom account can't supply it. The bridge
  trusts the agent's `repKey` for GHL `userId` attribution and takes only direction /
  contact / duration from the correlated Zoom record.

**Device-IP match (how the agent gets the real `call_id` + number, desktop-only,
no UI scraping).** Zoom's `call_history` API returns `device_private_ip` (the LAN IP of
the machine that placed the call) on every record. The agent matches the record whose
`device_private_ip` is one of *this* machine's local IPs and whose `start_time` is near
the recording start — exact per-device, since a machine is on one call at a time — and
reads the `call_id` + external `*_did_number`. This replaced the abandoned ideas of UI
scraping (in-process UIA froze Zoom), memory scanning (Chromium V8 heap), and traffic
sniffing (TLS + cert pinning). The live worker→agent push is still dead (W3); exact
`call_id` now comes from the agent's own `call_history` lookup instead.

Resolution order:
1. **Exact Zoom `call_id`** (agent-resolved) → `call:{callId}`.
2. **`phoneE164` + connect-time window** — fallback when `call_id` is absent.
3. **No match yet** → hold the clip pending; the call-log webhook attaches it on arrival.
4. **No phone AND no `call_id`** → park in GHL Medias for review (never dropped).

Worker-owned direction: **when a Zoom call is correlated**, its `direction` / `contact` /
`from`-`to` / duration win and the agent's guess is discarded. The agent's `direction` is
used *only* in the no-correlation fallback (#2). Rep attribution always comes from the
agent's `repKey`, correlated or not.

## 3. Architecture after the change

```
 Zoom Phone (desktop OR web)
        │ webhooks (signed)
        ▼
 ┌───────────────────────────────────────────────┐
 │ Self-hosted bridge (Node, same box as PB)       │
 │  behind Cloudflare Tunnel → zoomphone.tableturnerr.com
 │   • /zoom/webhook  → dispatch → GHL log (direction authoritative here)
 │   • writes call:{id} + recent:{phone} index
 │   • /recordings/ingest → correlate clip (call_id, else phone+time) → attach to SAME convo
 │   • /oauth/* GHL install/refresh
 │   • SQLite: kv + pending_clips
 └───────────────────────────────────────────────┘
        ▲ HTTPS upload {repKey, zoomCallId?, phoneE164?, connectTsMs, endTsMs, clientCallId, channel, direction?}
        │  repKey = device-provisioned rep identity; direction is a FALLBACK only
 ┌───────────────────────────────────────────────┐
 │ CRM Agent (.NET, per machine)                   │
 │   • detects call locally (CallStateFusion, unchanged for local UX)
 │   • on call end: resolves real call_id + number from Zoom call_history (device-IP match)
 │   • records audio, forwards the identifier (call_id / phone)
 │ Chrome extension → native messaging → agent (web calls; already identifier-only)
 └───────────────────────────────────────────────┘
```

`CallStateFusion` stays — it's still needed to know *when* to start/stop recording, to
drive the dashboard "on a call" indicator, talk-time, and tentative-end prompts. What
changes is that its `direction` no longer rides on the upload as truth; the bridge
overrides it via correlation.

## 4. Frozen upload contract (v1)

`POST /recordings/ingest` (multipart, `Authorization: Bearer <AGENT_SHARED_TOKEN>`):
```
repKey        device-provisioned rep identity → maps to GHL userId (NOT the shared Zoom user_id)
zoomCallId    real Zoom call_id (agent-resolved via call_history device-IP match); exact correlation
phoneE164     external party number (call_history-resolved; null → fall back / review)
connectTsMs   call connect epoch ms
endTsMs       call end epoch ms
channel       "desktop" | "web"
direction?    agent's LOCAL guess — used only if the bridge can't correlate a Zoom call
clientCallId  agent-minted id, for UPLOAD DEDUP ONLY (not a Zoom id)
clip          the audio file
→ 200 { ghlMessageId, correlated: true|false }
→ 202 { status: "review" }   (no phone at all, parked)
→ 409 { ghlMessageId }        (duplicate clientCallId)
```
Dedup key = `clientCallId`. `direction` is present but **advisory**: the bridge's
webhook-derived direction overrides it whenever a Zoom call correlates; `repKey` is
always authoritative for GHL attribution.

## 5. Multi-agent workstream breakdown

Each is sized for one agent/dev. Phase 0 freezes decisions; §4 is the interface.

### Phase 0 — Decisions & contract freeze (gate, not code)
- Store = SQLite (rep map optionally mirrored to PB later). Hosting = same box +
  existing tunnel, hostname `zoomphone.tableturnerr.com`. Runtime = Node 22.
- Drop `AgentHub`/WS-push for v1; correlate by `repUserId`+`phoneE164`+time.
- Freeze the §4 upload contract before W4/W5/W6 fan out.

### W1 — Bridge scaffold & runtime adapter  *(blocks all; no deps)*
- New Node entry under `tools/zoomphone-ghl-bridge/server/` (or convert in place):
  Hono app + `@hono/node-server`, an `Env` object built from `process.env`, a
  `ctx.waitUntil` shim, `/health`.
- Port `index.ts` routing 1:1 to Hono routes; keep handler bodies untouched (they take
  Web `Request`/`Response`).
- **Accept:** `pnpm dev` serves locally; `/health` 200; a signed Zoom URL-validation
  challenge round-trips (proves `crypto.subtle` works on Node).

### W2 — KV → SQLite store  *(deps: W1)*
- `KvStore` implementing `get(key)`, `put(key, value, { expirationTtl })`, `delete`,
  backed by the `kv` table with lazy + swept expiry. Inject it as `env.STATE`.
- Swap call sites in `zoom/api.ts`, `ghl/oauth.ts`, `pipeline.ts`, `ingest.ts`.
- **Accept:** Zoom + GHL token caches persist across restart; TTL expiry observed;
  existing dispatch path still logs a call end-to-end against a fake event.

### W3 — Remove AgentHub DO + WS push (folded into W1/W2 first pass)  *(deps: W1)*
- The live worker→agent push is **not viable** on a shared Zoom account (the bridge can't
  tell which device should record — §"shared Zoom account"), so it's removed outright,
  not deferred: delete `/agent/connect`, `hub.ts`, `router.ts`, the `AGENT_HUB` binding,
  the `pushToAgent` calls, and the WS START/STOP wire types. Done as part of the W1/W2
  port so the Node build has no dangling Cloudflare/DO references.
- `handleLiveStart`/`handleLiveStop` are repurposed (in W4) to seed the `recent:{phone}`
  correlation index, not to push.
- **Accept:** Node build is clean with zero DO / WS-push references.

### W4 — Ingest correlation + worker-owned direction  *(deps: W2; CORE)*
- Rewrite `handleRecordingIngest`:
  1. Resolve correlation: `zoomCallId` → `call:{id}`; else `recent:{repUserId}:{phoneE164}`
     within the time window; bounded wait (~30–60s, like `waitForCallState`).
  2. On match: attach audio to the existing `conversation_id` with stored direction /
     contact / from-to / rep. No second standalone "outbound" entry.
  3. No match within wait → write to `pending_clips` (disk + row) so the webhook can
     attach later; respond `202 review` only after the pending window also lapses.
- Add the reverse path in `handleCallLog` (and live handlers): after logging a call,
  check `pending_clips` for a matching `corr_key` and attach.
- Add `recent:{repUserId}:{phoneE164}` index writes in the call-log + live handlers.
- **Accept:** all three orderings tested (webhook→clip, clip→webhook, no-match→review)
  produce exactly one correctly-directioned GHL call with the audio attached; dup
  upload is a 409 no-op.

### W5 — Agent: forward identifier, stop owning direction  *(deps: §4 contract)*
- `RecordingUploadService`: send `{repUserId, phoneE164, connectTsMs, endTsMs, channel,
  clientCallId}`; drop the synthetic `callId = channel:rep:connectTs` framing in favor
  of `clientCallId` for dedup; remove any direction implication. Stamp `zoomCallId` only
  if W3-v2 lands.
- Tidy lingering "PocketBase" naming in `AgentConfig`/`RecordingEntry`
  (`pocketbaseRecordingId`, `LastPocketbaseUrl`) now that the target is the bridge.
- Point `WorkerBaseUrl` default at `https://zoomphone.tableturnerr.com`.
- **Accept:** a recorded desktop call uploads an identifier-only payload that the bridge
  correlates and attaches with the right direction.

### W6 — Extension: identifier-only (verify)  *(deps: §4 contract)*
- `zoom_call_detect.js` already emits `phoneE164` + `connectTsMs`/`endTsMs` and the
  native host relays START/STOP without direction — confirm no direction leaks and that
  the dialed-number passthrough (`gmes_zoom_last_dialed`) still feeds the upload's
  `phoneE164`. Mostly verification + a regression note.
- **Accept:** a web call records and attaches to the right contact with worker-derived
  direction; no direction field sent from the extension.

### W7 — Rep mapping store  *(deps: W1/W2)*
- `reps` table keyed by **`repKey`** (device-provisioned) → GHL `user_id` + display name
  + optional DID, with a `seed` CLI. Two read paths: (a) the agent's `repKey` on a clip
  upload → GHL `userId` (authoritative); (b) a DID → GHL `user_id` index for
  **webhook-only** calls with no clip (best-effort rep attribution, since reps sometimes
  share numbers), replacing today's `rep:{did}` KV lookups. Zoom `user_id` is **not**
  stored (shared account, no signal). Optional PocketBase-collection mirror behind a flag.
- **Accept:** a clip's `repKey` resolves to a GHL user; an unprovisioned `repKey`
  attributes to a configurable default and logs a warning, never crashes.

### W8 — Deploy & cutover  *(deps: W1–W4)*
- `cloudflared` ingress: `zoomphone.tableturnerr.com` → `localhost:<port>`; run the
  bridge as a systemd service / pm2 / small Docker container on the PB box.
- Re-point Zoom Event Subscription URL and GHL Marketplace redirect URL to the new host;
  re-run `/oauth/install` (don't migrate tokens — just re-auth). Set the same secrets as
  env vars / `.env` (no KV/DO bindings).
- Provision agents with the new `workerBaseUrl`; decommission the CF Worker + KV + DO
  once traffic is clean.
- **Accept:** a live test call logs + attaches through the self-hosted host; CF Worker
  receives no traffic; free-tier pressure gone.

### W9 — Tests & observability  *(runs alongside)*
- Replay harness: signed fake Zoom events + a sample clip exercising the three orderings
  and the dedup/review branches. Structured logs, `/health`, dead-letter for failed
  attaches.

## 6. Sequencing

```
Phase 0 (decisions + §4 freeze)
   ├─ W1 ──► W2 ──► W4 ──► W8 (cutover)          ← critical path
   │                 ├─ W5 (agent)  ┐
   │                 └─ W6 (ext)    ┴─ parallel after §4
   ├─ W7 (rep map) ── parallel after W2
   ├─ W3 (remove DO + WS push) ── folded into the W1/W2 first pass
   └─ W9 (tests/obs) ── alongside
```

## 7. Risks & edge cases

| Risk | Handling |
|---|---|
| Clip arrives before the call-log webhook | `pending_clips` + reverse-attach on webhook (§2). |
| Webhook never arrives (Zoom drop) | Pending clip ages out → review (Medias), never lost. |
| Two reps call the SAME number within the window | Tighten the window; tie-break on closest `connectTsMs`. Rep attribution stays correct regardless (it comes from the device's `repKey`, not the call match). Genuinely rare. |
| Shared Zoom account → no per-rep webhook signal | Rep identity comes from the device-provisioned `repKey`, never from the Zoom `user_id` (§"shared Zoom account"). |
| `repKey` not provisioned on a machine | Attribute to a configurable default GHL user; log a warning; never crash. |
| Node SQLite availability | `node:sqlite` (Node ≥ 22.5; dev box is Node 24) else `better-sqlite3`. |
| Tunnel/host downtime during a call | Agent's durable upload queue retries (already built); webhook intake backstops the call log. |
| GHL OAuth token loss on cutover | Re-run `/oauth/install` against the new host (one-time). |

## 8. Out of scope (v1)
- The live worker→agent push / exact `call_id` — removed, not deferred: it can't be
  routed on a shared Zoom account. Correlation by phone + time is the join.
- Per-process audio capture, code-signing, and the broader items already tracked in
  `local-recording-architecture-plan.md`.
