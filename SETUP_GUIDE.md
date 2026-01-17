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
7. [Testing Checklist](#7-testing-checklist)
8. [Production Deployment](#8-production-deployment)
9. [Troubleshooting](#9-troubleshooting)

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
   *(Note: If this file is missing, check `packages/pocketbase-client/pb_schema_exported.json`)*
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

## 7. Testing Checklist

Use this checklist to verify system health.

### 7.1 Dashboard Pages
- [ ] **Overview**: Stats cards load without error. Recent activity list is populated.
- [ ] **Cold Calls**: Table displays seeded calls. Detail view shows transcript and AI summary.
- [ ] **Companies**: Can add a new company. Inline editing works.
- [ ] **Leads**: Filters (status, source) function correctly.
- [ ] **Team**: Team members list loads.
- [ ] **Notes**: Can create and edit a markdown note.

### 7.2 Transcriber Integration
1. Place a test `.mp3` or `.wav` file in `tools/audio-recorder/recordings/`.
2. Run the transcriber: `python tools/transcriber/transcribe_calls.py`
3. Verify a new `Cold Call` record appears in the Dashboard with the transcript.

---

## 8. Production Deployment

Recommended architecture:

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Vercel         │     │  Cloudflare       │     │  Ubuntu Server   │
│  (Dashboard)    │────▶│  Tunnel           │────▶│  (PocketBase)    │
│  app.domain.com │     │  api.domain.com   │     │  localhost:8090  │
└─────────────────┘     └───────────────────┘     └──────────────────┘
```

### 8.1 Ubuntu Server (PocketBase)
1. Install PocketBase on a VPS (DigitalOcean/Hetzner/AWS).
2. Set up a systemd service to keep it running `serve --http="0.0.0.0:8090"`.
3. Use **Cloudflare Tunnel** (`cloudflared`) to expose `localhost:8090` to `https://api.yourdomain.com`. This handles SSL automatically.

### 8.2 Vercel (Dashboard)
1. Connect your GitHub repo to Vercel.
2. Set Root Directory to `apps/dashboard`.
3. Add Environment Variable: `NEXT_PUBLIC_POCKETBASE_URL=https://api.yourdomain.com`.
4. Deploy.

---

## 9. Troubleshooting

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
*Last updated: January 2026*