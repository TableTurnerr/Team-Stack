# zoomphone-ghl-bridge

> Part of the [CRM-Tableturnerr](../../README.md) monorepo (`tools/zoomphone-ghl-bridge`).
> Previously the standalone `zoomphone-to-ghl` project; it now lives here.

> **Migration in progress (2026-06-21):** this is being moved off Cloudflare
> Workers to a **self-hosted Node service** (Node 22+, Hono, SQLite) that runs on
> the PocketBase box behind the Cloudflare Tunnel, and the agent/worker
> responsibilities are being re-split so the bridge owns call direction. The
> request handlers (`src/`) and the Node entry (`src/server.ts`) are live and
> typecheck; the recording-ingest correlation and cutover are still in progress.
> Run locally with `pnpm install && pnpm dev`. The Cloudflare/`wrangler` setup
> below is retained for reference until cutover. See
> [`docs/selfhost-and-responsibility-split-plan.md`](docs/selfhost-and-responsibility-split-plan.md).

A Cloudflare Worker that listens to Zoom Phone webhooks and logs every call into
GoHighLevel: direction, duration, timestamps, the recording, and (when Zoom
provides it) the voicemail transcript. New phone numbers get auto-upserted as
GHL contacts so nothing falls through the cracks.

It also drives the **local-recording pipeline**: a Durable Object (`AgentHub`)
holds one live WebSocket per rep's CRM Agent, and the Worker pushes START/STOP
from Zoom's live phone events. The agent records the call locally and uploads
the clip to `/recordings/ingest`, which attaches it to the matching GHL contact.

## How it works

```
Zoom Phone ──webhook──► Cloudflare Worker ──► GoHighLevel
                              │
                              ├─ KV: Zoom OAuth token cache (1 hr TTL)
                              ├─ KV: GHL OAuth tokens (24 hr access + refresh)
                              └─ KV: zoom_call_id → ghl_message_id
                                     (dedupe + late-arriving recordings)
```

Zoom posts the events below separately, often seconds to a few minutes apart:

| Zoom event                                  | What we do                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| `phone.caller_call_log_completed`           | Outbound call ended → upsert contact, create Call message in GHL          |
| `phone.callee_call_log_completed`           | Inbound call ended → same, but log as inbound                             |
| `phone.recording_completed`                 | Recording ready → download from Zoom, attach to existing GHL conversation |
| `phone.voicemail_received`                  | Voicemail → log as a Call with `status: "voicemail"` plus the audio       |
| `phone.voicemail_transcription_completed`   | Voicemail transcript ready → attach as a note on the contact              |
| `phone.caller_connected` / `callee_answered`| Live call started → push `START` to the rep's connected CRM Agent         |
| `phone.caller_ended` / `callee_ended`       | Live call ended → push `STOP` to the rep's connected CRM Agent            |

Because the events can arrive out of order, the Worker keeps a small map in KV
from `zoom_call_id` to the GHL message it created, so the recording handler
can patch the right entry when it shows up minutes later.

## Setup

You need three things wired together: a Zoom Server-to-Server OAuth app, a
GoHighLevel Marketplace app (with a Conversation Provider module), and the
Worker deployed to Cloudflare. The order below matters because each step
produces a credential the next one needs.

### 1. Create the Zoom Server-to-Server OAuth app

1. Go to <https://marketplace.zoom.us/develop/create>, sign in as the Zoom
   account admin.
2. Pick **Server-to-Server OAuth**. Give it a name like `GHL Call Logger`.
3. On the **App Credentials** screen, copy these three values into a scratchpad,
   you will paste them into Cloudflare later:
   - `Account ID`  → `ZOOM_ACCOUNT_ID`
   - `Client ID`   → `ZOOM_CLIENT_ID`
   - `Client Secret` → `ZOOM_CLIENT_SECRET`
4. **Information** tab: fill in the basic short / long description and contact
   info. Zoom requires this before you can activate.
5. **Feature** tab → toggle **Event Subscriptions** on. Click **Add Event
   Subscription**.
   - Subscription name: `call-events`.
   - Event notification endpoint URL: leave blank for now, you fill this in
     after the Worker is deployed.
   - Copy the **Secret Token** into your scratchpad → `ZOOM_SECRET_TOKEN`. You
     will see another field called **Verification Token**, copy that too →
     `ZOOM_VERIFICATION_TOKEN` (it is harmless to set even if unused).
   - Click **Add Events** and subscribe to exactly these five (and nothing
     else, the popup lists dozens of ringing / hold / mute / park / SMS events
     that are noise for call logging):
     - Phone → `Phone Call Log` → `Caller call log is completed`
       (`phone.caller_call_log_completed`)
     - Phone → `Phone Call Log` → `Callee call log is completed`
       (`phone.callee_call_log_completed`)
     - Phone → `Phone Recording` → `Call recording is completed`
       (`phone.recording_completed`)
     - Phone → `Phone Voicemail` → `Voicemail is received`
       (`phone.voicemail_received`)
     - Phone → `Phone Voicemail` → `Voicemail transcription is complete`
       (`phone.voicemail_transcription_completed`)
   - Save.
6. **Scopes** tab → add the granular Phone scopes. The four you need:
   - `phone:read:call_log:admin`
   - `phone:read:list_call_logs:admin`
   - `phone:read:recording:admin`
   - `phone:read:voicemail:admin`

   If a Phone scope is missing from your account, your Zoom Phone plan might
   not include the API tier. The Marketplace scope picker is the authoritative
   source for what your account has access to.
7. **Activation** tab → activate. The activation will fail until the webhook
   URL responds to Zoom's validation challenge, so come back to this after
   step 5 below.

### 2. Create the GHL Marketplace app

GHL's Private Integration Token cannot post calls (it has no way to own a
Conversation Provider). You need a Marketplace app that exposes a
`Conversation Provider` module of type `Call`.

1. Go to <https://marketplace.gohighlevel.com> and sign in as the agency owner.
2. **My Apps** → **Create App**.
3. Name it `Zoom Phone Logger`, type **Private**, distribution **Sub-account**.
4. **Settings** tab → set the **Redirect URL** to
   `https://zoomphone-bridge.<your-subdomain>.workers.dev/oauth/callback`.
   You won't know the exact subdomain until after `wrangler deploy` in step 4,
   so leave a placeholder here and come back to update it before step 5.
5. **Scopes** tab → tick:
   - `contacts.readonly`
   - `contacts.write`
   - `conversations.readonly`
   - `conversations.write`
   - `conversations/message.readonly`
   - `conversations/message.write`
6. **App Credentials** → copy the **Client ID** and **Client Secret** to your
   scratchpad → `GHL_MARKETPLACE_CLIENT_ID`, `GHL_MARKETPLACE_CLIENT_SECRET`.
7. **Conversation Providers** module → **Add Provider**.
   - Name: `Zoom Phone`
   - Type: **Call**
   - Save. Copy the generated provider ID → `GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID`.

Then, in your GHL agency: switch into the **sub-account** where the sales
team's contacts live and copy the **Location ID** (the 20-character string in
the URL when you're inside the sub-account) → `GHL_LOCATION_ID`.

### 3. Deploy the Worker

```powershell
pnpm install              # from the monorepo root (installs all workspace deps)
npx wrangler login        # opens a browser to authorize Cloudflare
npx wrangler kv namespace create STATE
npx wrangler kv namespace create STATE --preview
```

Paste the two IDs that printed into `wrangler.toml` under the `STATE` binding,
replacing `REPLACE_WITH_KV_ID` and `REPLACE_WITH_KV_PREVIEW_ID`.

Push the nine secrets to the Worker:

```powershell
npx wrangler secret put ZOOM_SECRET_TOKEN
npx wrangler secret put ZOOM_VERIFICATION_TOKEN
npx wrangler secret put ZOOM_CLIENT_ID
npx wrangler secret put ZOOM_CLIENT_SECRET
npx wrangler secret put ZOOM_ACCOUNT_ID
npx wrangler secret put GHL_MARKETPLACE_CLIENT_ID
npx wrangler secret put GHL_MARKETPLACE_CLIENT_SECRET
npx wrangler secret put GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID
npx wrangler secret put GHL_LOCATION_ID
npx wrangler secret put AGENT_SHARED_TOKEN
```

`AGENT_SHARED_TOKEN` is the shared secret the CRM agents use to authenticate
both the WebSocket (`GET /agent/connect?token=…`) and the clip upload
(`Authorization: Bearer …` on `POST /recordings/ingest`). Generate a strong
random value and provision it to each rep's agent at install time.

Deploy:

```powershell
npx wrangler deploy
```

Copy the deployed URL (it looks like
`https://zoomphone-bridge.<your-subdomain>.workers.dev`). If the GHL
Marketplace app's Redirect URL still has a placeholder, go back to step 2.4
and update it to the real URL now.

### 4. Install the GHL app on your sub-account

The Worker uses Marketplace OAuth, which means the agency owner needs to
authorize it once on the sub-account. The Worker has a route that walks you
through the flow.

1. In your browser, open
   `https://zoomphone-bridge.<your-subdomain>.workers.dev/oauth/install`.
2. GHL redirects you to a "Choose Location" screen. Pick the sub-account that
   matches `GHL_LOCATION_ID`.
3. Authorize. GHL redirects back to the Worker's `/oauth/callback`, which
   exchanges the code for an access + refresh token and stashes them in KV.
4. You'll see `GHL install complete. Location: <id>.` if everything worked.

The Worker now has long-lived GHL credentials. It will refresh its own access
token before it expires; you only need to repeat this step if the refresh
token is ever revoked.

### 5. Point Zoom at the Worker

Back in the Zoom app, Feature → Event Subscriptions → edit the subscription
you created in step 1.5.

- Event notification endpoint URL: `https://zoomphone-bridge.<your-subdomain>.workers.dev/zoom/webhook`
- Click **Validate**. Zoom posts a one-shot challenge to that URL and the
  Worker replies with the HMAC of the `plainToken`. If you see "Validated",
  you're good.

Now go to the **Activation** tab and activate the app. From this point Zoom
will start delivering events for every call on the account.

### 6. Smoke test

Place a test call on a Zoom Phone extension. Within a minute or two you should
see:

- The contact upserted (or matched) in GHL by phone number.
- A Call entry on the contact's Conversations tab marked inbound or outbound
  with the correct duration.
- The recording attached as a follow-up entry in the same conversation once
  Zoom finishes processing it (typically 30 seconds to a few minutes later).

Tail the Worker logs while testing:

```powershell
npx wrangler tail
```

## Environment variables

| Name                                       | Source                                              |
| ------------------------------------------ | --------------------------------------------------- |
| `ZOOM_SECRET_TOKEN`                        | Zoom app → Feature → Event Subscriptions            |
| `ZOOM_VERIFICATION_TOKEN`                  | Same screen (kept for completeness)                 |
| `ZOOM_CLIENT_ID`                           | Zoom app → App Credentials                          |
| `ZOOM_CLIENT_SECRET`                       | Zoom app → App Credentials                          |
| `ZOOM_ACCOUNT_ID`                          | Zoom app → App Credentials                          |
| `GHL_MARKETPLACE_CLIENT_ID`                | GHL Marketplace app → App Credentials               |
| `GHL_MARKETPLACE_CLIENT_SECRET`            | GHL Marketplace app → App Credentials               |
| `GHL_MARKETPLACE_CONVERSATION_PROVIDER_ID` | GHL Marketplace app → Conversation Providers module |
| `GHL_LOCATION_ID`                          | GHL sub-account ID (URL when inside the sub-account)|
| `AGENT_SHARED_TOKEN`                       | Shared bearer/WS token for CRM agents (you generate it) |

## Local development

```powershell
cp .dev.vars.example .dev.vars     # paste real values, do not commit this file
pnpm dev                           # from this folder (tools/zoomphone-ghl-bridge)
```

`pnpm dev` runs `wrangler dev`, which serves the Worker locally on `localhost:8787`. To test the Zoom
webhook flow against your laptop, tunnel it with `cloudflared tunnel
--url http://localhost:8787` and use the printed URL in the Zoom app's
subscription. Same trick for installing GHL against a local URL.

## Known limits and gotchas

- **Voicemail transcripts**: Zoom fires `phone.voicemail_transcription_completed`
  once the transcript is ready, which can land a minute or two after
  `phone.voicemail_received`. The Worker keys the voicemail state by Zoom
  voicemail ID so the later transcript event can find the right contact.
- **Live call transcripts**: we don't subscribe to `phone.recording_transcript_completed`
  (call recording transcripts). If a manager later wants AI summaries of
  recorded calls, that's a separate event + scope to add.
- **Two timeline entries per recorded call**: GHL has no PATCH endpoint for an
  existing call message, so the recording arrives as a second Call entry in
  the same conversation, labeled "Call recording". Users see the original
  call entry plus a playback widget below it. Refactor to Durable Object
  alarms later if the double entry is annoying.
- **Recording downloads**: Zoom's `download_url` requires an OAuth bearer
  header (the S2S access token). The Worker fetches the audio, then uploads
  to GHL.
- **GHL upload cap**: GHL's conversation upload endpoint maxes out at 5 MB
  per file. Long calls may need the Medias API instead — note in code, TBD
  until we hit the wall.
- **Event order is not guaranteed**: a recording event can land before the
  call-log event. The Worker waits up to 30 seconds (6 × 5s) for the call
  state to appear before dropping the recording.
- **Zoom retries**: only on 5xx, three attempts (+5 min, +20 min, +60 min).
  4xx is final. The Worker acks within milliseconds and does the real work
  in `ctx.waitUntil`.

## Local recording pipeline

Reps run a CRM Agent on their machine that records each call locally and uploads
the clip here. Two routes back it:

- `GET /agent/connect?token=<AGENT_SHARED_TOKEN>` — WebSocket upgrade into the
  `AgentHub` Durable Object (hibernatable). The agent's first frame is a
  `HELLO` carrying its `repUserId` (== the rep's Zoom `user_id`); the Worker
  registers the socket under that id. `PING`→`PONG` keepalive. On a live Zoom
  phone event the Worker pushes `START`/`STOP` to the matching rep's socket; if
  no agent is connected for that rep it logs and no-ops.
- `POST /recordings/ingest` — `Authorization: Bearer <AGENT_SHARED_TOKEN>`,
  `multipart/form-data` (`callId, repUserId, channel, phoneE164, connectTsMs,
  endTsMs, sha256` + a `clip` file). Deduped by `callId` (`clip:{callId}` in
  KV; a repeat returns `409`). With a phone number it upserts the contact, logs
  an outbound Call, and attaches the clip (≤5 MB via the conversations upload,
  larger via the Medias API as a link). With no phone number it parks the clip
  in Medias for manual review (`review:{callId}`, returns `202`).

Wire contracts (`START`/`STOP`/`HELLO`/`PING`/`PONG`) are frozen in
`src/agent/contracts.ts` and shared with the agent and the Chrome extension.

## File layout

```
src/
  index.ts            worker entry, routes
  phone.ts            E.164 normalization
  pipeline.ts         event → contact → call → recording orchestration + live START/STOP push
  zoom/
    webhook.ts        signature verify, URL validation, event dispatch
    api.ts            S2S OAuth token + recording / transcript download
  ghl/
    oauth.ts          Marketplace OAuth: install URL, callback, token refresh
    api.ts            contact upsert, call message, audio upload, Medias upload, note
  agent/
    contracts.ts      frozen wire types (HELLO / START / STOP / PING / PONG)
    hub.ts            AgentHub Durable Object: one hibernatable WS per rep
    router.ts         /agent/connect upgrade + pushToAgent helper
  recordings/
    ingest.ts         POST /recordings/ingest → dedup → GHL attach / review
```
