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
8. [Automated Testing (Playwright)](#8-automated-testing-playwright)
9. [Production Deployment](#9-production-deployment)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Prerequisites

### Required Software
- **Node.js** v18+ (with pnpm)
- **Python** 3.10+
- **PocketBase** (self-hosted binary)

### Verify Installation
```bash
node --version    # Should be v18+
pnpm --version    # Should be v8+
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
4. Select: `packages/pocketbase-client/pb_schema.json`.
   *(Note: If this file is missing, check `packages/pocketbase-client/pb_db_schema.json`)*
5. Click **Review** then **Confirm and import**.

### Verified Collections
You should see: `users`, `companies`, `leads`, `cold_calls`, `call_transcripts`, `insta_actors`, `event_logs`, `outreach_logs`, `notes`, `alerts`, `goals`, `rules`.

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

cp .env.example .env.local
```

Edit `.env.local`:
```env
NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090
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

### Settings Location
Access via **Settings → Integrations → Zoom Phone**.

### Available Options
1. **Auto-Dial** (Default: `Off`)
   - When enabled, clicking phone buttons routes calls through the Zoom desktop app.
   - **Note**: "Active Call Session" requires screen sharing to be started manually.
   - When disabled, numbers populate in the web-based custom dialer.
2. **Auto-Record Calls** (Default: `On`)
   - Automatically starts/stops recording when calls connect/end.
3. **Show Zoom Native Dialer Toggle** (Default: `Off`)
   - Adds a "swap" button to the dialer header to access the standard Zoom dialer interface.

---

## 8. Automated Testing (Playwright)

The dashboard ships with a full E2E test suite — **127 tests across 12 files**. Run these whenever you make significant changes to verify nothing is broken.

### 8.1 First-Time Setup

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

### 8.2 Running Tests

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

### 8.3 Test Coverage

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

### 8.4 Live Call Testing

When `TEST_LIVE_CALLS=true`, the suite dials **5 public telecom test lines** to verify the full Zoom Phone → recording → call log pipeline:

| Number | Location | Purpose |
|--------|----------|---------|
| 1 (804) 222-1111 | Richmond, VA | All-in-One: echo, DTMF, tone menu |
| 1 (909) 390-0003 | Ontario, CA | Instant audio echo (latency test) |
| 1 (800) 444-4444 | Toll-Free | Reads back your outbound Caller ID |
| 1 (631) 791-8378 | New York, NY | Audio clarity test (CallCentric) |
| 1 (206) 456-0649 | Seattle, WA | Echo + hold music (IPKall) |

Run with `--headed` to monitor calls visually:
```bash
pnpm test:headed tests/12-live-call-flow.spec.ts
```

> **Full test documentation**: `apps/dashboard/tests/README.md`

### 8.5 Manual Checklist (supplement to automated tests)

- [ ] **Power Dialer**: Paste phone numbers → start → verify sequential dialing → test pause/resume/stop → try negative delay mode
- [ ] **Transcriber**: Place an `.mp3` in `tools/audio-recorder/recordings/` → run `python tools/transcriber/transcribe_calls.py` → verify transcript appears in Dashboard
- [ ] **Google Maps Scraper**: Open extension → scrape a restaurant page → verify company appears in `/companies`

---

## 9. Production Deployment

Recommended architecture:

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Vercel         │     │  Cloudflare       │     │  Ubuntu Server   │
│  (Dashboard)    │────▶│  Tunnel           │────▶│  (PocketBase)    │
│  app.domain.com │     │  api.domain.com   │     │  localhost:8090  │
└─────────────────┘     └───────────────────┘     └──────────────────┘
```

### 9.1 Ubuntu Server (PocketBase)
1. Install PocketBase on a VPS (DigitalOcean/Hetzner/AWS).
2. Set up a systemd service to keep it running `serve --http="0.0.0.0:8090"`.
3. Use **Cloudflare Tunnel** (`cloudflared`) to expose `localhost:8090` to `https://api.yourdomain.com`. This handles SSL automatically.

### 9.2 Vercel (Dashboard)
1. Connect your GitHub repo to Vercel.
2. Set Root Directory to `apps/dashboard`.
3. Add Environment Variable: `NEXT_PUBLIC_POCKETBASE_URL=https://api.yourdomain.com`.
4. Deploy.

---

## 10. Troubleshooting

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

---
*Last updated: February 2026*