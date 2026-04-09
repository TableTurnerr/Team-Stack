# CRM-Tableturnerr: Setup & Testing Guide

> Complete guide to set up, test, and deploy the unified CRM ecosystem.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [PocketBase Setup](#2-pocketbase-setup)
3. [Import Schema](#3-import-schema)
4. [Seed Sample Data](#4-seed-sample-data)
5. [Dashboard Setup](#5-dashboard-setup)
6. [Transcriber Setup](#6-transcriber-setup)
7. [Zoom Phone Configuration](#7-zoom-phone-configuration)
   - [7.1 Zoom Phone Webhook Setup (Optional)](#71-zoom-phone-webhook-setup-optional)
8. [Tool Manager Setup (Recommended)](#8-tool-manager-setup-recommended)
9. [Local CRM Agent Setup (Manual)](#9-local-crm-agent-setup-manual--alternative-to-tool-manager)
   - [Optional: Zoom Phone API](#optional-zoom-phone-api-end-call-via-api)
10. [Automated Testing (Playwright)](#10-automated-testing-playwright)
11. [Production Deployment](#11-production-deployment)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

### Required Software
- **Node.js** v18+ (with pnpm)
- **Python** 3.10+
- **PocketBase** (self-hosted binary)
- **Windows 10/11** (for Local CRM Agent — end users only need the distributed exe, no SDK required)

### Verify Installation
```bash
node --version    # Should be v18+
pnpm --version    # Should be v9+
python --version  # Should be 3.10+
```

---

## 2. PocketBase Setup

1. Download the PocketBase binary for your OS (v0.22+ recommended).
2. Extract and run it:
   ```bash
   ./pocketbase serve
   ```
3. Open `http://localhost:8090/_/` in your browser.
4. **Create Admin Account**: Enter an email and password. **Save these credentials** - you'll need them for `.env` files.

---

## 3. Import Schema

The database structure is defined in the shared package.

1. Open PocketBase Admin UI (`http://localhost:8090/_/`).
2. Go to **Settings** → **Import Collections**.
3. Click **Load from JSON file**.
4. Select: `packages/pocketbase-client/pb_db_schema.json`.
5. Click **Review** then **Confirm and import**.

### Verified Collections
You should see 35+ collections including: `users`, `companies`, `cold_calls`, `call_transcripts`, `cold_calling_sessions`, `insta_actors`, `event_logs`, `outreach_logs`, `notes`, `alerts`, `goals`, `rules`, `interactions`, `follow_ups`, `phone_numbers`, `recordings`, `company_notes`, `user_preferences`, `call_logs`, `bank_accounts`, `balance_adjustments`, `fin_categories`, `fin_transactions`, `recurring_transactions`, `email_campaigns`, `email_templates`, `email_lists`, `email_recipients`, `email_sequences`, `email_sequence_steps`, `email_sequence_enrollments`, `email_events`, `email_unsubscribes`.

---

## 4. Seed Sample Data

Populate your local database with realistic dummy data for testing.

### Configure Environment
```bash
cd tools/database
cp .env.example .env
```

Edit `.env` with your local credentials:
```env
POCKETBASE_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@tableturnerr.com
PB_ADMIN_PASSWORD=your_password
```

### Install Dependencies & Run
```bash
pip install -r requirements.txt
python seed_data.py
```

### Expected Output
```
✅ Seeding Complete!
   ✓ Created users
   ✓ Created companies
   ✓ Created cold calls
   ✓ Created transcripts
```

---

## 5. Dashboard Setup

The main web interface for the CRM.

### Install & Configure
```bash
cd apps/dashboard
pnpm install

cp .env.local.example .env.local
```

Edit `.env.local`:
```env
# PocketBase
NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090

# Gemini AI — used for invoice parsing on the financial dashboard (optional)
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash

# Zoom Phone Webhook — receives real-time Zoom call events (optional)
# See Section 7.1 for setup instructions
ZOOM_WEBHOOK_SECRET_TOKEN=your_zoom_webhook_secret

# PocketBase admin — required when ZOOM_WEBHOOK_SECRET_TOKEN is set
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=your_password

# PartnerStack affiliate tracking (optional)
PARTNERSTACK_API_KEY=
```

### Start Development Server
```bash
pnpm dev
```
Access at http://localhost:3000.

---

## 6. Transcriber Setup

The AI service that processes call recordings.

### Install & Configure
```bash
cd tools/transcriber
pip install -r requirements.txt

cp .env.example .env
```

Edit `.env`:
```env
POCKETBASE_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@tableturnerr.com
PB_ADMIN_PASSWORD=your_password
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.0-flash
```

### Get Gemini API Key
Obtain a key from [Google AI Studio](https://makersuite.google.com/app/apikey).

### Test Run
```bash
# Dry run (no DB write)
python transcribe_calls.py test_audio.mp3 --dry-run
```

---

## 7. Zoom Phone Configuration

Configuring the browser-based dialer integration.

### Phone Dialer

The Phone Dialer is a floating panel on the right side of the dashboard. It is always visible during an active call session and can be:
- **Dragged** vertically to reposition (saved to localStorage)
- **Resized** by dragging the bottom edge (height saved to localStorage)
- **Idle state**: shows a custom keypad for dialing
- **Active call**: shows the Zoom Smart Embed iframe for in-call controls

### Settings Location
Access via **Settings → Integrations → Zoom Phone**.

### Available Options
1. **Auto-Dial** (Default: `Off`)
   - When enabled, clicking call buttons dials via the Zoom desktop app (`zoomphonecall:` protocol).
   - When disabled, the number opens in the embedded Smart Embed keypad.
   - **Note**: The Local CRM Agent must be running for the Session page to become active.
2. **Auto-Record Calls** (Default: `On`)
   - Automatically starts/stops the local WASAPI recorder when calls connect/end.
3. **Show Zoom Native Dialer Toggle** (Default: `Off`)
   - Adds a "swap" button in the dialer header to access the standard Zoom Phone interface.

### 7.1 Zoom Phone Webhook Setup (Optional)

The webhook enables real-time call event delivery from Zoom to the dashboard. It's used by the Local CRM Agent to match local calls to Zoom `call_id`s — required for the "End Call via API" feature.

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/) and create a **Server-to-Server OAuth** app.
2. In the app's **Feature** tab, enable **Event Subscriptions**.
3. Add a subscription with endpoint URL: `https://your-domain.com/api/zoom/webhook`
4. Subscribe to events: `phone.callee_ringing`, `phone.callee_answered`, `phone.call_ended`, and `phone.caller_ringing`.
5. Copy the **Secret Token** from the webhook settings.
6. Set it in your dashboard environment:
   ```env
   ZOOM_WEBHOOK_SECRET_TOKEN=your_secret_token
   PB_ADMIN_EMAIL=admin@example.com
   PB_ADMIN_PASSWORD=your_password
   ```
7. Redeploy the dashboard. Zoom will validate the endpoint by sending a `endpoint.url_validation` challenge.

> **Without the webhook**: The dashboard still functions fully. Dialing, recording, and call state detection (via WASAPI) all work. The webhook is only needed if you want the agent to end calls via the Zoom REST API.

---

## 8. Tool Manager Setup (Recommended)

The **TableTurnerr Tool Manager** is a unified installer and auto-updater for all team tools (Local CRM Agent, Lead Scraper, and any future tools). Install it once — it handles everything else automatically.

### For Team Members (End Users)

1. Download the **ToolManager.zip** from the latest [GitHub Release](https://github.com/TableTurnerr/Team-Stack/releases) (tag: `tool-manager-v*`).
2. Extract the zip to any folder.
3. Double-click **`install.bat`**.
4. The Tool Manager opens and shows all available tools — pick which ones to install.
5. After that, the manager runs in the system tray and **auto-updates installed tools** on startup and every hour (with tray notification confirmation).
6. Tools are installed to `%LocalAppData%\TableTurnerr\ToolManager\tools\`.

### What It Manages

| Tool | Type | Auto-Update Behavior |
|------|------|---------------------|
| Local CRM Agent | Windows App | Kills process, replaces exe, relaunches automatically |
| Lead Scraper Extension | Chrome Extension | Silently replaces files (user reloads extension in Chrome) |
| Tool Manager itself | Windows App | Self-updates via tray notification |

### For Developers

**Prerequisites**: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

```bash
cd tools/tool-manager
build-release.bat
# Output: dist/ToolManager.exe + install.bat + uninstall.bat
```

To publish a new tool that the manager auto-discovers: create a GitHub Actions workflow that builds a zip, creates a release tagged `{tool-id}-v{version}`, and includes a `tool.json` manifest in the zip.

---

## 9. Local CRM Agent Setup (Manual — alternative to Tool Manager)

> If you're using the Tool Manager (Section 8), skip this section — the manager handles installation and updates.

The Local CRM Agent is a Windows desktop application that monitors Zoom Phone call state via WASAPI (OS-level audio sessions) and provides reliable call signals to the CRM dashboard.

### For Team Members (End Users)

1. Download the **CRM-Agent.zip** from the latest [GitHub Release](https://github.com/TableTurnerr/Team-Stack/releases) (tag: `local-agent-v*`).
2. Extract the zip to any folder.
3. Double-click **`install.bat`**.
4. The agent installs to `%LocalAppData%\TableTurnerr\LocalCrmAgent\`, registers auto-start on Windows login, and launches immediately.
5. Verify: look for a colored dot in your system tray (bottom-right, near the clock).

### For Developers (Building from Source)

**Prerequisites**: [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)

```bash
cd tools/local-CRM-Agent

# Build self-contained single-file exe (~75MB, no .NET runtime needed)
build-release.bat

# Output: dist/LocalCrmAgent.exe + install.bat + uninstall.bat
```

### How It Integrates with the Dashboard

1. Agent runs a WebSocket server on `ws://127.0.0.1:9876`.
2. Dashboard connects automatically via `LocalAgentProvider` context.
3. On the **Session** page, the agent must show a green checkmark before starting a call session.
4. During calls, if Zoom's iframe fires a false "disconnect" event but the agent confirms the call is still active (via WASAPI audio), the disconnect is suppressed — preventing recording drops.
5. The dialer UI shows agent connection status and a "Click to launch" button if offline.

### Optional: Zoom Phone API (End Call via API)

By default, the agent can detect and dial calls without any Zoom credentials. To also enable **ending calls via the Zoom REST API**, configure a `zoom-api.json` file:

1. Create a **Server-to-Server OAuth** app at [Zoom Marketplace](https://marketplace.zoom.us/).
2. Grant it the `phone:write:call:admin` scope (or `phone:write:call` depending on your plan).
3. Note your **Account ID**, **Client ID**, **Client Secret**, and the Zoom user email you dial from.
4. Create the config file at `%AppData%\CRM Agent\zoom-api.json`:
   ```json
   {
     "accountId": "YOUR_ZOOM_ACCOUNT_ID",
     "clientId": "YOUR_S2S_OAUTH_CLIENT_ID",
     "clientSecret": "YOUR_S2S_OAUTH_CLIENT_SECRET",
     "zoomUserId": "user@yourcompany.com"
   }
   ```
5. Restart the agent. Without valid credentials, the agent still works — only the "End Call via API" feature is unavailable.

> **Template**: A `zoom-api.example.json` is included in the source at `tools/local-CRM-Agent/src/LocalCrmAgent/`.

### Updating

Handled automatically by the Tool Manager. For manual updates: bump the version in `.csproj`, push to the `release` branch, and the GitHub Actions workflow creates a new release. The agent's built-in auto-updater (or the Tool Manager) picks it up within an hour.

> **Detailed docs**: [`tools/local-CRM-Agent/README.md`](tools/local-CRM-Agent/README.md) | [`tools/local-CRM-Agent/SETUP.md`](tools/local-CRM-Agent/SETUP.md)

---

## 10. Automated Testing (Playwright)

The dashboard ships with a full E2E test suite — **127 tests across 12 files**. Run these whenever you make significant changes to verify nothing is broken.

### 11.1 First-Time Setup

```bash
cd apps/dashboard

# Copy and fill in test credentials
cp .env.test.example .env.test

# Install Playwright browser (first time only)
npx playwright install chromium
```

Required values in `.env.test`:

| Variable | Description |
|----------|-------------|
| `TEST_USER_EMAIL` | Dashboard login email |
| `TEST_USER_PASSWORD` | Dashboard login password |
| `TEST_PB_ADMIN_EMAIL` | PocketBase superadmin email |
| `TEST_PB_ADMIN_PASSWORD` | PocketBase superadmin password |
| `TEST_LIVE_CALLS` | Set `true` to enable real call tests (default: `false`) |

### 11.2 Running Tests

#### Interactive CLI Menu (recommended)

The easiest way to run tests is the built-in menu — no need to remember any commands:

```bash
cd apps/dashboard
pnpm test:menu
```

This opens an interactive terminal UI where you can pick test suites, toggle headed mode, view the HTML report, clean up test data, and manage configuration — all from one place.

#### Direct Commands

Make sure **Next.js** (`pnpm dev`) and **PocketBase** are running, then:

```bash
# Full suite
pnpm test

# Smoke tests only — fastest check (~2 min)
pnpm test -- --grep @smoke

# Individual suites
pnpm test:auth        # Login / logout / auth guards
pnpm test:companies   # Companies CRUD + inline edit
pnpm test:calls       # Cold calls + phone numbers tab
pnpm test:notes       # Notes full lifecycle
pnpm test:settings    # All 8 settings sections

# Visual / interactive modes
pnpm test:ui          # Browser UI with live test runner
pnpm test:headed      # Run with visible browser
pnpm test:report      # View last HTML report
```

### 11.3 Test Coverage

| Suite | What's verified |
|-------|----------------|
| Auth | Login, logout, session persistence, invalid credentials, route guards |
| Overview | Stats cards, sidebar nav, all pages load without crash |
| Companies | Search, filter, sort, inline edit, column toggle, detail page |
| Cold Calls | Call log table, tabs, search, outcome filter, phone numbers tab |
| Session | Start/pause/resume/end, metrics, power dialer, recording controls |
| Session Logs | History, status filter, CSV export, admin mode |
| Notes | Create, edit, search, archive, restore, soft-delete |
| Actors / Team / Goals | Table display, column toggle, coming-soon state |
| Recordings | Upload modal, file input, drag-drop zone |
| Settings | Theme, density, timezone, notifications, Zoom integration, admin mode |
| **Integration** | Session→CallLog, CallLog→Recording, Company→CallHistory, Follow-Up linkage |
| **Live Calls** | Real Zoom Phone calls to public test lines (disabled by default) |

### 11.4 Live Call Testing

When `TEST_LIVE_CALLS=true`, the suite dials public telecom test lines to verify the full Zoom Phone → recording → call log pipeline.

The **"Test Numbers"** button inside an active Test Session also uses this pool — it randomly picks 5 numbers each click and copies them in power dialer format (`number,label`).

**Full pool of 9 verified public test lines:**

| Number | Location | Purpose |
|--------|----------|---------|
| 1 (804) 222-1111 | Richmond, VA | All-in-One: echo, DTMF, tone menu (Infotelsystems) |
| 1 (909) 390-0003 | Ontario, CA | Instant audio echo — talk and hear yourself back (Verizon CA) |
| 1 (800) 444-4444 | Toll-Free | Reads back your outbound Caller ID |
| 1 (631) 791-8378 | New York, NY | Audio clarity test (TheTestCall / CallCentric) |
| 1 (206) 456-0649 | Seattle, WA | Echo + hold music (IPKall) |
| 1 (408) 647-4636 | San Jose, CA | Multi-function: echo, DTMF, music on hold, frequency sweep |
| 1 (802) 359-9100 | Vermont | Voice latency echo test (Interpage) |
| 1 (800) 437-7950 | Toll-Free | ANI/Caller ID readback — hear your outbound number (MCI) |
| 1 (925) 259-0082 | East Bay, CA | Audio echo test |

> All numbers are free public telecom test lines with no cost to call. Lines may occasionally go offline — verify before relying on them.

Run with `--headed` to monitor calls visually:
```bash
pnpm test:headed tests/12-live-call-flow.spec.ts
```

> **Full test documentation**: `apps/dashboard/tests/README.md`

### 11.5 Manual Checklist (supplement to automated tests)

- [ ] **Power Dialer**: Paste phone numbers → start → verify sequential dialing → test pause/resume/stop → try negative delay mode
- [ ] **Transcriber**: Place an `.mp3` in `tools/audio-recorder/recordings/` → run `python tools/transcriber/transcribe_calls.py` → verify transcript appears in Dashboard
- [ ] **Google Maps Scraper**: Open extension → scrape a restaurant page → verify company appears in `/companies`
- [ ] **Phone Dialer**: Verify floating panel appears on right side of dashboard → drag to reposition → confirm position is restored after page reload → make a call → confirm Smart Embed iframe appears during call
- [ ] **Local CRM Agent**: Run `install.bat` → verify system tray icon appears → start a call session in dashboard → confirm agent shows green checkmark → place a call → verify tray icon turns green

---

## 11. Production Deployment

Recommended architecture:

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Vercel         │     │  Cloudflare       │     │  Ubuntu Server   │
│  (Dashboard)    │────▶│  Tunnel           │────▶│  (PocketBase)    │
│  app.domain.com │     │  api.domain.com   │     │  localhost:8090  │
└─────────────────┘     └───────────────────┘     └──────────────────┘
```

### 11.1 Ubuntu Server (PocketBase)
1. Install PocketBase on a VPS (DigitalOcean/Hetzner/AWS).
2. Set up a systemd service to keep it running `serve --http="0.0.0.0:8090"`.
3. Use **Cloudflare Tunnel** (`cloudflared`) to expose `localhost:8090` to `https://api.yourdomain.com`. This handles SSL automatically.

### 11.2 Vercel (Dashboard)
1. Connect your GitHub repo to Vercel.
2. Set Root Directory to `apps/dashboard`.
3. Add Environment Variable: `NEXT_PUBLIC_POCKETBASE_URL=https://api.yourdomain.com`.
4. Deploy.

---

## 12. Troubleshooting

### "ClientResponseError 0" (Auto-cancellation)
- **Cause**: React Strict Mode double-invoking effects or rapid navigation cancelling pending requests.
- **Fix**: The dashboard code handles this by ignoring status 0 errors. If seen in console, it's usually harmless.

### "Connection refused"
- **Cause**: PocketBase is not running.
- **Fix**: Ensure `./pocketbase serve` is active.

### "Missing collection"
- **Cause**: Schema not imported.
- **Fix**: Re-run Step 3 (Import Schema).

### Empty Dashboard
- **Cause**: No data.
- **Fix**: Run the seeder script (Step 4).

### "Agent not detected" on Session Page
- **Cause**: Local CRM Agent is not running or WebSocket connection failed.
- **Fix**: Check system tray for the agent icon. If not there, run `install.bat` from the distributed zip or launch manually from `%LocalAppData%\TableTurnerr\LocalCrmAgent\LocalCrmAgent.exe`. If the icon is there but dashboard doesn't connect, try refreshing the browser.

### Recording Drops After 1-2 Seconds
- **Cause**: Network instability causing Zoom iframe to fire false "disconnect" events.
- **Fix**: Ensure the Local CRM Agent is running. The agent uses WASAPI audio monitoring (OS-level, network-independent) to confirm calls are still active and suppress false disconnects.

---
*Last updated: April 2026*