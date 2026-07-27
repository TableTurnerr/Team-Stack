# CRM Cloud Relay

Always-up **store-and-forward fallback** for the home server. When the home box (PocketBase + zoomphone-ghl-bridge behind the Cloudflare Tunnel) is down, the relay:

- receives **Zoom webhooks** and buffers them durably *before* acking Zoom (Zoom only retries 3× over ~85 min — a plain outage loses events forever without this),
- receives **agent recording uploads** and buffers the raw multipart bodies,
- serves **`/agent/bootstrap`** from a cached copy so agents can (re)provision while home is down,

and the moment the home server is reachable again, a cron drain **pushes everything back home and deletes it from the cloud**. The relay stores nothing long-term except the tiny bootstrap config cache — by design, all data lives on the home server.

```
                    ┌─────────────────────────── CLOUD (free tier) ───────────────────────────┐
 Zoom webhooks ────►│                                                                          │
 Agent uploads ────►│  Worker: crm-cloud-relay          R2: crm-relay-buffer (transit only)    │
 Agent bootstrap ──►│  - persist → forward → delete     KV: bootstrap cache + drain lock       │
                    │  - cron drain every 2 min                                                │
                    └───────────────┬──────────────────────────────────────────────────────────┘
                                    │ forwards / drains (oldest first, webhooks before clips)
                                    ▼
                    https://zoomphone.tableturnerr.com  (home server via Cloudflare Tunnel)
                    bridge is idempotent: call_id / clientCallId dedup ⇒ replays are safe
```

## Why the relay never writes to GoHighLevel

GHL rotates the refresh token on every refresh and **revokes the whole grant if a rotated token is replayed**. The bridge guards this with an in-process mutex, which only works because there is exactly one writer. The relay therefore *only* buffers and forwards — GHL mirroring stays the bridge's job.

## Endpoints

| Path | Method | Auth | Behavior |
|---|---|---|---|
| `/zoom/webhook` | POST | Zoom HMAC (`ZOOM_SECRET_TOKEN`) | **Forward-first**: validate → forward to home (2.5s timeout) → 204. Zero storage ops when home is up. Only if home fails/times out: persist to R2, then 204. Answers `endpoint.url_validation` locally. |
| `/recordings/ingest` | POST | `Bearer AGENT_SHARED_TOKEN` | Proxy to home (any <500 response passes through verbatim). Home down/5xx → buffer to R2, return `{status:"buffered", pending:true}`. |
| `/agent/bootstrap` | GET | `Bearer AGENT_SHARED_TOKEN` | Proxy to home; cache successful responses in KV; serve the cache when home is down. |
| `/health` | GET | none | `{home: "up"/"down", buffered: {webhooks, recordings, failed}}` |
| `/drain` | POST | `Bearer AGENT_SHARED_TOKEN` | Manually trigger a drain (same as the cron). Returns counts. |

## One-time deployment

Prereqs: a Cloudflare account with the `tableturnerr.com` zone (the tunnel already lives there), Node 20+, `npm i` in this directory.

```bash
cd tools/cloud-relay
npm install
npx wrangler login

# 1. Create the buffer bucket and KV namespace
npx wrangler r2 bucket create crm-relay-buffer
npx wrangler kv namespace create RELAY_KV
#    → copy the printed id into wrangler.toml [[kv_namespaces]] id

# 2. Secrets — MUST match the bridge's .env on the home server
npx wrangler secret put ZOOM_SECRET_TOKEN
npx wrangler secret put AGENT_SHARED_TOKEN

# 3. Deploy (also provisions the custom domain route zoomphone-relay.tableturnerr.com)
npx wrangler deploy

# 4. Verify
curl https://zoomphone-relay.tableturnerr.com/health
```

## Wiring it in (two changes)

1. **Zoom webhook URL**: in the Zoom Marketplace app that currently points at `https://zoomphone.tableturnerr.com/zoom/webhook`, change the Event notification endpoint to `https://zoomphone-relay.tableturnerr.com/zoom/webhook` and complete the URL validation. From then on the relay is the front door and home outages can't lose webhooks. (The dashboard's separate Zoom webhook subscription on Vercel is unchanged.)
2. **Agents**: the Local CRM Agent's fallback URL defaults to `https://zoomphone-relay.tableturnerr.com` (configurable via `CRM_AGENT_FALLBACK_URL` / `fallbackWorkerBaseUrl`). Nothing to do unless you use a different hostname.

## Operations

- **Is home down right now?** `GET /health` → `home: "down"` plus buffered counts.
- **Force a drain** after bringing home back up (the cron does it within 2 min anyway):
  `curl -X POST -H "Authorization: Bearer $AGENT_SHARED_TOKEN" https://zoomphone-relay.tableturnerr.com/drain`
- **`failed/` prefix in R2**: items home definitively rejected with a 4xx. Inspect in the Cloudflare dashboard (R2 → crm-relay-buffer). These are the only objects that persist; delete after review.
- **Auth aborts**: a drain that returns `aborted: "...token parity"` means the relay's secret no longer matches the bridge's `.env` — fix the secret; nothing is lost or parked.
- **Logs**: `npx wrangler tail`.

## Data & cost — designed to idle at ~zero when home is up

The relay only does real work during an outage. Steady-state (home healthy):

- **Zoom webhooks**: pure proxy — validate + forward + 204. No R2, no KV. A heavy calling day (~500 calls ≈ 2,500 events) uses ~2.5k of the 100k/day Workers request quota.
- **Recording uploads / bootstrap**: don't reach the relay at all — the agent always tries the home bridge first and falls back only on network failure/5xx.
- **Cron drain (every 2 min)**: exits after a 1–2-object R2 list when the buffer is empty — no KV writes, no call to home. (~1.4k R2 Class A ops/day ≈ 43k/month vs the 1M/month free allowance. The KV lock is only taken when there is actually something to drain, keeping KV writes near zero against the tight 1,000/day free limit.)

During an outage: one R2 put per webhook/clip, then one delete each at drain time — a full-day outage with thousands of events is still a rounding error. Storage: clips are typically 1–10 MB; the 10 GB R2 free cap comfortably covers multi-day outages (a week-long outage with very heavy recording volume is the only scenario worth watching — check `/health` counts).

Net: **$0/month** in normal operation and during realistic outages. Nothing accumulates because every object is deleted on confirmed handoff (2xx/409 from home); the only persistent bytes are the bootstrap cache JSON in KV.

## Ordering guarantee

Drains replay **webhooks before recordings**, oldest first, and stop at the first sign of home flaking (preserving FIFO). This restores the bridge's call/contact state before clips arrive, so clip↔call correlation works. Clips replayed much later still correlate via exact `zoomCallId` (30-day state) even though the phone+time index only lives 1 hour.
