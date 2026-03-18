# PocketBase to Supabase Migration Guide

**Project:** CRM-Tableturnerr
**Date:** 2026-03-18
**Current Stack:** PocketBase (SQLite) + Next.js 15 + Python agents
**Target Stack:** Self-Hosted Supabase (PostgreSQL) on Hostinger VPS + Next.js 15 + Python agents

---

## Table of Contents

1. [Migration Overview](#1-migration-overview)
2. [Pre-Migration Checklist](#2-pre-migration-checklist)
3. [Supabase Project Setup](#3-supabase-project-setup)
4. [Database Schema Migration](#4-database-schema-migration)
5. [Row-Level Security (RLS) Policies](#5-row-level-security-rls-policies)
6. [Authentication Migration](#6-authentication-migration)
7. [Data Migration (Export & Import)](#7-data-migration-export--import)
8. [File Storage Migration](#8-file-storage-migration)
9. [Realtime Subscriptions Migration](#9-realtime-subscriptions-migration)
10. [TypeScript Client Migration](#10-typescript-client-migration)
11. [Python Client Migration](#11-python-client-migration)
12. [API Routes Migration](#12-api-routes-migration)
13. [Environment Variables Update](#13-environment-variables-update)
14. [Testing & Validation](#14-testing--validation)
15. [Cutover Plan](#15-cutover-plan)
16. [Rollback Plan](#16-rollback-plan)

---

## 1. Migration Overview

### What Changes

| Aspect | PocketBase | Supabase |
|--------|-----------|----------|
| Database | SQLite | PostgreSQL |
| Auth | PocketBase Auth (JWT + authStore) | Supabase Auth (GoTrue) |
| Realtime | PocketBase WebSocket subscriptions | Supabase Realtime (Postgres Changes) |
| File Storage | PocketBase file fields | Supabase Storage (local or S3-compatible) |
| Hosting | Local/VPS | Self-hosted on Hostinger VPS (Docker) |
| Client SDK | `pocketbase` npm package | `@supabase/supabase-js` npm package |
| Python Client | Custom HTTP wrapper (`httpx`) | `supabase-py` package |
| Access Control | PocketBase collection rules | PostgreSQL Row-Level Security (RLS) |
| IDs | 15-char alphanumeric (`[a-z0-9]{15}`) | UUID v4 (default) or custom |
| Filtering | PocketBase filter syntax (`field = "value"`) | PostgREST syntax (`.eq('field', 'value')`) |

### Scope

- **35 collections** to migrate (30 custom + 5 system)
- **2 auth collections** (users + superusers)
- **File fields:** user avatars, recording files, receipt files
- **Relations:** 40+ foreign key relationships
- **Realtime:** 3 subscription contexts (team presence, sessions, cold calling)
- **Clients to update:** TypeScript SDK (dashboard), Python SDK (insta-outreach-agent), API routes

---

## 2. Pre-Migration Checklist

### 2.1. Inventory Current State

- [ ] Export full PocketBase database backup (`pb_data/` directory)
- [ ] Document all current PocketBase collection rules
- [ ] Count records per collection (for validation after migration)
- [ ] List all files stored in PocketBase (avatars, recordings, receipts)
- [ ] Note all environment variables currently in use
- [ ] Identify all cron jobs or background tasks hitting PocketBase

### 2.2. Set Up Development Environment

- [ ] Ensure your Hostinger VPS meets requirements (see Section 3)
- [ ] Install Supabase CLI locally: `npm install -g supabase`
- [ ] SSH access to your Hostinger VPS configured
- [ ] Domain/subdomain ready for Supabase (e.g., `supabase.yourdomain.com`)
- [ ] Install new dependencies:
  ```bash
  # Dashboard (TypeScript)
  cd apps/dashboard
  pnpm add @supabase/supabase-js @supabase/ssr

  # Shared package
  cd packages/pocketbase-client  # (will rename later)
  pnpm add @supabase/supabase-js

  # Python agent
  cd apps/insta-outreach-agent
  pip install supabase
  ```

### 2.3. Decision: ID Strategy

PocketBase uses 15-character alphanumeric IDs. You have two options:

**Option A: Keep existing IDs (recommended for data preservation)**
- Use `text` primary keys in Supabase instead of `uuid`
- All existing relations and frontend references remain valid
- Add a CHECK constraint: `id ~ '^[a-z0-9]{15}$'`

**Option B: Switch to UUIDs**
- More PostgreSQL-native
- Requires building an ID mapping table for every record
- All relations must be remapped
- Frontend code referencing IDs by value will break

**Recommendation:** Use Option A for the initial migration. You can migrate to UUIDs later.

---

## 3. Supabase Project Setup (Self-Hosted on Hostinger VPS)

### 3.1. VPS Requirements

Your Hostinger VPS should have:
- **OS:** Ubuntu 22.04 LTS (recommended) or Debian 11+
- **RAM:** Minimum 4GB, recommended 8GB+
- **Storage:** Minimum 50GB SSD
- **CPU:** 2+ vCPUs
- **Ports:** 80, 443, 5432 (PostgreSQL), 8000 (Kong API Gateway)

### 3.2. Install Docker & Docker Compose

SSH into your Hostinger VPS and run:

```bash
# Update packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Add your user to docker group (logout/login after)
sudo usermod -aG docker $USER

# Verify installation
docker --version
docker compose version
```

### 3.3. Clone Supabase Self-Hosted Repository

```bash
# Create directory for Supabase
mkdir -p /opt/supabase
cd /opt/supabase

# Clone the official self-hosting repo
git clone --depth 1 https://github.com/supabase/supabase.git
cd supabase/docker

# Copy the example env file
cp .env.example .env
```

### 3.4. Generate Secure Secrets

Generate all required secrets:

```bash
# Generate JWT secret (save this!)
openssl rand -base64 32

# Generate anon key and service role key using the JWT secret
# Use the Supabase JWT generator or generate manually:
# https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys
```

Or use this Node.js script to generate keys:

```javascript
// generate-keys.js
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const jwtSecret = crypto.randomBytes(32).toString('base64');

const anonPayload = {
  role: 'anon',
  iss: 'supabase',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60), // 10 years
};

const servicePayload = {
  role: 'service_role',
  iss: 'supabase',
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (10 * 365 * 24 * 60 * 60), // 10 years
};

console.log('JWT_SECRET:', jwtSecret);
console.log('ANON_KEY:', jwt.sign(anonPayload, jwtSecret));
console.log('SERVICE_ROLE_KEY:', jwt.sign(servicePayload, jwtSecret));
```

### 3.5. Configure Environment Variables

Edit `/opt/supabase/supabase/docker/.env`:

```bash
############
# Secrets - GENERATE NEW VALUES, DO NOT USE DEFAULTS
############

# Your VPS IP or domain (e.g., supabase.yourdomain.com)
SUPABASE_PUBLIC_URL=https://supabase.yourdomain.com

# PostgreSQL password (generate a strong one)
POSTGRES_PASSWORD=your-super-secure-postgres-password

# JWT secret (from step 3.4)
JWT_SECRET=your-generated-jwt-secret

# API Keys (from step 3.4)
ANON_KEY=your-generated-anon-key
SERVICE_ROLE_KEY=your-generated-service-role-key

# Dashboard credentials
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD=your-dashboard-password

############
# Database
############
POSTGRES_HOST=db
POSTGRES_DB=postgres
POSTGRES_PORT=5432

############
# API Configuration
############
PGRST_DB_SCHEMAS=public,storage,graphql_public

############
# Auth Configuration (GoTrue)
############
GOTRUE_SITE_URL=https://your-dashboard-app.com
GOTRUE_URI_ALLOW_LIST=https://your-dashboard-app.com/*
GOTRUE_DISABLE_SIGNUP=false

# JWT expiry (7 days = 604800 seconds)
GOTRUE_JWT_EXP=604800

# Email settings (use your SMTP provider)
GOTRUE_SMTP_HOST=smtp.your-email-provider.com
GOTRUE_SMTP_PORT=587
GOTRUE_SMTP_USER=your-smtp-username
GOTRUE_SMTP_PASS=your-smtp-password
GOTRUE_SMTP_ADMIN_EMAIL=noreply@yourdomain.com
GOTRUE_SMTP_SENDER_NAME=CRM Tableturnerr

# Google OAuth (optional, configure later if needed)
GOTRUE_EXTERNAL_GOOGLE_ENABLED=false
# GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=
# GOTRUE_EXTERNAL_GOOGLE_SECRET=
# GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://supabase.yourdomain.com/auth/v1/callback

############
# Studio (Dashboard)
############
STUDIO_DEFAULT_ORGANIZATION=CRM Tableturnerr
STUDIO_DEFAULT_PROJECT=CRM

############
# Storage
############
STORAGE_BACKEND=file
# For S3-compatible storage (optional):
# STORAGE_BACKEND=s3
# STORAGE_S3_BUCKET=your-bucket-name
# STORAGE_S3_ENDPOINT=https://s3.your-region.amazonaws.com
# STORAGE_S3_REGION=your-region
# AWS_ACCESS_KEY_ID=your-access-key
# AWS_SECRET_ACCESS_KEY=your-secret-key

############
# Logging
############
LOGFLARE_LOGGER_BACKEND_API_KEY=your-logflare-key  # Optional, can be empty

############
# Other
############
ENABLE_PHONE_SIGNUP=false
ENABLE_PHONE_AUTOCONFIRM=false
```

### 3.6. Set Up Reverse Proxy (Nginx + SSL)

Install Nginx and Certbot:

```bash
sudo apt install nginx certbot python3-certbot-nginx -y
```

Create Nginx config at `/etc/nginx/sites-available/supabase`:

```nginx
# /etc/nginx/sites-available/supabase

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name supabase.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

# Main Supabase proxy
server {
    listen 443 ssl http2;
    server_name supabase.yourdomain.com;

    # SSL certificates (will be created by certbot)
    ssl_certificate /etc/letsencrypt/live/supabase.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/supabase.yourdomain.com/privkey.pem;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    # Proxy settings
    client_max_body_size 100M;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Kong API Gateway (main entry point)
    location / {
        proxy_pass http://localhost:8000;
    }

    # Supabase Studio (Dashboard)
    location /project/ {
        proxy_pass http://localhost:3000;
    }
}
```

Enable the site and get SSL certificate:

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/supabase /etc/nginx/sites-enabled/

# Test nginx config
sudo nginx -t

# Get SSL certificate (run WITHOUT ssl first, then re-enable)
# First, temporarily edit the config to remove SSL lines, then:
sudo certbot --nginx -d supabase.yourdomain.com

# Reload nginx
sudo systemctl reload nginx
```

### 3.7. Start Supabase Services

```bash
cd /opt/supabase/supabase/docker

# Pull all images
docker compose pull

# Start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

All services should be running:
- `supabase-db` (PostgreSQL)
- `supabase-auth` (GoTrue)
- `supabase-rest` (PostgREST)
- `supabase-realtime` (Realtime)
- `supabase-storage` (Storage API)
- `supabase-kong` (API Gateway)
- `supabase-studio` (Dashboard)

### 3.8. Note Your Credentials

Your self-hosted Supabase credentials are:

```bash
# Your Supabase URL (your VPS domain)
SUPABASE_URL=https://supabase.yourdomain.com

# From your .env file
SUPABASE_ANON_KEY=<your-generated-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-generated-service-role-key>

# Direct PostgreSQL connection (for migrations/admin)
DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@supabase.yourdomain.com:5432/postgres
```

### 3.9. Access Supabase Studio (Dashboard)

Open in browser: `https://supabase.yourdomain.com`

Login with:
- Username: `DASHBOARD_USERNAME` from .env
- Password: `DASHBOARD_PASSWORD` from .env

### 3.10. Configure Auth Providers

In Supabase Studio or by editing `.env`:

**Email Provider (enabled by default)**
- Configure SMTP settings in `.env` (GOTRUE_SMTP_* variables)
- Customize email templates via Studio: **Authentication > Email Templates**

**Google OAuth:**
1. Go to Google Cloud Console > APIs & Credentials
2. Create OAuth 2.0 Client ID
3. Add authorized redirect URI: `https://supabase.yourdomain.com/auth/v1/callback`
4. Update `.env`:
   ```bash
   GOTRUE_EXTERNAL_GOOGLE_ENABLED=true
   GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID=your-client-id
   GOTRUE_EXTERNAL_GOOGLE_SECRET=your-client-secret
   GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI=https://supabase.yourdomain.com/auth/v1/callback
   ```
5. Restart auth service: `docker compose restart supabase-auth`

### 3.11. Configure JWT Settings

Edit `.env` to set JWT expiry (matching PocketBase 7-day token):

```bash
GOTRUE_JWT_EXP=604800
```

Restart after changes:
```bash
docker compose restart supabase-auth
```

### 3.12. Firewall Configuration (UFW)

```bash
# Allow SSH
sudo ufw allow ssh

# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow PostgreSQL (only if external access needed - be careful!)
# sudo ufw allow 5432/tcp

# Enable firewall
sudo ufw enable
sudo ufw status
```

### 3.13. Set Up Automatic Restarts & Updates

Create a systemd service for auto-restart:

```bash
# /etc/systemd/system/supabase.service
[Unit]
Description=Supabase Self-Hosted
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/supabase/supabase/docker
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

Enable it:
```bash
sudo systemctl daemon-reload
sudo systemctl enable supabase.service
```

### 3.14. Backup Strategy

Set up automated PostgreSQL backups:

```bash
# Create backup script
sudo nano /opt/supabase/backup.sh
```

```bash
#!/bin/bash
BACKUP_DIR=/opt/supabase/backups
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# Backup PostgreSQL
docker exec supabase-db pg_dump -U postgres postgres > $BACKUP_DIR/db_$TIMESTAMP.sql

# Compress
gzip $BACKUP_DIR/db_$TIMESTAMP.sql

# Keep only last 7 days of backups
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: db_$TIMESTAMP.sql.gz"
```

```bash
# Make executable and add to cron
sudo chmod +x /opt/supabase/backup.sh
sudo crontab -e
# Add: 0 2 * * * /opt/supabase/backup.sh >> /var/log/supabase-backup.log 2>&1
```

---

## 4. Database Schema Migration

### 4.1. SQL Schema for All Collections

Run the following SQL in Supabase SQL Editor (**SQL Editor** in dashboard or via CLI).

> **Important:** Run these in order due to foreign key dependencies.

#### 4.1.1. Users Table (handled by Supabase Auth)

Supabase Auth automatically creates an `auth.users` table. You need a **public profiles table** for your custom fields:

```sql
-- Public user profiles (mirrors auth.users with custom fields)
CREATE TABLE public.users (
    id TEXT PRIMARY KEY,  -- matches auth.users.id
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    avatar TEXT,  -- will store Supabase Storage path
    role TEXT CHECK (role IN ('admin', 'member')) DEFAULT 'member',
    status TEXT CHECK (status IN ('online', 'offline', 'suspended')) DEFAULT 'offline',
    last_activity TIMESTAMPTZ,
    discord_user_id TEXT,
    email_visibility BOOLEAN DEFAULT FALSE,
    verified BOOLEAN DEFAULT FALSE,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to auto-update 'updated' timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to users (will apply to all tables later)
CREATE TRIGGER users_updated_at
    BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.2. Companies

```sql
CREATE TABLE public.companies (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company_name TEXT NOT NULL,
    owner_name TEXT,
    company_location TEXT,
    google_maps_link TEXT,
    source TEXT,
    instagram_handle TEXT,
    email TEXT,
    status JSONB,  -- JSON array of status values
    first_contacted TIMESTAMPTZ,
    last_contacted TIMESTAMPTZ,
    notes TEXT,
    contact_source TEXT,
    do_not_contact BOOLEAN DEFAULT FALSE,
    google_rating TEXT,
    google_reviews_count TEXT,
    website TEXT,
    industry TEXT,
    price_range TEXT,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER companies_updated_at
    BEFORE UPDATE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.3. Phone Numbers

```sql
CREATE TABLE public.phone_numbers (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company TEXT NOT NULL REFERENCES public.companies(id),
    phone_number TEXT NOT NULL,
    label TEXT,
    location_name TEXT,
    location_address TEXT,
    receptionist_name TEXT,
    last_called TIMESTAMPTZ,
    total_calls INTEGER DEFAULT 0,
    disassociated BOOLEAN DEFAULT FALSE,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER phone_numbers_updated_at
    BEFORE UPDATE ON public.phone_numbers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.4. Cold Calls (legacy)

```sql
CREATE TABLE public.cold_calls (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company TEXT REFERENCES public.companies(id),
    caller_name TEXT,
    recipients TEXT,
    call_outcome TEXT CHECK (call_outcome IN (
        'Interested', 'Not Interested', 'Callback', 'No Answer',
        'Fumbled', 'Bad Lead', 'Send Email',
        'Hung Up (Rude Recep)', 'Hung Up (Other)', 'Other'
    )),
    objections JSONB,
    pain_points JSONB,
    follow_up_actions JSONB,
    call_summary TEXT,
    call_duration_estimate TEXT,
    model_used TEXT,
    phone_number TEXT,
    owner_name TEXT,
    claimed_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER cold_calls_updated_at
    BEFORE UPDATE ON public.cold_calls
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.5. Cold Calling Sessions

```sql
CREATE TABLE public.cold_calling_sessions (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    "user" TEXT NOT NULL REFERENCES public.users(id),
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    total_dials INTEGER DEFAULT 0,
    total_pickups INTEGER DEFAULT 0,
    total_duration_sec INTEGER DEFAULT 0,
    owner_reached INTEGER DEFAULT 0,
    pitch_completed INTEGER DEFAULT 0,
    appointment_set INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
    session_notes TEXT,
    paused_at TIMESTAMPTZ,
    total_paused_sec INTEGER DEFAULT 0,
    total_callbacks INTEGER DEFAULT 0,
    total_incoming INTEGER DEFAULT 0,
    is_test BOOLEAN DEFAULT FALSE,
    manual_adjustments JSONB,
    on_call BOOLEAN DEFAULT FALSE,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER cold_calling_sessions_updated_at
    BEFORE UPDATE ON public.cold_calling_sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.6. Call Logs

```sql
CREATE TABLE public.call_logs (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company TEXT NOT NULL REFERENCES public.companies(id),
    phone_number_record TEXT NOT NULL REFERENCES public.phone_numbers(id),
    caller TEXT REFERENCES public.users(id),
    call_time TIMESTAMPTZ NOT NULL,
    duration INTEGER DEFAULT 0,
    ring_duration INTEGER DEFAULT 0,
    call_duration INTEGER DEFAULT 0,
    call_outcome TEXT[],  -- PostgreSQL array (multi-select in PB)
    direction TEXT CHECK (direction IN ('outbound', 'inbound')),
    callback_events JSONB,
    owner_name_found TEXT,
    receptionist_name TEXT,
    post_call_notes TEXT,
    status_changed_to TEXT CHECK (status_changed_to IN (
        'Cold No Reply', 'Replied', 'Warm', 'Booked', 'Paid', 'Client', 'Excluded'
    )),
    has_recording BOOLEAN DEFAULT FALSE,
    session TEXT REFERENCES public.cold_calling_sessions(id),
    cold_call TEXT REFERENCES public.cold_calls(id),
    owner_reached BOOLEAN DEFAULT FALSE,
    pitch_completed BOOLEAN DEFAULT FALSE,
    appointment_set BOOLEAN DEFAULT FALSE,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER call_logs_updated_at
    BEFORE UPDATE ON public.call_logs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.7. Call Transcripts

```sql
CREATE TABLE public.call_transcripts (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    call TEXT NOT NULL REFERENCES public.cold_calls(id) ON DELETE CASCADE,
    transcript TEXT NOT NULL,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_call_transcripts_call ON public.call_transcripts(call);
```

#### 4.1.8. Company Notes

```sql
CREATE TABLE public.company_notes (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company TEXT NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    phone_number_record TEXT REFERENCES public.phone_numbers(id),
    note_type TEXT NOT NULL CHECK (note_type IN ('pre_call', 'research', 'general')),
    content TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER company_notes_updated_at
    BEFORE UPDATE ON public.company_notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.9. Custom Call Outcomes

```sql
CREATE TABLE public.custom_call_outcomes (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_custom_call_outcomes_name ON public.custom_call_outcomes(name);
```

#### 4.1.10. Instagram Actors

```sql
CREATE TABLE public.insta_actors (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    username TEXT NOT NULL,
    owner TEXT NOT NULL REFERENCES public.users(id),
    status TEXT CHECK (status IN ('Active', 'Suspended By Team', 'Suspended By Insta', 'Discarded')),
    last_activity TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER insta_actors_updated_at
    BEFORE UPDATE ON public.insta_actors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.11. Event Logs

```sql
CREATE TABLE public.event_logs (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'Outreach', 'Change in Tar Info', 'Tar Exception Toggle',
        'User', 'System', 'Cold Call'
    )),
    actor TEXT REFERENCES public.insta_actors(id),
    "user" TEXT REFERENCES public.users(id),
    company TEXT REFERENCES public.companies(id),
    cold_call TEXT REFERENCES public.cold_calls(id),
    details TEXT,
    source TEXT CHECK (source IN ('instagram', 'cold_call')),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.12. Outreach Logs

```sql
CREATE TABLE public.outreach_logs (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    event TEXT REFERENCES public.event_logs(id),
    message_text TEXT,
    sent_at TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.13. Follow-Ups

```sql
CREATE TABLE public.follow_ups (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    call_log TEXT REFERENCES public.call_logs(id),
    company TEXT REFERENCES public.companies(id),
    phone_number_record TEXT REFERENCES public.phone_numbers(id),
    created_by TEXT REFERENCES public.users(id),
    scheduled_time TIMESTAMPTZ,
    client_timezone TEXT,
    assigned_to TEXT REFERENCES public.users(id),
    notes TEXT,
    status TEXT CHECK (status IN ('pending', 'completed', 'cancelled', 'overdue')),
    completed_at TIMESTAMPTZ,
    reminder_sent BOOLEAN DEFAULT FALSE,
    overdue_notified BOOLEAN DEFAULT FALSE,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER follow_ups_updated_at
    BEFORE UPDATE ON public.follow_ups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.14. Interactions

```sql
CREATE TABLE public.interactions (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company TEXT REFERENCES public.companies(id),
    channel TEXT,
    direction TEXT,
    "timestamp" TIMESTAMPTZ,
    "user" TEXT REFERENCES public.users(id),
    summary TEXT,
    call_log TEXT REFERENCES public.call_logs(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.15. Notes (standalone)

```sql
CREATE TABLE public.notes (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    title TEXT,
    note_text JSONB,  -- Tiptap JSON content
    created_by TEXT REFERENCES public.users(id),
    last_edited_by TEXT REFERENCES public.users(id),
    is_archived BOOLEAN DEFAULT FALSE,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER notes_updated_at
    BEFORE UPDATE ON public.notes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.16. Goals

```sql
CREATE TABLE public.goals (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    metric TEXT NOT NULL CHECK (metric IN (
        'calls_made', 'leads_generated', 'appointments_set',
        'follow_ups_completed', 'messages_sent'
    )),
    target_value REAL NOT NULL,
    frequency TEXT NOT NULL CHECK (frequency IN ('Daily', 'Weekly', 'Monthly')),
    assigned_to_user TEXT REFERENCES public.users(id),
    assigned_to_actor TEXT REFERENCES public.insta_actors(id),
    status TEXT CHECK (status IN ('Active', 'Archived')) DEFAULT 'Active',
    suggested_by TEXT,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER goals_updated_at
    BEFORE UPDATE ON public.goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.17. Rules

```sql
CREATE TABLE public.rules (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    type TEXT NOT NULL CHECK (type IN ('Frequency Cap', 'Interval Spacing')),
    metric TEXT,
    limit_value REAL,
    time_window_sec INTEGER,
    severity TEXT,
    assigned_to_user TEXT REFERENCES public.users(id),
    assigned_to_actor TEXT REFERENCES public.insta_actors(id),
    status TEXT CHECK (status IN ('Active', 'Archived')) DEFAULT 'Active',
    suggested_by TEXT,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.18. Alerts

```sql
CREATE TABLE public.alerts (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    created_by TEXT NOT NULL REFERENCES public.users(id),
    target_user TEXT NOT NULL REFERENCES public.users(id),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('cold_call', 'company', 'goal', 'follow_up')),
    entity_id TEXT,
    entity_label TEXT,
    alert_time TIMESTAMPTZ,
    message TEXT,
    is_dismissed BOOLEAN DEFAULT FALSE,
    sent BOOLEAN DEFAULT FALSE,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.19. Recordings

```sql
CREATE TABLE public.recordings (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    phone_number TEXT,
    uploader TEXT REFERENCES public.users(id),
    file TEXT,  -- Supabase Storage path
    note TEXT,
    recording_date TIMESTAMPTZ,
    duration REAL,
    call_log TEXT REFERENCES public.call_logs(id),
    company TEXT REFERENCES public.companies(id),
    phone_number_record TEXT REFERENCES public.phone_numbers(id),
    original_filename TEXT,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.20. Financial Tables

```sql
-- Bank Accounts
CREATE TABLE public.bank_accounts (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    currency TEXT NOT NULL CHECK (currency IN (
        'USD', 'PKR', 'GBP', 'EUR', 'AED', 'CAD', 'AUD', 'SGD', 'INR', 'SAR'
    )),
    balance REAL NOT NULL DEFAULT 0,
    account_type TEXT NOT NULL CHECK (account_type IN (
        'checking', 'savings', 'wallet', 'credit', 'crypto', 'cash'
    )),
    color TEXT,
    icon TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_by TEXT NOT NULL REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER bank_accounts_updated_at
    BEFORE UPDATE ON public.bank_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Financial Categories
CREATE TABLE public.fin_categories (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    color TEXT,
    icon TEXT,
    budget_limit REAL,
    budget_currency TEXT,
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Financial Transactions
CREATE TABLE public.fin_transactions (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    bank_account TEXT NOT NULL REFERENCES public.bank_accounts(id),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount REAL NOT NULL,
    currency TEXT,
    fee_amount REAL DEFAULT 0,
    category TEXT REFERENCES public.fin_categories(id),
    category_splits JSONB,
    tags JSONB,
    description TEXT,
    status TEXT CHECK (status IN ('cleared', 'pending', 'reconciled')),
    date TIMESTAMPTZ,
    expected_clear_date TIMESTAMPTZ,
    receipt_file TEXT,  -- Supabase Storage path
    created_by TEXT REFERENCES public.users(id),
    is_recurring BOOLEAN DEFAULT FALSE,
    recurring_id TEXT,
    refund_of TEXT REFERENCES public.fin_transactions(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER fin_transactions_updated_at
    BEFORE UPDATE ON public.fin_transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Balance Adjustments
CREATE TABLE public.balance_adjustments (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    bank_account TEXT NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
    old_balance REAL NOT NULL,
    new_balance REAL NOT NULL,
    reason TEXT NOT NULL,
    adjusted_by TEXT NOT NULL REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Recurring Transactions
CREATE TABLE public.recurring_transactions (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    bank_account TEXT NOT NULL REFERENCES public.bank_accounts(id),
    type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
    amount REAL NOT NULL,
    currency TEXT,
    fee_amount REAL DEFAULT 0,
    category TEXT REFERENCES public.fin_categories(id),
    category_splits JSONB,
    description TEXT,
    frequency TEXT,
    start_date TIMESTAMPTZ,
    end_date TIMESTAMPTZ,
    next_run_date TIMESTAMPTZ,
    initial_amount REAL,
    renewal_amount REAL,
    amount_history JSONB,
    initial_applied BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.21. Email System Tables

```sql
-- Email Templates
CREATE TABLE public.email_templates (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    subject TEXT,
    html_body TEXT,
    json_body JSONB,
    preview_text TEXT,
    category TEXT,
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Lists
CREATE TABLE public.email_lists (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    list_type TEXT NOT NULL CHECK (list_type IN ('static', 'dynamic', 'suppression')),
    filter_json JSONB,
    company_ids JSONB,
    cached_count INTEGER DEFAULT 0,
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Campaigns
CREATE TABLE public.email_campaigns (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    template TEXT REFERENCES public.email_templates(id),
    subject TEXT,
    html_body TEXT,
    json_body JSONB,
    status TEXT NOT NULL CHECK (status IN (
        'draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled'
    )),
    campaign_type TEXT CHECK (campaign_type IN ('one_time', 'ab_test')),
    audience_list TEXT REFERENCES public.email_lists(id),
    exclusion_list TEXT REFERENCES public.email_lists(id),
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,
    unsubscribed_count INTEGER DEFAULT 0,
    ab_variant TEXT,
    ab_parent TEXT REFERENCES public.email_campaigns(id),
    ab_split_pct REAL,
    ab_winner_metric TEXT CHECK (ab_winner_metric IN ('open_rate', 'click_rate')),
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Recipients
CREATE TABLE public.email_recipients (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    campaign TEXT NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
    company TEXT REFERENCES public.companies(id),
    email_address TEXT,
    status TEXT CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed')),
    tracking_id TEXT,
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    sent_at TIMESTAMPTZ,
    opened_at TIMESTAMPTZ,
    clicked_at TIMESTAMPTZ,
    personalization_data JSONB,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Events
CREATE TABLE public.email_events (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    recipient TEXT REFERENCES public.email_recipients(id) ON DELETE CASCADE,
    enrollment TEXT REFERENCES public.email_sequence_enrollments(id),
    company TEXT REFERENCES public.companies(id),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed', 'complained'
    )),
    event_data JSONB,
    ip_address TEXT,
    user_agent TEXT,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Sequences
CREATE TABLE public.email_sequences (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    name TEXT NOT NULL,
    status TEXT CHECK (status IN ('active', 'paused', 'archived')),
    trigger_type TEXT,
    trigger_config JSONB,
    stop_on_reply BOOLEAN DEFAULT FALSE,
    stop_on_status_change BOOLEAN DEFAULT FALSE,
    stop_statuses JSONB,
    audience_list TEXT REFERENCES public.email_lists(id),
    created_by TEXT REFERENCES public.users(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Sequence Steps
CREATE TABLE public.email_sequence_steps (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    sequence TEXT NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
    step_order INTEGER NOT NULL,
    template TEXT REFERENCES public.email_templates(id),
    delay_days INTEGER DEFAULT 0,
    delay_hours INTEGER DEFAULT 0,
    send_window_start TEXT,
    send_window_end TEXT,
    subject_override TEXT,
    body_override TEXT,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Sequence Enrollments
CREATE TABLE public.email_sequence_enrollments (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    sequence TEXT NOT NULL REFERENCES public.email_sequences(id),
    company TEXT REFERENCES public.companies(id),
    status TEXT CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
    current_step INTEGER DEFAULT 0,
    next_send_at TIMESTAMPTZ,
    enrolled_at TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- Email Unsubscribes
CREATE TABLE public.email_unsubscribes (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    company TEXT REFERENCES public.companies(id),
    email_address TEXT,
    reason TEXT,
    source TEXT,
    campaign TEXT REFERENCES public.email_campaigns(id),
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4.1.22. Remaining Tables

```sql
-- Recycle Bin
CREATE TABLE public.recycle_bin (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    item_type TEXT NOT NULL,
    original_id TEXT NOT NULL,
    item_label TEXT,
    item_data JSONB,
    related_data JSONB,
    deleted_by TEXT REFERENCES public.users(id),
    deleted_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

-- User Preferences
CREATE TABLE public.user_preferences (
    id TEXT PRIMARY KEY DEFAULT generate_pb_id(),
    "user" TEXT NOT NULL REFERENCES public.users(id),
    theme TEXT,
    display_density TEXT,
    timezones JSONB,
    notification_settings JSONB,
    workflow_preferences JSONB,
    privacy_settings JSONB,
    power_dialer_state JSONB,
    created TIMESTAMPTZ DEFAULT NOW(),
    updated TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER user_preferences_updated_at
    BEFORE UPDATE ON public.user_preferences
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

#### 4.1.23. ID Generation Helper Function

PocketBase uses 15-char alphanumeric IDs. Create this function to generate compatible IDs for new records:

```sql
CREATE OR REPLACE FUNCTION generate_pb_id()
RETURNS TEXT AS $$
DECLARE
    chars TEXT := 'abcdefghijklmnopqrstuvwxyz0123456789';
    result TEXT := '';
    i INTEGER;
BEGIN
    FOR i IN 1..15 LOOP
        result := result || substr(chars, floor(random() * 36 + 1)::int, 1);
    END LOOP;
    RETURN result;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Row-Level Security (RLS) Policies

PocketBase has collection-level rules. Supabase uses PostgreSQL RLS. Here's the translation for each table.

### 5.1. Enable RLS on All Tables

```sql
-- Enable RLS on every table
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phone_numbers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cold_calling_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.custom_call_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insta_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fin_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recurring_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_sequence_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recycle_bin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
```

### 5.2. Helper: Get User Role

```sql
-- Helper function to get the current user's role
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS TEXT AS $$
    SELECT role FROM public.users WHERE id = auth.uid()::text;
$$ LANGUAGE sql SECURITY DEFINER STABLE;
```

### 5.3. RLS Policies

The pattern from PocketBase is: most tables require `@request.auth.id != ''` (any authenticated user) for read/create/update, and `@request.auth.role = 'admin'` for delete.

```sql
-- ========================================
-- USERS: anyone authenticated can read, only self or admin can update/delete
-- ========================================
CREATE POLICY "users_select" ON public.users FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "users_insert" ON public.users FOR INSERT
    TO authenticated WITH CHECK (true);

CREATE POLICY "users_update" ON public.users FOR UPDATE
    TO authenticated USING (
        id = auth.uid()::text OR auth.user_role() = 'admin'
    );

CREATE POLICY "users_delete" ON public.users FOR DELETE
    TO authenticated USING (
        id = auth.uid()::text OR auth.user_role() = 'admin'
    );

-- ========================================
-- STANDARD PATTERN: authenticated read/create/update, admin-only delete
-- Apply to: companies, cold_calls, cold_calling_sessions, call_logs,
--   call_transcripts, company_notes, insta_actors, event_logs, outreach_logs,
--   goals, rules, recordings, interactions, phone_numbers
-- ========================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'companies', 'cold_calls', 'cold_calling_sessions', 'call_logs',
        'call_transcripts', 'company_notes', 'insta_actors', 'event_logs',
        'outreach_logs', 'goals', 'rules', 'recordings', 'interactions',
        'phone_numbers', 'follow_ups', 'recycle_bin'
    ] LOOP
        EXECUTE format('
            CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);
            CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true);
            CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true);
            CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.user_role() = ''admin'');
        ',
            tbl || '_select', tbl,
            tbl || '_insert', tbl,
            tbl || '_update', tbl,
            tbl || '_delete', tbl
        );
    END LOOP;
END $$;

-- ========================================
-- ALERTS: special rules
-- List: only target_user or created_by can see
-- Update: only target_user or created_by
-- Delete: admin only
-- ========================================
CREATE POLICY "alerts_select" ON public.alerts FOR SELECT
    TO authenticated USING (true);  -- viewRule was @request.auth.id != ''

CREATE POLICY "alerts_insert" ON public.alerts FOR INSERT
    TO authenticated WITH CHECK (true);

CREATE POLICY "alerts_update" ON public.alerts FOR UPDATE
    TO authenticated USING (
        target_user = auth.uid()::text OR created_by = auth.uid()::text
    );

CREATE POLICY "alerts_delete" ON public.alerts FOR DELETE
    TO authenticated USING (auth.user_role() = 'admin');

-- ========================================
-- NOTES: standard authenticated access
-- ========================================
CREATE POLICY "notes_select" ON public.notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes_insert" ON public.notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notes_update" ON public.notes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "notes_delete" ON public.notes FOR DELETE TO authenticated USING (true);

-- ========================================
-- EMAIL TABLES: authenticated full access
-- ========================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'email_templates', 'email_lists', 'email_campaigns', 'email_recipients',
        'email_events', 'email_sequences', 'email_sequence_steps',
        'email_sequence_enrollments', 'email_unsubscribes'
    ] LOOP
        EXECUTE format('
            CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);
            CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true);
            CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true);
            CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (true);
        ',
            tbl || '_select', tbl,
            tbl || '_insert', tbl,
            tbl || '_update', tbl,
            tbl || '_delete', tbl
        );
    END LOOP;
END $$;

-- ========================================
-- FINANCIAL TABLES: authenticated read/create/update, admin delete
-- ========================================
DO $$
DECLARE
    tbl TEXT;
BEGIN
    FOREACH tbl IN ARRAY ARRAY[
        'bank_accounts', 'fin_categories', 'fin_transactions',
        'balance_adjustments', 'recurring_transactions'
    ] LOOP
        EXECUTE format('
            CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);
            CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (true);
            CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (true);
            CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (auth.user_role() = ''admin'');
        ',
            tbl || '_select', tbl,
            tbl || '_insert', tbl,
            tbl || '_update', tbl,
            tbl || '_delete', tbl
        );
    END LOOP;
END $$;

-- ========================================
-- USER PREFERENCES: only own preferences
-- ========================================
CREATE POLICY "user_preferences_select" ON public.user_preferences FOR SELECT
    TO authenticated USING (true);

CREATE POLICY "user_preferences_insert" ON public.user_preferences FOR INSERT
    TO authenticated WITH CHECK (true);

CREATE POLICY "user_preferences_update" ON public.user_preferences FOR UPDATE
    TO authenticated USING ("user" = auth.uid()::text);

CREATE POLICY "user_preferences_delete" ON public.user_preferences FOR DELETE
    TO authenticated USING ("user" = auth.uid()::text);

-- ========================================
-- CUSTOM CALL OUTCOMES: admin-only update/delete
-- ========================================
CREATE POLICY "cco_select" ON public.custom_call_outcomes FOR SELECT TO authenticated USING (true);
CREATE POLICY "cco_insert" ON public.custom_call_outcomes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "cco_update" ON public.custom_call_outcomes FOR UPDATE TO authenticated USING (auth.user_role() = 'admin');
CREATE POLICY "cco_delete" ON public.custom_call_outcomes FOR DELETE TO authenticated USING (auth.user_role() = 'admin');
```

### 5.4. Service Role Bypass

The Python agents use admin auth. In Supabase, use the **service role key** for server-side operations. The service role key bypasses RLS entirely, equivalent to PocketBase admin auth.

---

## 6. Authentication Migration

### 6.1. How Auth Differs

| Feature | PocketBase | Supabase |
|---------|-----------|----------|
| User table | `users` collection (auth type) | `auth.users` + public `users` profile |
| Token storage | `pb.authStore` (localStorage) | `supabase.auth` session (localStorage) |
| Token refresh | Manual `authRefresh()` every 5 min | Automatic (Supabase client handles it) |
| OAuth | `authWithOAuth2({ provider })` | `signInWithOAuth({ provider })` |
| Password login | `authWithPassword(email, pwd)` | `signInWithPassword({ email, password })` |
| Admin auth | `_superusers.authWithPassword()` | Service role key (no login needed) |

### 6.2. Create Users in Supabase Auth

For each existing PocketBase user, you need to create them in Supabase Auth:

```javascript
// Migration script: create-users.mjs
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// For each PocketBase user:
async function migrateUser(pbUser) {
    // 1. Create in Supabase Auth
    const { data: authUser, error } = await supabase.auth.admin.createUser({
        email: pbUser.email,
        password: 'temporary-password-change-me',  // Users will need to reset
        email_confirm: true,  // Skip email verification
        user_metadata: {
            name: pbUser.name,
        }
    });

    if (error) throw error;

    // 2. Create matching public profile with SAME ID as PocketBase
    //    (if using Option A for ID strategy)
    const { error: profileError } = await supabase
        .from('users')
        .insert({
            id: pbUser.id,  // Keep original PocketBase ID
            email: pbUser.email,
            name: pbUser.name,
            role: pbUser.role || 'member',
            status: 'offline',
            discord_user_id: pbUser.discord_user_id,
            created: pbUser.created,
            updated: pbUser.updated,
        });

    if (profileError) throw profileError;

    return authUser;
}
```

**Important:** After migration, send all users a password reset email:
```javascript
for (const user of allUsers) {
    await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: 'https://your-app.com/reset-password',
    });
}
```

### 6.3. Auth Trigger: Auto-Create Profile on Signup

```sql
-- Automatically create a public user profile when a new auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, role, status)
    VALUES (
        NEW.id::text,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
        'member',
        'offline'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

### 6.4. Google OAuth Setup

Your current PocketBase config has OAuth enabled with Google mapped fields (`name` -> `name`, `avatarURL` -> `avatar`).

In Supabase, configure this in the Auth trigger:

```sql
-- Enhanced trigger that handles OAuth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, avatar, role, status)
    VALUES (
        NEW.id::text,
        NEW.email,
        COALESCE(
            NEW.raw_user_meta_data->>'full_name',
            NEW.raw_user_meta_data->>'name',
            split_part(NEW.email, '@', 1)
        ),
        NEW.raw_user_meta_data->>'avatar_url',
        'member',
        'offline'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## 7. Data Migration (Export & Import)

### 7.1. Export from PocketBase

**Method 1: PocketBase Admin API (recommended)**

```javascript
// export-pb-data.mjs
import PocketBase from 'pocketbase';
import fs from 'fs';

const pb = new PocketBase('http://localhost:8090');
await pb.collection('_superusers').authWithPassword(
    process.env.PB_ADMIN_EMAIL,
    process.env.PB_ADMIN_PASSWORD
);

const collections = [
    'users', 'companies', 'phone_numbers', 'cold_calls',
    'cold_calling_sessions', 'call_logs', 'call_transcripts',
    'company_notes', 'custom_call_outcomes', 'insta_actors',
    'event_logs', 'outreach_logs', 'follow_ups', 'interactions',
    'notes', 'goals', 'rules', 'alerts', 'recordings',
    'bank_accounts', 'fin_categories', 'fin_transactions',
    'balance_adjustments', 'recurring_transactions',
    'email_templates', 'email_lists', 'email_campaigns',
    'email_recipients', 'email_events', 'email_sequences',
    'email_sequence_steps', 'email_sequence_enrollments',
    'email_unsubscribes', 'recycle_bin', 'user_preferences'
];

const exportData = {};
for (const col of collections) {
    console.log(`Exporting ${col}...`);
    try {
        exportData[col] = await pb.collection(col).getFullList({
            sort: 'created',
        });
        console.log(`  -> ${exportData[col].length} records`);
    } catch (e) {
        console.error(`  -> Error: ${e.message}`);
        exportData[col] = [];
    }
}

fs.writeFileSync('pb-export.json', JSON.stringify(exportData, null, 2));
console.log('Export complete!');
```

### 7.2. Import to Supabase

```javascript
// import-to-supabase.mjs
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY  // Service role bypasses RLS
);

const data = JSON.parse(fs.readFileSync('pb-export.json', 'utf-8'));

// Import order matters due to foreign keys
const importOrder = [
    'users',          // No dependencies
    'companies',      // No dependencies
    'phone_numbers',  // -> companies
    'insta_actors',   // -> users
    'cold_calls',     // -> companies, users
    'cold_calling_sessions',  // -> users
    'call_logs',      // -> companies, phone_numbers, users, sessions, cold_calls
    'call_transcripts',  // -> cold_calls
    'company_notes',  // -> companies, phone_numbers, users
    'custom_call_outcomes',  // -> users
    'event_logs',     // -> insta_actors, users, companies, cold_calls
    'outreach_logs',  // -> event_logs
    'follow_ups',     // -> call_logs, companies, phone_numbers, users
    'interactions',   // -> companies, users, call_logs
    'notes',          // -> users
    'goals',          // -> users, insta_actors
    'rules',          // -> users, insta_actors
    'alerts',         // -> users
    'recordings',     // -> users, call_logs, companies, phone_numbers
    'bank_accounts',  // -> users
    'fin_categories', // -> users
    'fin_transactions',  // -> bank_accounts, fin_categories, users
    'balance_adjustments',  // -> bank_accounts, users
    'recurring_transactions',  // -> bank_accounts, fin_categories, users
    'email_templates',    // -> users
    'email_lists',        // -> users
    'email_sequences',    // -> email_lists, users
    'email_campaigns',    // -> email_templates, email_lists, users, email_campaigns (self-ref)
    'email_recipients',   // -> email_campaigns, companies
    'email_sequence_steps',      // -> email_sequences, email_templates
    'email_sequence_enrollments', // -> email_sequences, companies
    'email_events',       // -> email_recipients, email_sequence_enrollments, companies
    'email_unsubscribes', // -> companies, email_campaigns
    'recycle_bin',        // -> users
    'user_preferences',   // -> users
];

function cleanRecord(record) {
    // Remove PocketBase system fields that don't map
    const { collectionId, collectionName, expand, ...clean } = record;
    return clean;
}

for (const collection of importOrder) {
    const records = data[collection];
    if (!records || records.length === 0) {
        console.log(`${collection}: no records, skipping`);
        continue;
    }

    console.log(`Importing ${collection} (${records.length} records)...`);

    // Insert in batches of 500
    const batchSize = 500;
    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize).map(cleanRecord);
        const { error } = await supabase.from(collection).insert(batch);
        if (error) {
            console.error(`  Error at batch ${i}: ${error.message}`);
            // Try one by one to find problematic record
            for (const record of batch) {
                const { error: singleError } = await supabase
                    .from(collection)
                    .insert(cleanRecord(record));
                if (singleError) {
                    console.error(`  Failed record ${record.id}: ${singleError.message}`);
                }
            }
        }
    }

    console.log(`  Done.`);
}

console.log('Import complete!');
```

### 7.3. Validate Record Counts

```javascript
// validate-migration.mjs
for (const collection of importOrder) {
    const pbCount = data[collection]?.length || 0;
    const { count } = await supabase
        .from(collection)
        .select('*', { count: 'exact', head: true });
    const match = pbCount === count ? 'OK' : 'MISMATCH';
    console.log(`${collection}: PB=${pbCount} Supabase=${count} [${match}]`);
}
```

---

## 8. File Storage Migration

### 8.1. Create Storage Buckets

```sql
-- Via Supabase SQL Editor or dashboard
INSERT INTO storage.buckets (id, name, public)
VALUES
    ('avatars', 'avatars', true),       -- User avatars (public)
    ('recordings', 'recordings', false), -- Call recordings (private)
    ('receipts', 'receipts', false);     -- Financial receipts (private)
```

Or via dashboard: **Storage > New Bucket**

### 8.2. Storage RLS Policies

```sql
-- Avatars: public read, authenticated upload
CREATE POLICY "avatars_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "avatars_auth_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars');

-- Recordings: authenticated only
CREATE POLICY "recordings_auth_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'recordings');

CREATE POLICY "recordings_auth_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'recordings');

-- Receipts: authenticated only
CREATE POLICY "receipts_auth_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'receipts');

CREATE POLICY "receipts_auth_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'receipts');
```

### 8.3. Download Files from PocketBase & Upload to Supabase

```javascript
// migrate-files.mjs
import PocketBase from 'pocketbase';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const pb = new PocketBase('http://localhost:8090');
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Migrate user avatars
const users = await pb.collection('users').getFullList();
for (const user of users) {
    if (!user.avatar) continue;

    const fileUrl = pb.files.getUrl(user, user.avatar);
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const storagePath = `${user.id}/${user.avatar}`;
    const { error } = await supabase.storage
        .from('avatars')
        .upload(storagePath, buffer, {
            contentType: response.headers.get('content-type'),
            upsert: true,
        });

    if (error) console.error(`Avatar ${user.id}: ${error.message}`);

    // Update user record with new storage path
    await supabase.from('users').update({
        avatar: storagePath,
    }).eq('id', user.id);

    console.log(`Migrated avatar for ${user.name}`);
}

// Migrate recordings
const recordings = await pb.collection('recordings').getFullList();
for (const rec of recordings) {
    if (!rec.file) continue;

    const fileUrl = pb.files.getUrl(rec, rec.file);
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const storagePath = `${rec.id}/${rec.file}`;
    const { error } = await supabase.storage
        .from('recordings')
        .upload(storagePath, buffer, {
            contentType: response.headers.get('content-type') || 'audio/mpeg',
            upsert: true,
        });

    if (error) console.error(`Recording ${rec.id}: ${error.message}`);

    await supabase.from('recordings').update({
        file: storagePath,
    }).eq('id', rec.id);
}

// Migrate receipt files (fin_transactions.receipt_file)
const transactions = await pb.collection('fin_transactions').getFullList();
for (const txn of transactions) {
    if (!txn.receipt_file) continue;

    const fileUrl = pb.files.getUrl(txn, txn.receipt_file);
    const response = await fetch(fileUrl);
    const buffer = Buffer.from(await response.arrayBuffer());

    const storagePath = `${txn.id}/${txn.receipt_file}`;
    const { error } = await supabase.storage
        .from('receipts')
        .upload(storagePath, buffer, {
            contentType: response.headers.get('content-type'),
            upsert: true,
        });

    if (error) console.error(`Receipt ${txn.id}: ${error.message}`);

    await supabase.from('fin_transactions').update({
        receipt_file: storagePath,
    }).eq('id', txn.id);
}
```

### 8.4. Generating File URLs (New Pattern)

**Before (PocketBase):**
```typescript
pb.files.getUrl(record, record.avatar)
pb.files.getUrl(record, record.avatar, { thumb: '40x40' })
```

**After (Supabase):**
```typescript
// Public bucket (avatars)
supabase.storage.from('avatars').getPublicUrl(record.avatar).data.publicUrl

// Private bucket (recordings) - generates a signed URL
const { data } = await supabase.storage
    .from('recordings')
    .createSignedUrl(record.file, 3600)  // 1 hour expiry

// For thumbnails, use Supabase Image Transformation
supabase.storage.from('avatars').getPublicUrl(record.avatar, {
    transform: { width: 40, height: 40, resize: 'cover' }
}).data.publicUrl
```

---

## 9. Realtime Subscriptions Migration

### 9.1. Enable Realtime for Tables

In Supabase dashboard: **Database > Replication** and enable the tables you need realtime for:

- `users` (team presence)
- `cold_calling_sessions` (session tracking)
- `follow_ups` (if switching from polling)
- `alerts` (notifications)

Or via SQL:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.cold_calling_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.follow_ups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
```

### 9.2. Subscription Pattern Changes

**Before (PocketBase):**
```typescript
// Subscribe to all changes on a collection
const unsubscribe = pb.collection('users').subscribe('*', (event) => {
    // event.action: 'create' | 'update' | 'delete'
    // event.record: the full record
});

// Cleanup
unsubscribe();
```

**After (Supabase):**
```typescript
// Subscribe to all changes on a table
const channel = supabase
    .channel('users-changes')
    .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'users' },
        (payload) => {
            // payload.eventType: 'INSERT' | 'UPDATE' | 'DELETE'
            // payload.new: the new record (for INSERT/UPDATE)
            // payload.old: the old record (for UPDATE/DELETE)
        }
    )
    .subscribe();

// Cleanup
supabase.removeChannel(channel);
```

### 9.3. Specific Subscription Migrations

#### Team Presence Context

```typescript
// Before
pb.collection('users').subscribe('*', (e) => { ... });
pb.collection('cold_calling_sessions').subscribe('*', (e) => { ... });

// After
const presenceChannel = supabase
    .channel('team-presence')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'users' },
        (payload) => {
            const action = payload.eventType.toLowerCase();
            const record = payload.new || payload.old;
            handleUserChange({ action, record });
        }
    )
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'cold_calling_sessions' },
        (payload) => {
            const action = payload.eventType.toLowerCase();
            const record = payload.new || payload.old;
            handleSessionChange({ action, record });
        }
    )
    .subscribe();
```

#### Session Context

```typescript
// Before
pb.collection('cold_calling_sessions').subscribe('*', (e) => {
    debouncedRefresh();
});

// After
const sessionChannel = supabase
    .channel('session-updates')
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'cold_calling_sessions' },
        () => debouncedRefresh()
    )
    .subscribe();
```

---

## 10. TypeScript Client Migration

### 10.1. Replace PocketBase SDK with Supabase SDK

**File: `packages/pocketbase-client/src/index.ts`**

This is the biggest change. You need to rewrite the `CRMPocketBase` class as `CRMSupabase`.

#### Before vs After: Client Initialization

```typescript
// BEFORE
import PocketBase from 'pocketbase';
const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);
pb.autoCancellation(false);

// AFTER
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
```

#### Before vs After: CRUD Operations

```typescript
// ===== GET ALL RECORDS =====
// Before
const companies = await pb.collection('companies').getFullList({ sort: '-created' });
// After
const { data: companies } = await supabase
    .from('companies')
    .select('*')
    .order('created', { ascending: false });

// ===== GET ONE RECORD =====
// Before
const company = await pb.collection('companies').getOne(id);
// After
const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', id)
    .single();

// ===== GET FIRST MATCHING RECORD =====
// Before
const company = await pb.collection('companies').getFirstListItem(`phone_numbers ~ "${phone}"`);
// After
const { data: company } = await supabase
    .from('companies')
    .select('*')
    .ilike('phone_numbers', `%${phone}%`)
    .limit(1)
    .single();

// ===== PAGINATED LIST =====
// Before
const result = await pb.collection('event_logs').getList(1, 100, { sort: '-created' });
// result.items, result.totalItems, result.totalPages
// After
const { data, count } = await supabase
    .from('event_logs')
    .select('*', { count: 'exact' })
    .order('created', { ascending: false })
    .range(0, 99);  // 0-indexed, inclusive

// ===== CREATE =====
// Before
const company = await pb.collection('companies').create(data);
// After
const { data: company } = await supabase
    .from('companies')
    .insert(data)
    .select()
    .single();

// ===== UPDATE =====
// Before
await pb.collection('companies').update(id, data);
// After
const { data: company } = await supabase
    .from('companies')
    .update(data)
    .eq('id', id)
    .select()
    .single();

// ===== DELETE =====
// Before
await pb.collection('companies').delete(id);
// After
await supabase.from('companies').delete().eq('id', id);
```

#### Before vs After: Expanding Relations

```typescript
// Before (PocketBase expand)
const calls = await pb.collection('cold_calls').getFullList({
    expand: 'company,claimed_by',
});
// Access: call.expand?.company?.company_name

// After (Supabase foreign table joins)
const { data: calls } = await supabase
    .from('cold_calls')
    .select(`
        *,
        company:companies(*),
        claimed_by:users(*)
    `);
// Access: call.company?.company_name
```

#### Before vs After: Filtering

```typescript
// Before (PocketBase filter syntax)
pb.collection('alerts').getFullList({
    filter: `target_user = "${userId}" && is_dismissed = false`,
    sort: '-alert_time',
    expand: 'created_by,target_user',
});

// After (Supabase PostgREST)
supabase
    .from('alerts')
    .select('*, created_by:users!created_by(*), target_user_detail:users!target_user(*)')
    .eq('target_user', userId)
    .eq('is_dismissed', false)
    .order('alert_time', { ascending: false });
```

### 10.2. Auth Context Migration

**File: `apps/dashboard/src/contexts/auth-context.tsx`**

```typescript
// BEFORE
import { pb } from '@/lib/pocketbase';

// Login
const authData = await pb.collection('users').authWithPassword(email, password);
const user = authData.record;

// OAuth
const authData = await pb.collection('users').authWithOAuth2({ provider: 'google' });

// Refresh
await pb.collection('users').authRefresh();

// Logout
pb.authStore.clear();

// Check auth
const isLoggedIn = pb.authStore.isValid;
const currentUser = pb.authStore.model;

// Listen for auth changes
pb.authStore.onChange((token, model) => { ... });

// =============================================

// AFTER
import { supabase } from '@/lib/supabase';

// Login
const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
});
const user = data.user;
// Then fetch profile:
const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', data.user.id)
    .single();

// OAuth
const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
});

// Refresh (automatic with Supabase, but can force)
const { data: { session } } = await supabase.auth.refreshSession();

// Logout
await supabase.auth.signOut();

// Check auth
const { data: { session } } = await supabase.auth.getSession();
const isLoggedIn = !!session;

// Listen for auth changes
supabase.auth.onAuthStateChange((event, session) => {
    // event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED' | ...
});
```

### 10.3. File URL Generation

```typescript
// BEFORE
const avatarUrl = pb.files.getUrl(user, user.avatar);
const thumbUrl = pb.files.getUrl(user, user.avatar, { thumb: '40x40' });

// AFTER
const avatarUrl = supabase.storage
    .from('avatars')
    .getPublicUrl(user.avatar).data.publicUrl;

const thumbUrl = supabase.storage
    .from('avatars')
    .getPublicUrl(user.avatar, {
        transform: { width: 40, height: 40, resize: 'cover' },
    }).data.publicUrl;
```

### 10.4. Server-Side Auth (API Routes)

**File: `apps/dashboard/src/lib/api-auth.ts`**

```typescript
// BEFORE
export async function authenticateRequest(request: Request) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;
    const tempPb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_URL);
    tempPb.authStore.save(token, null);
    const result = await tempPb.collection('users').authRefresh();
    return { id: result.record.id, email: result.record.email };
}

// AFTER
import { createClient } from '@supabase/supabase-js';

export async function authenticateRequest(request: Request) {
    const token = request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return null;
    return { id: user.id, email: user.email };
}
```

---

## 11. Python Client Migration

### 11.1. Replace httpx Client with supabase-py

**File: `apps/insta-outreach-agent/src/core/pocketbase_client.py`**

```python
# BEFORE
import httpx

class CRMPocketBase:
    def __init__(self, url=None):
        self.url = url or os.getenv('POCKETBASE_URL', 'http://localhost:8090')
        self.token = None

    def auth_as_admin(self, email, password):
        resp = self._post('/api/collections/_superusers/auth-with-password', {
            'identity': email, 'password': password
        })
        self.token = resp['token']

    def get_companies(self, filter=None, sort=None):
        return self._get('/api/collections/companies/records', {
            'filter': filter, 'sort': sort
        })

# =============================================

# AFTER
from supabase import create_client, Client

class CRMSupabase:
    def __init__(self, url=None, key=None):
        self.url = url or os.getenv('SUPABASE_URL')
        self.key = key or os.getenv('SUPABASE_SERVICE_ROLE_KEY')
        self.client: Client = create_client(self.url, self.key)

    # No auth_as_admin needed - service role key bypasses RLS

    def get_companies(self, filter_dict=None, sort=None):
        query = self.client.table('companies').select('*')
        if filter_dict:
            for key, value in filter_dict.items():
                query = query.eq(key, value)
        if sort:
            desc = sort.startswith('-')
            col = sort.lstrip('-')
            query = query.order(col, desc=desc)
        return query.execute().data

    def create_company(self, data):
        return self.client.table('companies').insert(data).execute().data[0]

    def update_company(self, id, data):
        return self.client.table('companies').update(data).eq('id', id).execute().data[0]

    def find_company_by_instagram(self, username):
        result = self.client.table('companies') \
            .select('*') \
            .eq('instagram_handle', username) \
            .limit(1) \
            .execute()
        return result.data[0] if result.data else None

    def create_event_log(self, data):
        return self.client.table('event_logs').insert(data).execute().data[0]
```

### 11.2. Key Differences for Python

| PocketBase (httpx) | Supabase (supabase-py) |
|--------------------|-----------------------|
| `self._get(f'/api/collections/{col}/records', params)` | `self.client.table(col).select('*').execute()` |
| `self._post(f'/api/collections/{col}/records', data)` | `self.client.table(col).insert(data).execute()` |
| `self._patch(f'/api/collections/{col}/records/{id}', data)` | `self.client.table(col).update(data).eq('id', id).execute()` |
| `self._delete(f'/api/collections/{col}/records/{id}')` | `self.client.table(col).delete().eq('id', id).execute()` |
| `{'filter': 'field = "value"'}` | `.eq('field', 'value')` |
| `{'filter': 'field ~ "value"'}` | `.ilike('field', '%value%')` |
| `{'sort': '-created'}` | `.order('created', desc=True)` |

---

## 12. API Routes Migration

### 12.1. Email Campaign API Route

**File: `apps/dashboard/src/app/api/email-send/campaign/route.ts`**

Currently uses direct HTTP calls to PocketBase REST API. Replace with Supabase client:

```typescript
// BEFORE
const campaignRes = await fetch(
    `${PB_URL}/api/collections/email_campaigns/records/${campaignId}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
);

// AFTER
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!  // Server-side: use service role
);

const { data: campaign } = await supabase
    .from('email_campaigns')
    .select('*')
    .eq('id', campaignId)
    .single();
```

---

## 13. Environment Variables Update

### 13.1. Remove PocketBase Variables

```env
# DELETE these:
NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090
POCKETBASE_URL=http://localhost:8090
PB_ADMIN_EMAIL=admin@example.com
PB_ADMIN_PASSWORD=secretpassword
```

### 13.2. Add Supabase Variables (Self-Hosted)

```env
# ADD these (using your Hostinger VPS domain):
NEXT_PUBLIC_SUPABASE_URL=https://supabase.yourdomain.com
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbG...    # From your .env on VPS
SUPABASE_SERVICE_ROLE_KEY=eyJhbG...         # From your .env on VPS (secret, server-only)

# Optional: Direct database connection (for server-side operations)
DATABASE_URL=postgresql://postgres:your-password@supabase.yourdomain.com:5432/postgres

# Keep these (unchanged):
NEXT_PUBLIC_APP_URL=https://your-app.com
RESEND_API_KEY=re_...
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
EMAIL_FROM_NAME=Your App Name
```

### 13.3. Files to Update

- `apps/dashboard/.env.local`
- `apps/dashboard/.env.production`
- `apps/insta-outreach-agent/.env`
- Any deployment platform environment variables (Vercel, Railway, etc.)

### 13.4. Self-Hosted URL Patterns

Unlike Supabase Cloud (`*.supabase.co`), your self-hosted endpoints are:

| Service | URL |
|---------|-----|
| API Base | `https://supabase.yourdomain.com` |
| REST API | `https://supabase.yourdomain.com/rest/v1/` |
| Auth | `https://supabase.yourdomain.com/auth/v1/` |
| Storage | `https://supabase.yourdomain.com/storage/v1/` |
| Realtime | `wss://supabase.yourdomain.com/realtime/v1/` |
| Studio | `https://supabase.yourdomain.com` (dashboard) |
| PostgreSQL | `supabase.yourdomain.com:5432` (if exposed) |

---

## 14. Testing & Validation

### 14.1. Pre-Migration Tests

- [ ] Run full PocketBase data export and verify JSON is valid
- [ ] Count records in each collection
- [ ] List all files and their sizes
- [ ] Test all auth flows work in current system

### 14.2. Schema Validation

- [ ] All tables created in Supabase without errors
- [ ] All foreign key constraints are correct
- [ ] All CHECK constraints match PocketBase select values
- [ ] RLS policies allow the same access patterns

### 14.3. Data Validation

- [ ] Record counts match between PocketBase and Supabase (per table)
- [ ] Spot-check 5-10 records per table for data integrity
- [ ] Verify all relations resolve correctly (foreign keys)
- [ ] JSON fields (status arrays, objections, pain_points) parsed correctly

### 14.4. Auth Validation

- [ ] Email/password login works
- [ ] Google OAuth login works
- [ ] Token refresh works automatically
- [ ] Logout clears session
- [ ] New user registration creates profile via trigger
- [ ] Password reset email sends and works
- [ ] Suspended users are blocked from login

### 14.5. Realtime Validation

- [ ] Team presence updates propagate to all connected clients
- [ ] Cold calling session changes broadcast correctly
- [ ] Subscription cleanup on unmount (no memory leaks)

### 14.6. File Storage Validation

- [ ] All avatars load correctly in UI
- [ ] Recordings play/download correctly
- [ ] Receipt files accessible
- [ ] New file uploads work
- [ ] Thumbnail generation works for avatars

### 14.7. API Route Validation

- [ ] Email campaign sending works end-to-end
- [ ] Email tracking webhooks (open, click, bounce) work
- [ ] Authenticated API routes validate tokens correctly

### 14.8. Python Agent Validation

- [ ] Instagram outreach agent connects successfully
- [ ] Company creation/update from agent works
- [ ] Event log creation works
- [ ] Lead syncing works

---

## 15. Cutover Plan

### Phase 0: VPS Setup (1-2 days)

1. **Provision Hostinger VPS** with Ubuntu 22.04, 4GB+ RAM
2. Install Docker and Docker Compose
3. Clone Supabase self-hosted repository
4. Generate JWT secrets and API keys
5. Configure `.env` with your domain and SMTP settings
6. Set up Nginx reverse proxy with SSL (Certbot)
7. Start Supabase services and verify all containers running
8. Access Supabase Studio and confirm connectivity
9. Set up automated backups (pg_dump cron job)
10. Configure UFW firewall rules

### Phase 1: Development (1-2 weeks)

1. Set up Supabase schema on your VPS instance
2. Rewrite `packages/pocketbase-client` to use Supabase
3. Update `apps/dashboard` auth contexts and data fetching
4. Update `apps/insta-outreach-agent` Python client
5. Update all API routes
6. Run all tests against your self-hosted Supabase

### Phase 2: Staging (3-5 days)

1. Run full data migration to your Hostinger VPS Supabase
2. Run file storage migration to Supabase Storage
3. Full end-to-end testing (auth, realtime, file uploads)
4. Performance testing (especially queries with joins vs expands)
5. Test VPS resource usage under load (monitor with `htop`, `docker stats`)
6. Fix any issues found

### Phase 3: Production Cutover (1 day)

1. **Announce maintenance window** to all users
2. **Set PocketBase to read-only** (or take it down)
3. Run final data export from PocketBase
4. Run data import to production Supabase on VPS
5. Run file migration to Supabase Storage on VPS
6. Update all environment variables to point to `https://supabase.yourdomain.com`
7. Deploy updated code
8. Run validation checks
9. **Announce migration complete**
10. Monitor VPS resources and logs for 48 hours

### Phase 4: Cleanup (1 week after)

1. Remove PocketBase dependency from `package.json`
2. Remove `pocketbase` npm package
3. Rename `packages/pocketbase-client` to `packages/supabase-client`
4. Remove Python `httpx`-based PocketBase client
5. Update CLAUDE.md and documentation
6. Keep PocketBase backup for 30 days as safety net
7. Decommission PocketBase server

### Self-Hosted Maintenance Considerations

- **VPS Monitoring:** Set up monitoring (e.g., Uptime Kuma, Netdata) for your Hostinger VPS
- **Docker Updates:** Periodically update Supabase images: `docker compose pull && docker compose up -d`
- **SSL Renewal:** Certbot auto-renews, but verify cron is running
- **Disk Space:** Monitor `/opt/supabase` and PostgreSQL data directory
- **Database Backups:** Verify daily backups are running and test restoration
- **Security Updates:** Keep Ubuntu packages updated: `apt update && apt upgrade`

---

## 16. Rollback Plan

If critical issues are found after cutover:

1. **Immediate (< 1 hour):** Revert environment variables to PocketBase URLs, redeploy previous code version
2. **Data sync needed (1-24 hours):** Any data created in Supabase during cutover needs to be exported and imported back to PocketBase
3. **Full rollback:** Restore PocketBase from pre-migration backup, revert all code changes

### Safeguards

- Keep PocketBase running (read-only) for 1 week after cutover
- Take a full Supabase backup before making any post-migration changes
- Keep the pre-migration git branch tagged: `git tag pre-supabase-migration`

### Self-Hosted Specific Recovery

If your Hostinger VPS has issues:

1. **Container crash:** `docker compose restart` or `docker compose up -d`
2. **Database corruption:** Restore from pg_dump backup in `/opt/supabase/backups/`
3. **VPS down:** Hostinger support / restore from VPS snapshot
4. **SSL issues:** `certbot renew --force-renewal && systemctl reload nginx`
5. **Disk full:** Clear old backups, docker prune: `docker system prune -a`

**Emergency restore from backup:**
```bash
# Stop services
cd /opt/supabase/supabase/docker
docker compose down

# Restore database
gunzip -c /opt/supabase/backups/db_YYYYMMDD_HHMMSS.sql.gz | \
  docker exec -i supabase-db psql -U postgres -d postgres

# Restart services
docker compose up -d
```

---

## Appendix A: PocketBase to Supabase Filter Syntax Cheat Sheet

| PocketBase Filter | Supabase Equivalent |
|-------------------|---------------------|
| `field = "value"` | `.eq('field', 'value')` |
| `field != "value"` | `.neq('field', 'value')` |
| `field > 5` | `.gt('field', 5)` |
| `field >= 5` | `.gte('field', 5)` |
| `field < 5` | `.lt('field', 5)` |
| `field <= 5` | `.lte('field', 5)` |
| `field ~ "partial"` | `.ilike('field', '%partial%')` |
| `field = true` | `.eq('field', true)` |
| `a = "1" && b = "2"` | `.eq('a', '1').eq('b', '2')` |
| `a = "1" \|\| b = "2"` | `.or('a.eq.1,b.eq.2')` |
| `relation.field = "x"` | Use join: `.select('*, relation(*)').eq('relation.field', 'x')` |
| `@request.auth.id` | `auth.uid()` (in RLS) or `supabase.auth.getUser()` (in client) |

## Appendix B: Package Changes Summary

```diff
# apps/dashboard/package.json
- "pocketbase": "^0.21.0"
+ "@supabase/supabase-js": "^2.x"
+ "@supabase/ssr": "^0.5.x"

# packages/pocketbase-client/package.json
- "pocketbase": "^0.21.0"
+ "@supabase/supabase-js": "^2.x"

# apps/insta-outreach-agent/requirements.txt
- httpx
+ supabase
```

## Appendix C: Files That Need Changes

| File | Change Type |
|------|-------------|
| `packages/pocketbase-client/src/index.ts` | Full rewrite (SDK wrapper) |
| `apps/dashboard/src/lib/pocketbase.ts` | Replace with `supabase.ts` |
| `apps/dashboard/src/contexts/auth-context.tsx` | Auth methods + token handling |
| `apps/dashboard/src/contexts/team-presence-context.tsx` | Realtime subscriptions |
| `apps/dashboard/src/contexts/session-context.tsx` | Realtime subscriptions |
| `apps/dashboard/src/contexts/follow-up-context.tsx` | Polling (optional: switch to realtime) |
| `apps/dashboard/src/lib/api-auth.ts` | Server-side auth validation |
| `apps/dashboard/src/app/api/email-send/campaign/route.ts` | HTTP calls to Supabase client |
| `apps/dashboard/src/app/api/email-tracking/*.ts` | HTTP calls to Supabase client |
| `apps/dashboard/src/app/login/page.tsx` | Auth method calls |
| `apps/dashboard/src/app/register/page.tsx` | Auth method calls |
| `apps/insta-outreach-agent/src/core/pocketbase_client.py` | Full rewrite |
| `apps/insta-outreach-agent/src/core/pocketbase_sync.py` | Update to use Supabase |
| All components using `pb.files.getUrl()` | Update to Supabase Storage URLs |
| All components using `pb.collection().subscribe()` | Update to Supabase Realtime |
| `.env.local` / `.env.production` | Environment variable changes |

## Appendix D: Self-Hosted Supabase on Hostinger VPS - Troubleshooting

### Common Issues & Solutions

#### 1. Container Won't Start

```bash
# Check logs
docker compose logs supabase-db
docker compose logs supabase-auth

# Common fix: permissions issue
sudo chown -R 999:999 /opt/supabase/supabase/docker/volumes/db/data
```

#### 2. Auth Not Working (401 Errors)

```bash
# Check if JWT_SECRET matches in all services
docker exec supabase-auth env | grep JWT

# Regenerate API keys if needed (must match JWT_SECRET)
node generate-keys.js  # Use same JWT_SECRET
```

#### 3. Realtime Subscriptions Not Working

```bash
# Check realtime container
docker compose logs supabase-realtime

# Ensure table is added to replication
docker exec supabase-db psql -U postgres -c "ALTER PUBLICATION supabase_realtime ADD TABLE your_table;"

# Check WebSocket connection in browser devtools
# Should connect to: wss://supabase.yourdomain.com/realtime/v1/
```

#### 4. Storage Uploads Failing

```bash
# Check storage container
docker compose logs supabase-storage

# Check disk space
df -h

# Verify storage volume permissions
ls -la /opt/supabase/supabase/docker/volumes/storage/
```

#### 5. SSL Certificate Issues

```bash
# Test SSL
curl -I https://supabase.yourdomain.com

# Force renewal
sudo certbot renew --force-renewal

# Check Nginx config
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

#### 6. Database Connection Issues

```bash
# Test direct connection
docker exec supabase-db psql -U postgres -c "SELECT 1;"

# Check if PostgREST can connect
docker compose logs supabase-rest

# Verify POSTGRES_PASSWORD matches everywhere
```

#### 7. High Memory Usage

```bash
# Check container stats
docker stats

# Reduce PostgreSQL memory (edit docker-compose.yml)
# Add under supabase-db:
#   environment:
#     - POSTGRES_SHARED_BUFFERS=256MB
#     - POSTGRES_EFFECTIVE_CACHE_SIZE=512MB

# Restart after changes
docker compose down && docker compose up -d
```

#### 8. Slow Queries

```bash
# Enable query logging
docker exec supabase-db psql -U postgres -c "ALTER SYSTEM SET log_min_duration_statement = 1000;"
docker exec supabase-db psql -U postgres -c "SELECT pg_reload_conf();"

# Check slow queries
docker exec supabase-db tail -f /var/log/postgresql/postgresql-*.log
```

### Useful Commands

```bash
# View all container logs
docker compose logs -f

# Restart a specific service
docker compose restart supabase-auth

# Enter PostgreSQL shell
docker exec -it supabase-db psql -U postgres

# Check container resource usage
docker stats --no-stream

# Update Supabase (pull latest images)
cd /opt/supabase/supabase/docker
docker compose pull
docker compose up -d

# Full restart (caution: brief downtime)
docker compose down && docker compose up -d

# Backup database now
docker exec supabase-db pg_dump -U postgres postgres > /opt/supabase/backups/manual_backup.sql
```

### Hostinger VPS Specific Notes

1. **SSH Access:** Use Hostinger hPanel to manage SSH keys
2. **Firewall:** Hostinger may have additional firewall rules in hPanel
3. **Resource Limits:** Monitor via Hostinger hPanel or `htop`
4. **Support:** Hostinger support can help with VPS-level issues (not Docker/Supabase)
5. **Snapshots:** Create VPS snapshots before major updates via hPanel
6. **Domain DNS:** Configure A record pointing to VPS IP in Hostinger DNS manager
