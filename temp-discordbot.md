You are building a **Discord bot** for the Tableturnerr CRM. This is a standalone Node.js service in its own repo. It connects to PocketBase (the CRM's database) and sends Discord DMs to team members for CRM events like follow-up reminders and overdue alerts. Users can be @mentioned because they link their Discord User ID inside the CRM.

---

## What to build

A persistent background worker that:
1. Authenticates with PocketBase using admin credentials
2. Runs cron jobs to poll for CRM events (follow-ups due, overdue)
3. For each event, looks up the assigned user's `discord_user_id` in PocketBase
4. Respects the user's notification preferences (toggle + DND hours) stored in PocketBase
5. Sends a formatted Discord DM embed to that user

---

## Tech stack

- **Runtime**: Node.js 18+ with TypeScript
- **Discord**: `discord.js` v14
- **PocketBase**: `pocketbase` npm package
- **Scheduler**: `node-cron`
- **Config**: `dotenv`

```bash
npm init -y
npm install discord.js pocketbase node-cron dotenv
npm install -D typescript @types/node ts-node nodemon
```

---

## Repo structure to create

```
discord-bot/
  src/
    index.ts                  # Entry — boots Discord client + starts scheduler
    pb.ts                     # PocketBase client singleton + admin auth helper
    scheduler.ts              # Registers all cron jobs
    notifications/
      follow-ups.ts           # Follow-up due + overdue logic
    embeds/
      follow-up.ts            # Discord EmbedBuilder helpers
    utils/
      dnd.ts                  # DND window check
      send-dm.ts              # Fetch Discord user + send DM
  .env.example
  package.json
  tsconfig.json
```

---

## Environment variables (create `.env.example`)

```env
DISCORD_BOT_TOKEN=           # From Discord Developer Portal → Bot tab
POCKETBASE_URL=              # e.g. https://your-pb-instance.com
POCKETBASE_ADMIN_EMAIL=      # PocketBase admin email
POCKETBASE_ADMIN_PASSWORD=   # PocketBase admin password
POLL_INTERVAL_MINUTES=5      # Cron interval for follow-up checks (default 5)
CRM_BASE_URL=                # e.g. https://crm.tableturnerr.com (for "Open in CRM" links)
```

---

## PocketBase collections the bot reads/writes

### `users` collection
| Field | Type | Notes |
|---|---|---|
| `id` | text | PB record ID |
| `name` | text | Display name |
| `discord_user_id` | text (numeric) | Discord snowflake ID — set by user in CRM settings |

### `user_preferences` collection
| Field | Type | Notes |
|---|---|---|
| `user` | relation → users | One-to-one |
| `notification_settings` | json | See structure below |

`notification_settings` JSON shape:
```typescript
{
  follow_up_reminders?: boolean;  // default true — send DM for due follow-ups
  dnd_enabled?: boolean;          // default false
  dnd_start?: string;             // "HH:MM" e.g. "22:00"
  dnd_end?: string;               // "HH:MM" e.g. "08:00"
}
```

### `follow_ups` collection
| Field | Type | Notes |
|---|---|---|
| `id` | text | PB record ID |
| `assigned_to` | relation → users | The user responsible |
| `company` | relation → companies | Expand to get `company_name` |
| `scheduled_time` | date | ISO string |
| `status` | select | `pending`, `completed`, `cancelled` |
| `notes` | text | Optional |
| `reminder_sent` | bool | **Bot sets this to true after sending reminder DM** |
| `overdue_notified` | bool | **Bot sets this to true after sending overdue DM** |

> The `reminder_sent` and `overdue_notified` fields need to be added to the CRM's PocketBase schema. Add them as bool fields on the `follow_ups` collection.

### `companies` collection (expand only)
| Field | Type |
|---|---|
| `company_name` | text |

---

## Implementation details

### `src/pb.ts`
- Create a PocketBase client pointed at `POCKETBASE_URL`
- Export an `authAdmin()` function that authenticates using admin credentials
- Call `authAdmin()` on startup and re-auth if the token expires (wrap API calls in a try/catch that re-auths on 401)

### `src/index.ts`
- Create a `discord.js` `Client` with intents: `GatewayIntentBits.Guilds`, `GatewayIntentBits.DirectMessages`
- Log in using `DISCORD_BOT_TOKEN`
- On `client.once('ready')`, call `authAdmin()` then start the scheduler
- Handle process signals for graceful shutdown

### `src/scheduler.ts`
- Export a `startScheduler(client)` function
- Register two cron jobs:
  1. Every `POLL_INTERVAL_MINUTES` minutes → `checkDueFollowUps(client)`
  2. Every 30 minutes → `checkOverdueFollowUps(client)`

### `src/notifications/follow-ups.ts`

**`checkDueFollowUps(client)`**
```
- Define a window: now - POLL_INTERVAL_MINUTES to now + POLL_INTERVAL_MINUTES
- Query PocketBase:
    follow_ups where:
      status = "pending"
      AND reminder_sent = false
      AND scheduled_time >= windowStart
      AND scheduled_time <= windowEnd
    expand: assigned_to, company
- For each record:
    1. Get user = record.expand.assigned_to
    2. Skip if user.discord_user_id is empty
    3. Load user_preferences for that user
    4. Skip if follow_up_reminders === false
    5. Skip if isInDND(prefs)
    6. Send DM with buildFollowUpEmbed(record, false)
    7. Update record: { reminder_sent: true }
```

**`checkOverdueFollowUps(client)`**
```
- Query PocketBase:
    follow_ups where:
      status = "pending"
      AND overdue_notified = false
      AND scheduled_time < now
    expand: assigned_to, company
- For each record:
    1-5. Same user lookup + preference + DND checks as above
    6. Send DM with buildFollowUpEmbed(record, true)
    7. Update record: { overdue_notified: true }
```

### `src/utils/dnd.ts`

```typescript
export function isInDND(prefs: { dnd_enabled?: boolean; dnd_start?: string; dnd_end?: string }): boolean {
  if (!prefs.dnd_enabled) return false;
  const now = new Date();
  const [startH, startM] = (prefs.dnd_start || '22:00').split(':').map(Number);
  const [endH, endM] = (prefs.dnd_end || '08:00').split(':').map(Number);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const startMins = startH * 60 + startM;
  const endMins = endH * 60 + endM;
  // Handle window that crosses midnight
  if (startMins < endMins) return nowMins >= startMins && nowMins < endMins;
  return nowMins >= startMins || nowMins < endMins;
}
```

### `src/utils/send-dm.ts`

```typescript
export async function sendDM(client: Client, discordUserId: string, embed: EmbedBuilder): Promise<void> {
  const user = await client.users.fetch(discordUserId);
  const dm = await user.createDM();
  await dm.send({ embeds: [embed] });
}
```

Handle errors gracefully — if a DM fails (user has DMs closed), log it and continue without crashing.

### `src/embeds/follow-up.ts`

Build a `discord.js` `EmbedBuilder` for follow-up notifications:

**Due reminder** (blue/blurple `#5865F2`):
- Title: `🔔 Follow-up Reminder`
- Description: `You have a follow-up with **{company_name}** due now.`
- Fields: Company, Scheduled time (formatted), Notes (if present), Open in CRM link

**Overdue** (yellow `#FEE75C`):
- Title: `⚠️ Overdue Follow-up`
- Description: `Your follow-up with **{company_name}** is overdue.`
- Same fields

Footer: `Tableturnerr CRM` · Timestamp: `new Date()`

---

## Important notes

- **DM restriction**: A Discord bot can only DM a user if they share a server with the bot. The team must invite the bot to their Discord server.
- **Error handling**: Wrap every PocketBase call and every Discord DM in try/catch. A single failure should not stop the cron job from processing other records.
- **No web server needed**: This is a pure background worker. No Express, no HTTP endpoints.
- **Token refresh**: PocketBase admin tokens last 7 days. Re-authenticate proactively or on 401 errors.

---

## Discord Developer Portal setup (do this manually before running)

1. Go to discord.com/developers/applications → New Application → name it "Tableturnerr CRM"
2. Bot tab → Add Bot → copy the Token into `.env`
3. Privileged Gateway Intents → enable **Server Members Intent**
4. OAuth2 → URL Generator → Scopes: `bot` → Permissions: `Send Messages` → copy invite URL → invite to team server
5. Users get their Discord User ID by: Discord Settings → Advanced → Developer Mode ON → right-click own username → Copy User ID → paste into CRM Settings → Account → Discord Account

---

## Future feature to stub out (don't build yet, just leave a `TODO`)

An `alerts` collection in PocketBase where CRM users can create manual alerts targeting a teammate. The bot polls this collection and DMs the `target_user`. Stub the file `src/notifications/alerts.ts` with a `TODO` comment describing this.
