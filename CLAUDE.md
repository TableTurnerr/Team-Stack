# CLAUDE.md

Guidance for Claude Code when working in this repository (Tableturnerr CRM monorepo).

## Auto Prompt Optimization (MANDATORY)

**EVERY user prompt MUST be internally optimized before execution.** Refine the raw prompt using the principles in `.claude/skills/prompt-optimizer/SKILL.md`, then immediately execute the optimized version. Never show the optimized prompt or mention the optimization — unless the user prefixes with `optimize:`, which returns the refined prompt as text output instead.

## Database — Source of Truth

Self-hosted **PocketBase** behind a Cloudflare Tunnel — prod `https://crmdb.tableturnerr.com`, dev `http://localhost:8090`.

**`packages/pocketbase-client/pb_db_schema.json` is the schema source of truth.** Read it to understand the DB; edit it to change the DB. 47 collections (7 PocketBase system). Business groups:

- **Auth/RBAC**: `users` (role/status/`discord_user_id`), `roles` (page_access/permissions/data_access), `user_preferences` (theme, timezones, power_dialer_state)
- **Leads/accounts**: `companies` (core lead record: owner, location, IG handle, status pipeline, google rating), `phone_numbers`, `lead_categories`
- **Cold calling**: `cold_calls`, `cold_calling_sessions`, `call_logs`, `call_transcripts`, `call_claims` (call-ownership arbitration), `custom_call_outcomes`, `recordings`
- **Follow-ups/activity**: `follow_ups` (QStash-scheduled, `qstash_message_id`), `interactions`, `company_notes`, `notes`, `event_logs`, `alerts`, `goals`, `rules`
- **Email marketing**: `email_campaigns`, `email_templates`, `email_lists`, `email_recipients`, `email_events`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`, `email_unsubscribes`
- **Instagram**: `insta_actors`, `outreach_logs`
- **Financial**: `bank_accounts`, `balance_adjustments`, `fin_categories`, `fin_transactions`, `recurring_transactions`
- **Infra**: `agent_devices` (registered desktop agents), `push_subscriptions`, `zoom_call_events`, `ghl_connections` (GHL OAuth tokens), `recycle_bin` (soft-delete restore)

## Monorepo Map

pnpm workspace (`pnpm@9`; globs `packages/*`, `apps/*`, `tools/*`). No turbo/nx — plain `pnpm -r` fan-out. **Use `pnpm`, not `npm`.** Umbrella version lives in the root `package.json`.

| Path | What it is |
|---|---|
| `apps/dashboard` | Next.js 15 / React 19 / Tailwind 4 CRM web app + all server API routes. Deploys to Vercel. The hub. |
| `apps/insta-outreach-agent` | Python IG DM agent — **unfinished/orphaned** (only `src/core/`, no entrypoint, not in workspace scripts). |
| `packages/pocketbase-client` | Shared TS SDK wrapper (`src/index.ts`) + `pb_db_schema.json`. Also `src/python/`. |
| `packages/telemetry-client` | Dependency-free log/heartbeat shipper → ParentSite ingest. Used by bot, bridge, insta-agent. |
| `packages/supabase-client` | **Vestige of an abandoned Supabase migration** (`dist/` only, no src/package.json) — do not build on it. |
| `tools/chrome-extension` | "Lead Scraper" MV3 extension: Google Maps scraping, GHL enhancements (`ghl_enhancements.js`), Zoom web-phone call detection. Plain unbundled JS. |
| `tools/local-CRM-Agent` | .NET 8 Windows agent: Zoom Phone call detection (UI Automation), WASAPI audio recording, local WebSocket server + Chrome native messaging. |
| `tools/tool-manager` | .NET 8 WinForms installer/auto-updater for all team tools (pulls GitHub Releases). |
| `tools/zoomphone-ghl-bridge` | Node/Hono service mirroring Zoom Phone → GoHighLevel; ingests recordings. Port 8787, sqlite via experimental `node:sqlite`. |
| `tools/cloud-relay` | Cloudflare Worker store-and-forward fallback (`zoomphone-relay.tableturnerr.com`): buffers Zoom webhooks + recording uploads in R2 while the home server is down, cron-drains them back (webhooks before recordings), deletes after handoff. Never writes GHL (refresh-token single-writer invariant). See its README for deploy/ops. |
| `tools/discord-bot` | Follow-up notification bot (polls PocketBase every `POLL_INTERVAL_MINUTES`). |
| `tools/audio-recorder` | Python/PyQt hotkey system-audio recorder + NSIS installer (`recorder.py`). |
| `tools/database` | Python DB migration/seed scripts. |
| `tools/zoom-uia-probe` | .NET diagnostic for inspecting the Zoom UI Automation tree. |

## Commands

```bash
pnpm dev          # pnpm -r --parallel dev
pnpm build        # pnpm -r build
pnpm lint         # pnpm -r lint
pnpm test         # pnpm -r test
pnpm test:menu    # interactive dashboard test runner
```

- **Dashboard**: `pnpm --filter dashboard dev` / `dev:https` / `build` / `lint` / `test` (Playwright E2E) / `test:menu`, plus targeted `test:auth`, `test:companies`, `test:calls`, `test:smoke`. Tests documented in `apps/dashboard/tests/README.md`.
- **pocketbase-client**: `build` (tsc), `test` (vitest), `test:connection`.
- **zoomphone-ghl-bridge**: `dev` (tsx watch), `start`, `typecheck`, `test` (node:test).
- **discord-bot**: `dev` (nodemon), `build` (tsc), `start` — no tests/lint.
- **.NET tools** (agent, tool-manager) build via CI `dotnet publish`; not part of pnpm scripts.

## Architecture & Data Flow

- **Dashboard (Vercel)** reads/writes PocketBase directly from the browser (`NEXT_PUBLIC_POCKETBASE_URL`) and hosts server routes under `apps/dashboard/src/app/api/`: GHL OAuth (`hl/oauth/{start,callback}`) + GHL proxy (`ghl/locations/[loc]/*`), email send + tracking pixel/click/unsubscribe/webhook, web-push subscribe + `qstash/push-followup` follow-up scheduling, `zoom/webhook`, `invoice-parse`, `partnerstack/*`.
- **Local CRM Agent** (per-rep desktop) detects Zoom Phone call state, records call audio, and exposes state to the dashboard via a local WebSocket (`WebSocketServer.cs`) and Chrome native messaging (`NativeMessagingHost.cs` — whitelists both dev and release extension ids). Registers in `agent_devices`; uploads recordings; registers a `crm-agent` protocol handler.
- **Chrome extension** scrapes Google Maps → `companies`, enriches/pushes into GoHighLevel, detects Zoom web-phone calls (MAIN-world content scripts); talks to the local agent via native messaging.
- **Bridge** receives Zoom Phone webhooks → mirrors call activity into GHL (refresh-mutex + dead-letter retry); agents ingest recordings via `POST /recordings/ingest` (bearer `AGENT_SHARED_TOKEN`). Public origin `zoomphone.tableturnerr.com`.
- **Cloud relay** (`zoomphone-relay.tableturnerr.com`, Cloudflare Worker + R2) fronts the bridge for max uptime: Zoom's webhook subscription points at the relay, and the agent falls back to it for uploads when the bridge is unreachable. It persists before acking, forwards immediately when home is up, drains buffered items back on a 2-min cron, and keeps nothing after handoff.
- **Discord bot** polls PocketBase for due `follow_ups` → Discord notifications.
- **Telemetry**: bot, bridge, and insta-agent ship structured logs + heartbeats to the ParentSite ingest (`TELEMETRY_URL=https://tableturnerr.com`, per-service `SERVICE_KEY`), surfaced on the ParentSite admin Status/Logs pages.
- Ports: PocketBase `8090`, bridge `8787`, agent = local WebSocket.
- Env var **names** are catalogued in `.env.info.example` (root) and per-tool `.env.example` files.

## Version Bumping & Releases (CRITICAL)

Versions are duplicated across ~9 files and bumped together as a **separate final commit** — `chore(version): bump versions to X.Y (Scraper vA.B)`:

- Root `package.json` (umbrella version)
- `apps/dashboard/package.json`
- `tools/chrome-extension/extension/manifest.json` (drives the `lead-scraper-v*` release tag)
- `tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj` (`<Version>`)
- `tools/tool-manager/src/ToolManager/ToolManager.csproj` (`<Version>`)
- `tools/zoomphone-ghl-bridge`, `tools/discord-bot`, `packages/pocketbase-client`, `packages/telemetry-client` `package.json`s

The `commit-changes` skill automates granular commits + the bump. CI **fails the extension release** if `manifest.json`'s version wasn't incremented.

## Dev/Release Chrome Extension Split

The committed `tools/chrome-extension/extension/manifest.json` is the **dev** build — `(dev)` in name/description + a dev signing `key` → stable dev extension id that coexists with the installed release build. `tools/chrome-extension/apply-release-manifest.ps1` transforms a *staged copy* into the release manifest (strips `(dev)`, swaps in `release.key`); it is shared by `build-release.bat` and CI so they can't drift. Both extension ids are whitelisted in the agent's native-messaging host — see `tools/local-CRM-Agent/NATIVE-MESSAGING.md`.

## CI (`.github/workflows/` — push to `release` branch + manual dispatch)

- `build-chrome-extension.yml` — version guard, dev→release manifest transform, package + verify, publish `lead-scraper-v<ver>`.
- `build-local-agent.yml` — .NET 8 publish; bakes the `AGENT_SHARED_TOKEN` secret into the binary (`-p:AgentDefaultToken`); publishes `local-agent-v<ver>`.
- `build-tool-manager.yml` — .NET 8 publish; publishes `tool-manager-v<ver>`.

**No CI runs lint/tests/typecheck** — verify locally before pushing.

## Skills

- **Commit Changes**: `.claude/skills/commit-changes/SKILL.md` — autonomous granular commits + version bumping.
- **Prompt Optimizer**: `.claude/skills/prompt-optimizer/SKILL.md` — see mandatory section above.
- **Technical Writer**: `.claude/skills/technical-writer/SKILL.md` — documentation guidance.
- **Test and Fix**: `.claude/skills/test-and-fix/SKILL.md` — parallel lint/build/test, fix, re-run until green.

## Known Caveats

- Root `README.md` has drifted: it documents `packages/google-sheets/` and `packages/hubspot/` which no longer exist (google-sheets now lives at `tools/chrome-extension/google-sheets/`), and omits telemetry-client, supabase-client, the bridge, `tools/database`, and zoom-uia-probe.
- `.mcp.json` and `.claude/settings.local.json` contain plaintext tokens (gitignored but sensitive); `.mcp.json`'s filesystem server path points at a stale `C:/Users/Hashaam/...` home directory.
- Rich per-tool docs exist and are trustworthy: `tools/local-CRM-Agent/*.md`, `tools/zoomphone-ghl-bridge/README.md` + `docs/`, `tools/chrome-extension/README.md` + `extension/docs/`.
- Related repos: ParentSite-Tableturnerr (telemetry ingest destination, tableturnerr.com), TT-ChildSite-Wireframe, Al-Baghdadi-Website (client-site template), TT-Leads (lead-gen workspace).
