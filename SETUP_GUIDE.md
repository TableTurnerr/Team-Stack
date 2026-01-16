# CRM-Tableturnerr: Setup & Testing Guide

> Complete guide to set up and test the unified CRM after all agents have completed their tasks.

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
- **PocketBase** (self-hosted)

### Verify Installation
```bash
node --version    # Should be v18+
pnpm --version    # Should be v8+
python --version  # Should be 3.10+
```

---

## 2. PocketBase Setup

- Ensure you have admin access to your PocketBase instance
- Default URL: `https://api.yourdomain.com/_/`

### Create Admin Account
1. Go to the PocketBase Admin UI
2. Create your first admin account with email and password
3. **Save these credentials** - you'll need them for the `.env` files

---

## 3. Import Schema

### Step-by-Step
1. Open PocketBase Admin UI (`https://api.yourdomain.com/_/`)
2. Log in with your admin credentials
3. Go to **Settings** → **Import Collections**
4. Click **Load from JSON file**
5. Select: `packages/pocketbase-client/pb_schema.json`
6. Click **Review** then **Confirm and import**

### Verify Collections
After import, you should see these collections:
- `users` (auth collection)
- `companies`
- `leads`
- `cold_calls`
- `call_transcripts`
- `insta_actors`
- `event_logs`
- `outreach_logs`
- `notes`
- `alerts`
- `goals`
- `rules`

---

## 4. Seed Sample Data

### Configure Environment
Create `.env` in `tools/database/`:
```bash
cd tools/database
copy ..\..\.env.example .env
```

Edit `.env` with your credentials:
```env
POCKETBASE_URL=https://api.yourdomain.com
PB_ADMIN_EMAIL=your_admin_email
PB_ADMIN_PASSWORD=your_admin_password
```

### Install Dependencies
```bash
cd tools
pip install httpx python-dotenv
```

### Run Seeder
```bash
python seed_data.py
```

### Expected Output
```
============================================================
CRM-Tableturnerr: Seed Sample Data
============================================================
🔑 Authenticating with PocketBase...
   ✓ Authenticated successfully

👥 Creating users...
   ✓ Created user: Admin User
   ✓ Created user: Sarah Johnson
   ✓ Created user: Mike Chen
   ✓ Created user: Emma Davis

🏢 Creating companies...
   ✓ Created company: Sunrise Restaurant
   ✓ Created company: Golden Gate Bistro
   ...

📞 Creating cold calls and transcripts...
   ✓ Created cold call: +1-310-555-0101 (Interested)
      → Created transcript
   ...

✅ Seeding Complete!
```

### Verify in PocketBase
1. Go to Admin UI → Collections
2. Check `companies` - should have 5 records
3. Check `cold_calls` - should have 4 records
4. Check `call_transcripts` - should have 4 records

---

## 5. Dashboard Setup

### Install Dependencies
```bash
cd apps/dashboard
pnpm install
```

### Configure Environment
Create `.env.local`:
```bash
copy .env.example .env.local
```

Edit with your PocketBase URL:
```env
NEXT_PUBLIC_POCKETBASE_URL=https://api.yourdomain.com
```

### Start Development Server
```bash
pnpm dev
```

### Access Dashboard
Open http://localhost:3000 in your browser.

---

## 6. Transcriber Setup

### Install Dependencies
```bash
cd tools/transcriber
pip install -r requirements.txt
```

### Configure Environment
```bash
copy .env.example .env
```

Edit `.env`:
```env
POCKETBASE_URL=https://api.yourdomain.com
PB_ADMIN_EMAIL=your_admin_email
PB_ADMIN_PASSWORD=your_admin_password
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

### Get Gemini API Key
1. Go to https://makersuite.google.com/app/apikey
2. Create a new API key
3. Add to your `.env` file

### Test Transcriber (Dry Run)
```bash
python transcribe_calls.py test_audio.mp3 --dry-run
```

---

## 7. Testing Checklist

### 7.1 Dashboard Pages

#### Overview Page (/)
- [ ] Stats cards display (Total Companies, Calls, Leads, Team)
- [ ] Recent activity shows events
- [ ] Navigation sidebar works

#### Cold Calls Page (/cold-calls)
- [ ] Table displays seeded calls
- [ ] Click "View" opens detail page
- [ ] Filters work (outcome, interest level)
- [ ] CSV export downloads file
- [ ] Sorting works on all columns

#### Cold Call Detail (/cold-calls/[id])
- [ ] Header shows company info, phone, date
- [ ] AI analysis displays (objections, pain points, follow-ups)
- [ ] Transcript expands/collapses
- [ ] Copy phone button works
- [ ] Company info card links work

#### Companies Page (/companies)
- [ ] All companies display in table
- [ ] Search filters results
- [ ] Inline edit works (click edit, modify, save)
- [ ] "Add Company" modal opens and creates new company
- [ ] Source badges display correctly
- [ ] Click company shows related calls in drawer

#### Leads Page (/leads)
- [ ] Leads display with status badges
- [ ] Filters work
- [ ] Status change dropdown works

#### Notes Page (/notes)
- [ ] Notes list displays
- [ ] Create new note works
- [ ] Archive/delete works
- [ ] Restore from recycle bin works

### 7.2 Transcriber Service

#### Prerequisites
- [ ] Gemini API key configured
- [ ] PocketBase running and accessible
- [ ] Sample audio file ready

#### Test Flow
```bash
cd tools/transcriber

# Test with dry-run (no DB save)
python transcribe_calls.py sample.mp3 --dry-run --json

# Test with DB save
python transcribe_calls.py sample.mp3 --phone "+1-555-0000"
```

#### Verify
- [ ] Script outputs parsed JSON
- [ ] New company created (if phone doesn't exist)
- [ ] New cold_call record in PocketBase
- [ ] New transcript linked to call
- [ ] Appears in Dashboard cold-calls page

### 7.3 Cross-System Integration

- [ ] Transcriber creates records visible in Dashboard
- [ ] Companies page shows all sources (Cold Call, Instagram, Manual)
- [ ] Real-time updates work (may need page refresh)
- [ ] No console errors in browser

---

## 9. Troubleshooting

### "Connection refused" Error
- **Cause**: PocketBase not running
- **Fix**: Start PocketBase server
  ```bash
  pocketbase serve
  ```

### "Missing collection context" Error
- **Cause**: Schema not imported
- **Fix**: Import `pb_schema.json` via Admin UI

### "Authentication failed" Error
- **Cause**: Wrong admin credentials
- **Fix**: Verify email/password in `.env`

### Dashboard shows empty data
- **Cause**: Sample data not seeded
- **Fix**: Run `python tools/database/seed_data.py`

### "Module not found" in Python
- **Cause**: Dependencies not installed
- **Fix**: 
  ```bash
  pip install httpx python-dotenv google-generativeai
  ```

### pnpm command not found
- **Fix**: Install pnpm globally
  ```bash
  npm install -g pnpm
  ```

### Build fails with TypeScript errors
- **Fix**: 
  ```bash
  cd apps/dashboard
  pnpm install
  pnpm build
  ```

---

## Quick Reference

### URLs (Development)
| Service | URL |
|---------|-----|
| PocketBase | http://localhost:8090 |
| PocketBase Admin | http://localhost:8090/_/ |
| Dashboard | http://localhost:3000 |

### URLs (Production)
| Service | URL |
|---------|-----|
| PocketBase API | https://api.yourdomain.com |
| PocketBase Admin | https://api.yourdomain.com/_/ |
| Dashboard | https://app.yourdomain.com |

### Default Test Credentials
| Email | Password | Role |
|-------|----------|------|
| admin@tableturnerr.com | Password123! | Admin |
| sarah@tableturnerr.com | Password123! | Operator |
| mike@tableturnerr.com | Password123! | Operator |

### Key Commands
```bash
# Start Dashboard
cd apps/dashboard && pnpm dev

# Seed Data
cd tools/database && python seed_data.py

# Transcribe Audio
cd tools/transcriber && python transcribe_calls.py <audio.mp3>

# Build Dashboard
cd apps/dashboard && pnpm build
```

---

## 8. Production Deployment

This project uses a split architecture:
- **PocketBase API** → Hosted on your local Ubuntu server, exposed via Cloudflare Tunnel
- **Dashboard** → Hosted on Vercel (external)

```
┌─────────────────┐     ┌───────────────────┐     ┌──────────────────┐
│  Vercel         │     │  Cloudflare       │     │  Ubuntu Server   │
│  (Dashboard)    │────▶│  Tunnel           │────▶│  (PocketBase)    │
│  app.domain.com │     │  api.domain.com   │     │  localhost:8090  │
└─────────────────┘     └───────────────────┘     └──────────────────┘
```

### 8.1 Prerequisites (Ubuntu Server)

Update your system and install basic tools:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y unzip curl git python3-pip
```

### 8.2 PocketBase Setup (Ubuntu)

1. **Download PocketBase:**
   ```bash
   wget https://github.com/pocketbase/pocketbase/releases/download/v0.23.0/pocketbase_0.23.0_linux_amd64.zip
   unzip pocketbase_*.zip -d pocketbase
   cd pocketbase
   ```

2. **Run manually first** to create the initial admin account:
   ```bash
   ./pocketbase serve --http="0.0.0.0:8090"
   ```
   Visit `http://<server-ip>:8090/_/` to create your admin account.

3. **Create systemd service** for auto-start:
   ```bash
   sudo nano /etc/systemd/system/pocketbase.service
   ```

   Add:
   ```ini
   [Unit]
   Description=PocketBase CRM
   After=network.target

   [Service]
   Type=simple
   User=<your-username>
   WorkingDirectory=/home/<your-username>/pocketbase
   ExecStart=/home/<your-username>/pocketbase/pocketbase serve --http=0.0.0.0:8090
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
   ```

4. **Enable and start service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable pocketbase
   sudo systemctl start pocketbase
   sudo systemctl status pocketbase
   ```

### 8.3 Cloudflare Tunnel (PocketBase API)

Expose your local PocketBase to the internet without port forwarding.

1. **Install cloudflared:**
   ```bash
   curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
   sudo dpkg -i cloudflared.deb
   ```

2. **Login & Create Tunnel:**
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create crm-api
   ```

3. **Configure Tunnel** (`~/.cloudflared/config.yml`):
   ```yaml
   tunnel: <Tunnel-UUID>
   credentials-file: /home/<user>/.cloudflared/<Tunnel-UUID>.json

   ingress:
     # PocketBase API and Admin UI
     - hostname: api.yourdomain.com
       service: http://localhost:8090
     - service: http_status:404
   ```

4. **Route DNS:**
   ```bash
   cloudflared tunnel route dns crm-api api.yourdomain.com
   ```

5. **Install as service:**
   ```bash
   sudo cloudflared service install
   sudo systemctl start cloudflared
   sudo systemctl enable cloudflared
   ```

6. **Verify:** Visit `https://api.yourdomain.com/_/` to access PocketBase Admin.

### 8.4 Dashboard Deployment (Vercel)

The dashboard is a Next.js app deployed to Vercel.

1. **Push code to GitHub** (if not already).

2. **Import to Vercel:**
   - Go to [vercel.com](https://vercel.com) and sign in
   - Click "Add New Project"
   - Import your GitHub repository
   - Set **Root Directory** to `apps/dashboard`

3. **Configure Environment Variables** in Vercel:
   ```
   NEXT_PUBLIC_POCKETBASE_URL=https://api.yourdomain.com
   ```

4. **Configure Custom Domain:**
   - In Vercel project → Settings → Domains
   - Add `app.yourdomain.com` (or your preferred subdomain)

5. **Update Cloudflare DNS:**
   In Cloudflare DNS, add a CNAME record:
   ```
   Type: CNAME
   Name: app
   Target: cname.vercel-dns.com
   Proxy: DNS only (gray cloud recommended for Vercel)
   ```

6. **Deploy:** Vercel auto-deploys on every push to `main`.

### 8.5 Domain Summary

| Service | Subdomain | Hosted On |
|---------|-----------|-----------|
| PocketBase API | `api.yourdomain.com` | Ubuntu (via Cloudflare Tunnel) |
| PocketBase Admin | `api.yourdomain.com/_/` | Ubuntu (via Cloudflare Tunnel) |
| Dashboard | `app.yourdomain.com` | Vercel |

### 8.6 CORS Notes

PocketBase v0.20+ handles CORS automatically for all origins. If you need to restrict origins, you can configure it in PocketBase settings or via command line:
```bash
./pocketbase serve --origins="https://app.yourdomain.com,https://localhost:3000"
```

---

## Next Steps

After completing setup and testing:

1. **Production Deployment**: Set up proper domain and SSL
2. **User Management**: Create real user accounts in PocketBase
3. **Audio Recorder**: Set up the desktop audio recorder (apps/audio-recorder)
4. **Instagram Agent**: Configure the Instagram outreach agent

---

*Last updated: January 2026*
