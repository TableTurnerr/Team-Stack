# Tableturnerr Discord Bot

A persistent background worker that sends Discord DMs to CRM team members for follow-up reminders and overdue alerts. Connects directly to the Tableturnerr PocketBase instance — no web server required.

Part of the [CRM-Tableturnerr monorepo](../../README.md).

---

## How it works

1. On startup, authenticates with PocketBase as an admin
2. Runs cron jobs to poll the `follow_ups` collection
3. For each event, looks up the assigned user's Discord ID in PocketBase
4. Checks the user's notification preferences and DND window
5. Sends a formatted embed DM via Discord

---

## Prerequisites

- Node.js 18+
- pnpm 9+ (monorepo package manager)
- A PocketBase instance running the Tableturnerr CRM
- A Discord bot token (see [Discord setup](#discord-setup) below)

---

## Installation

```bash
# From the monorepo root
pnpm install

# Or install just this tool's dependencies
cd tools/discord-bot
pnpm install
```

---

## Environment variables

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token from Discord Developer Portal → Bot tab |
| `POCKETBASE_URL` | Your PocketBase instance URL (e.g. `https://your-pb.com`) |
| `POCKETBASE_ADMIN_EMAIL` | PocketBase admin email |
| `POCKETBASE_ADMIN_PASSWORD` | PocketBase admin password |
| `POLL_INTERVAL_MINUTES` | How often to check for due follow-ups (default: `5`) |
| `CRM_BASE_URL` | Your CRM's public URL — used for "Open in CRM" embed links |

---

## PocketBase schema changes required

Before running the bot, add two bool fields to the **`follow_ups`** collection in PocketBase:

| Field | Type | Default |
|---|---|---|
| `reminder_sent` | bool | `false` |
| `overdue_notified` | bool | `false` |

The bot sets these to `true` after notifying so users are never notified twice.

> **Schema location**: `packages/pocketbase-client/pb_db_schema.json` (source of truth for all DB changes)

---

## Discord setup

### 1. Create the bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Click **New Application** → name it `Tableturnerr CRM`
3. Go to the **Bot** tab → click **Add Bot**
4. Copy the **Token** → paste it into `.env` as `DISCORD_BOT_TOKEN`
5. Under **Privileged Gateway Intents**, enable **Server Members Intent**

### 2. Invite the bot to your team server

1. Go to **OAuth2 → URL Generator**
2. Scopes: `bot`
3. Bot Permissions: `Send Messages`
4. Copy the generated URL → open it in a browser → invite to your team's Discord server

> **Important:** The bot can only DM a user if they share a server with it. Every team member must be in the server the bot was invited to.

### 3. Team members: link your Discord ID

1. In Discord: **Settings → Advanced → Developer Mode** → toggle ON
2. Right-click your username → **Copy User ID**
3. In the CRM: **Settings → Account → Discord Account** → paste the ID

---

## Running

```bash
# Development (hot-reload via nodemon)
pnpm dev

# Production build
pnpm build
pnpm start
```

---

## Project structure

```
tools/discord-bot/
  src/
    index.ts                  # Entry — boots Discord client, auths PB, starts scheduler
    pb.ts                     # PocketBase singleton + admin auth + 401 retry wrapper
    scheduler.ts              # Registers all cron jobs
    notifications/
      follow-ups.ts           # Due and overdue follow-up polling logic
      alerts.ts               # TODO — manual CRM alerts to teammates
    embeds/
      follow-up.ts            # Discord EmbedBuilder for follow-up notifications
    utils/
      dnd.ts                  # DND window check (handles cross-midnight ranges)
      send-dm.ts              # Fetch Discord user + send embed DM
  .env.example
  package.json
  tsconfig.json
```

---

## Notification behaviour

### Follow-up reminder (blue embed)
Sent when a follow-up's `scheduled_time` falls within the current poll window and `reminder_sent` is `false`.

### Overdue alert (yellow embed)
Sent when a follow-up's `scheduled_time` is in the past, status is still `pending`, and `overdue_notified` is `false`. Runs every 30 minutes.

### User preferences
Each user can control their notifications from CRM settings. The bot respects:

| Setting | Default | Effect |
|---|---|---|
| `follow_up_reminders` | `true` | Toggle all follow-up DMs on/off |
| `dnd_enabled` | `false` | Enable a quiet hours window |
| `dnd_start` | `"22:00"` | Start of DND window (HH:MM) |
| `dnd_end` | `"08:00"` | End of DND window (HH:MM) |

DND windows that cross midnight (e.g. 22:00 → 08:00) are handled correctly.

---

## Error handling

- Every PocketBase call is wrapped in a `withAuth()` helper that re-authenticates on 401 and retries once
- Every DM attempt is wrapped in try/catch — if a user has DMs closed or doesn't share a server with the bot, the error is logged and the job continues processing other records
- A failure on one record never stops the rest of the batch
