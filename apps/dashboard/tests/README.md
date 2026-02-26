# Dashboard E2E Test Suite

Comprehensive Playwright tests for the CRM Dashboard. Tests cover every major
feature and optionally place **real phone calls** to public test lines to verify
the full Zoom Phone → Recording → Call Log pipeline.

---

## Quick Start

```bash
# 1. Copy and fill in your credentials
cp .env.test.example .env.test
# Edit .env.test with your real values

# 2. Install Playwright browsers (first time only)
npx playwright install chromium

# 3. Make sure Next.js + PocketBase are running
#    In separate terminals:
pnpm dev          # Next.js on :3000
# (PocketBase should already be running on :8090)

# 4. Run all tests
pnpm test

# 5. View the HTML report
pnpm test:report
```

---

## Test Files

| File | What it tests |
|------|--------------|
| `01-auth.spec.ts` | Login, logout, session persistence, error states, auth guards |
| `02-overview.spec.ts` | Dashboard page, stats cards, sidebar navigation, all pages load |
| `03-companies.spec.ts` | Companies table, search, filter, sort, inline edit, column toggle, detail page |
| `04-cold-calls.spec.ts` | Call log table, search, outcome filter, sort, columns, phone numbers tab |
| `05-session.spec.ts` | Session start/pause/resume/end, metrics, recording controls, power dialer, forms |
| `06-session-logs.spec.ts` | Session history, status filter, CSV export, admin mode |
| `07-notes.spec.ts` | Notes CRUD, search, archive, restore, soft-delete, tab switching |
| `08-actors-team-goals.spec.ts` | Actors list/columns, Team page, Goals coming-soon state |
| `09-recordings.spec.ts` | Recordings page, upload modal, file input validation |
| `10-settings.spec.ts` | All 8 settings sections, theme toggle, timezone, notifications, Zoom integration |
| `11-integration.spec.ts` | Cross-component data flow: session→call log, call log→recording, company→history |
| `12-live-call-flow.spec.ts` | **Real phone calls** to public test lines (disabled by default) |

---

## Running Specific Suites

```bash
# Just authentication
pnpm test:auth

# Companies only
pnpm test:companies

# Cold calls + phone numbers
pnpm test:calls

# Notes full CRUD
pnpm test:notes

# Settings page
pnpm test:settings

# Smoke tests only (fastest, ~2 min)
pnpm test -- --grep @smoke

# Interactive UI mode (see tests run in real-time)
pnpm test:ui

# Headed mode (see browser)
pnpm test:headed

# Live call tests (REAL CALLS — use carefully)
pnpm test:headed tests/12-live-call-flow.spec.ts
```

---

## Live Call Testing

The `12-live-call-flow.spec.ts` file dials **real public telecom test lines**
to verify your Zoom Phone integration end-to-end.

### Enable Live Calls

```env
# In .env.test:
TEST_LIVE_CALLS=true
TEST_CALL_DURATION_SEC=10   # seconds to stay on each call
```

### Public Test Numbers

| Number | Location | What it does | Best for testing |
|--------|----------|-------------|-----------------|
| **1 (804) 222-1111** | Richmond, VA | All-in-One menu: echo, DTMF, tone testing | Full feature test |
| **1 (909) 390-0003** | Ontario, CA | Immediately echoes your audio back | Latency / audio quality |
| **1 (800) 444-4444** | Toll-Free | Reads back your Caller ID number | Outbound CLI verification |
| **1 (631) 791-8378** | New York, NY | Standard audio test (CallCentric) | Audio clarity |
| **1 (206) 456-0649** | Seattle, WA | Echo + hold music (IPKall) | Recording quality |

### What the live tests verify

1. **Zoom Phone dialer** — number can be entered and call placed
2. **Call status indicators** — ringing → connected state transitions
3. **Call duration tracking** — ring duration and call duration measured separately
4. **Call log creation** — form submission creates a record in PocketBase
5. **Recording upload** — if auto-record is on, a recording file is stored
6. **Session metrics** — dial count increments after each call
7. **Full session flow** — start session → dial → log → end session → appears in logs

### Prerequisites for live calls

- Zoom Phone desktop app installed and **logged in** on the test machine
- `TEST_LIVE_CALLS=true` in `.env.test`
- Run with `--headed` to monitor calls visually

---

## Test Data Strategy

All test entries use the prefix `TEST_PW_` in their names/notes.
This makes them easy to identify and ensures cleanup never touches real data.

**Cleanup happens automatically** in `afterAll` hooks — any `TEST_PW_*` records
created during the test run are deleted at the end of each test suite.

If a test suite crashes mid-run, you can manually clean up with:

```js
// In PocketBase admin UI, filter by:
company_name ~ "TEST_PW_"
post_call_notes ~ "TEST_PW_"
title ~ "TEST_PW_"
session_notes ~ "TEST_PW_"
```

---

## Configuration

`playwright.config.ts` key settings:

| Setting | Value | Notes |
|---------|-------|-------|
| `workers` | 1 | Sequential — prevents data conflicts |
| `retries` | 1 | Retry flaky tests once |
| `timeout` | 45s | Per test timeout |
| `screenshot` | on failure | Saved to `playwright-report/` |
| `video` | retain-on-failure | Saved to `playwright-report/` |
| `webServer` | `pnpm dev` | Auto-starts Next.js if not running |

---

## Troubleshooting

**"TEST_USER_EMAIL must be set"**
→ Copy `.env.test.example` to `.env.test` and fill in credentials.

**Tests fail with "net::ERR_CONNECTION_REFUSED"**
→ Make sure `pnpm dev` and PocketBase are running before running tests.

**Auth state stale / tests keep redirecting to /login**
→ Delete `tests/.auth/user.json` and re-run (global-setup will re-authenticate).

**Live call tests skip with "LIVE_CALLS is not set"**
→ Set `TEST_LIVE_CALLS=true` in `.env.test` and run with `--headed`.

**Zoom Phone not dialing**
→ Ensure Zoom desktop app is running and `zoom-phone-autodial` localStorage key
is set to your preference. The tests will attempt both the custom overlay and
the Smart Embed iframe.
