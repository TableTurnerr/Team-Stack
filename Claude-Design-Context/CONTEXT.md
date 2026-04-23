# Tableturnerr CRM — Design Context

> Context packet for a complete dashboard redesign by Claude Design. Pairs with `./screenshots/`.

---

## 1. Product in one paragraph

**Tableturnerr CRM** is an internal, multi-tenant sales CRM built by Tableturnerr to run its own B2B outbound motion: selling SaaS to independent restaurant owners across North America. It unifies **cold calling** (with Zoom Phone + a local Windows agent that event-captures call state via WASAPI and records system audio), **AI call transcription** (Gemini 2.5 Flash), **Instagram DM outreach**, **email marketing** (campaigns, sequences, templates, suppression), **lead scraping** from Google Maps (Chrome extension), and **financial tracking** (bank accounts, categorized transactions, cash flow). It is not sold to third parties — it is the operational backbone for the in-house sales team.

- **Current version:** v2.6 (shown in sidebar)
- **Stack:** Next.js 15 + React 19 + Tailwind CSS 4 + Lucide icons + PocketBase (SQLite backend)
- **Deploy model:** self-hosted PocketBase behind Cloudflare Tunnel; dashboard runs on HTTPS (even locally)
- **Scale:** small team (~5 active users visible in sidebar), ~230 company records, ~1,290 dials across ~34 sessions of history in demo data

## 2. Users & roles

Three roles exist in the schema (`admin`, `operator`, `member`) and they gate visibility heavily:

| Role | Typical persona | What they spend time on |
|---|---|---|
| **Member / Operator** (SDR) | Sales rep making calls all day | `/session` (live cold calling), `/cold-calls` (log + transcripts), `/companies` (pipeline), `/follow-ups`, `/notes` (scripts, objection handling) |
| **Admin** | Founder / sales manager | Everything above + `/email` (campaigns), `/financial` (P&L), `/team`, `/goals`, `/session-logs` analytics |

The test account used for screenshots is a **Member** — so `/email`, `/financial`, `/team` return the **Access Denied** screen (see note in section 5). A redesign should treat these as first-class admin-only surfaces, not edge cases.

## 3. Core workflows (what the UI must serve)

1. **Dial-through workflow** — Rep opens `/session`, picks *Start Cold Calling Session* or *Standalone Call*, the **Local CRM Agent** (Windows .NET tray app) auto-launches Zoom Phone, WASAPI detects pickup within ~20ms, UI transitions `idle → ringing → connected → ended`. Per-call outcome is tagged (*Not Interested, Callback, Send Email, No Answer, Interested, Bad Lead*), a follow-up can be scheduled, and audio + AI transcript auto-attach.
2. **Pipeline management** — `/companies` is a dense spreadsheet-style grid (230+ rows). Inline editing of *Owner, Status, Email, Website*; status chips stack (a company can be both `Send Email` **and** `Callback`). Bulk operations: column visibility, CSV import/export.
3. **Follow-up cadence** — `/follow-ups` shows a **very overdue-heavy** list (42 overdue in demo) — the pink/red "Overdue by Xd" badges dominate the page. The current design does not help a rep triage *which overdue item to do first*.
4. **Session analytics** — `/session-logs` aggregates dials, pickups, pickup %, pitches, appointments booked per session. Historic performance tracking.
5. **Notes & scripts** — `/notes` houses the cold-call script and objection handling sheet as Tiptap rich-text cards. Reps keep this open while dialing.
6. **Recordings & transcripts** — `/recordings` is a paginated table (45 pages) of auto-uploaded MP3s from the Local Agent; each row has Listen / Download / View Transcript.
7. **Email marketing (admin)** — campaign builder, template editor, sequence/drip builder, suppression, analytics (not captured in screenshots).
8. **Financial tracking (admin)** — bank accounts, transactions, categorization, cash flow charts (not captured).

## 4. Site map

```
/login
/register
/ (Overview — KPI cards + Quick Access + Recent Activity feed)
├── /companies                    Pipeline grid (primary rep surface)
├── /leads                        Unqualified lead intake
├── /cold-calls                   Call log
│   └── (tabs) Call Logs | Phone Numbers
├── /session                      Session launcher (Cold Calling | Standalone)
│   └── active session UI         Live dialer + queue + metrics
├── /session-logs                 Historical sessions table
├── /recordings                   Audio library (Listen / Download / Transcript)
├── /notes                        Rich-text notes (scripts, objection handling)
├── /follow-ups                   Overdue / Upcoming / Completed tabs
├── /email  (admin)               ├── campaigns, templates, lists, sequences, analytics
├── /financial  (admin)           ├── accounts, transactions, categories, cash flow
├── /actors  (coming soon)        Instagram actor accounts
├── /goals   (coming soon)        KPI target tracking
├── /team    (admin)              User management
├── /roles   (admin)              RBAC
├── /recycle-bin                  Soft-deleted records
└── /settings                     Profile | Account | Appearance | Notifications | Preferences | Data & Privacy
```

### Global chrome (always visible)
- **Left sidebar (≈230 px)**: Logo + "Tableturnerr v2.6" → global search (Ctrl+/) → MAIN nav → COMING SOON group → TIME ZONES widget (EST / PST / UTC clocks, user-addable) → TEAM presence strip (avatars + online dot) → Settings → current user card with sign-out.
- **Floating phone bubble (bottom-right)**: persistent call widget; expands into the Zoom Smart Embed dialer with session stats. Draggable, height-adjustable, position persisted to localStorage.
- **Content area**: page header (title + subtitle, action buttons right-aligned) → filters / tabs row → main data surface (table, cards, or split pane).

## 5. Screenshots (in `./screenshots/`)

| File | Route | Notes |
|---|---|---|
| `01-overview.png` | `/` | KPI cards (My Calls, My Sessions, Total Dials, Follow-Ups), Quick Access shortcuts, Recent Activity feed grouped by type (SESSION / FOLLOW-UP / CALL). |
| `02-companies.png` | `/companies` | Dense pipeline table, 230 rows, Add/Columns/Export/Import/Refresh toolbar, stacked status chips, numbered row gutter, pagination 1–25 of 230. |
| `03-cold-calls.png` | `/cold-calls` | Call log table. Filters/Export/Columns/Refresh. Outcome chips colored by sentiment (red=Not Interested, green=Interested, yellow=Callback, blue=Send Email, gray=No Answer). Shows caller avatar per row. |
| `04-session.png` | `/session` | Two-card launcher: *Start Cold Calling Session* (black CTA) vs *Make Standalone Call* (outlined CTA). Blue spark/phone icons. Tiny "Start a test session" escape hatch. |
| `05-session-logs.png` | `/session-logs` | Historical sessions table with inline progress bars for pickup %. Top KPI row: Total Sessions 34, Total Dials 1290, Total Pickups 848, Avg Pickup Rate 69%. |
| `06-follow-ups.png` | `/follow-ups` | Dominated by pink "Overdue" rows. Tabs: Overdue / Upcoming / Completed / Dismissed. KPI row at top. *Bulk assign follow-ups* button top-right. |
| `07-notes.png` | `/notes` | Card layout. Active / Archived / Deleted tabs. Currently two notes: "Owner Script V.8" and "Objection Handling Master Sheet." |
| `08-recordings.png` | `/recordings` | Recordings table, 45 pages. Listen / Download / View Transcript per row. "Recorded by CRM Agent" provenance label. |
| `09-settings.png` | `/settings` | Vertical tab nav: Profile / Account / Appearance / Notifications / Preferences / Data & Privacy. Profile photo + display name + email + role (read-only). |
| `11-email.png` | `/email` | Email Marketing hub. Top KPIs (Templates / Campaigns / Sent / Emails Sent). 5 large entry-point cards: Templates, Campaigns, Audiences, Sequences, Analytics. Recent Campaigns + Recent Templates feeds. |
| `12-email-templates.png` | `/email/templates` | Category filter pills (All / Welcome / Follow-up / Promotion / Newsletter / Re-engagement / Other) + search + template cards with body preview, author, date. |
| `13-email-campaigns.png` | `/email/campaigns` | Campaign list with status filter pills (All / Draft / Scheduled / Sending / Sent). Each card shows name, status, subject preview, template used, datetime. |
| `14-email-lists.png` | `/email/lists` | Audience Lists with Dynamic / Static / Suppression filter pills. Card shows list type chip, contact count, last updated. |
| `15-email-sequences.png` | `/email/sequences` | Drip campaign list (All / Active / Paused). Empty state with envelope icon + "No sequences found" copy. |
| `16-email-analytics.png` | `/email/analytics` | 6-KPI grid (Sent / Delivered / Opened / Clicked / Bounced / Unsubscribed). Time-series chart "Email Performance" with colored legend. Top Campaigns by Open Rate list. 7d / 14d / 30d range toggle. |
| `17-financial.png` | `/financial` → Overview tab | **Highest design-density page in app.** Top strip: currency toggle (USD / PKR), range (30d / 60d / 90d), More dropdown, 3 prominent CTAs (Upload Invoice blue, +Income green, +Expense red), Export. 3-column summary (Total Balance with approval chips, This Month Income, This Month Expenses). Savings Rate / Pending Revenue / Pending Income row. Cash Flow line chart (4 series) + Expense Breakdown donut chart. End-of-Month Forecast + Recent Transactions cards. |
| `18-financial-transactions.png` | `/financial` → Transactions | Flat transaction list. Each row: category chip + description + date + amount (green = income, red = expense). Pending vs. cleared distinction via background tint. |
| `19-financial-accounts.png` | `/financial` → Accounts | Per-account cards (Rs211,121.92 + Rs40,000 → combined $900.24). **Categories manager**: colored dot + name + Expense/Income/Both chip + amount + edit/delete. Includes nested sub-categories (External Team Wages → Design & Social Media / Other). |
| `20-financial-recurring.png` | `/financial` → Recurring | Empty state for subscriptions/repeating transactions. |
| `21-financial-partnerstack.png` | `/financial` → PartnerStack | 3-KPI row (Total Earnings / Total Paid Out / Pending Rewards). Rewards table with status chips (Pending / Paid / Declined). Payout History section. |
| `22-team.png` | `/team` | 6 member cards in a 3-column grid. Each card shows avatar + name + email + role chip(s) (Admin / Member). **LIVE badge + Active Session panel** (Dials / Pickups / Appts counters + "End Session" button) appears on currently-calling members. Static stats row per card: Calls, DMs. "Active Xm ago" presence footer. |
| `23-roles.png` | `/roles` | Left panel: 3 roles (Admin 4, Manager 0, Member 2) with colored dot + user count. Right panel: empty state "Select a role to edit or create a new one" + Create Role button. |
| `28-roles-permissions.png` | `/roles` → Admin selected | **4-tab role editor**: Display (name + 12-swatch color picker + custom hex + live preview) / Permissions / Members / Data Access. Preview card shows how the role chip will render. Preview button top-right. |
| `24-actors.png` | `/actors` | Instagram Actors page. Empty state with red Instagram icon. Columns / Refresh toolbar. |
| `25-goals.png` | `/goals` | "Coming Soon" placeholder with bullseye icon and "Goals module — feature is currently under development" copy. |
| `26-recycle-bin.png` | `/recycle-bin` | Tabs: All / Companys / Phone Numbers / Call Logs / Sessions. Empty state + info banner "Items are automatically permanently deleted after 30 days." |
| `27-overview-admin.png` | `/` (admin) | Same as 01 but Quick Access chips re-ordered (Email Marketing, Call Session, Team, Financial, Cold Calls, Companies). Sidebar now includes *Overview* group (Financial Overview, Team Overview sub-items) and *Email Marketing*. |
| `29-email-campaign-builder.png` | `/email/campaigns/new` | 4-step horizontal progress wizard: **Details → Template → Audience → Review & Send**. Step 1: Campaign Name, Subject Line (with `{{variable}}` hint), A/B Test toggle. Save Draft / Next footer. |
| `30-email-template-editor.png` | `/email/templates/new` | Template editor. Header: Template Name + Category dropdown + Test Send / Save Template CTAs. Editor / Preview tab toggle. Subject Line + Preview Text (0/150 char counter). Formatting toolbar (B/I/U/S, link, H1/H2/H3, hr, Variables dropdown). Large blank body area. |

**Minor route notes:** `/leads` redirects to `/companies` (unified lead+company model). `/goals` is a "Coming Soon" placeholder. `/actors` exists but is empty — Instagram outreach module is skeletoned.

## 6. Current design language

Observed from the screenshots — things a redesign should deliberately keep, evolve, or discard.

- **Palette**: near-white page background (`~#F7F7F8`), white cards, true-black primary CTA (`#000`), neutral gray text. Accent colors used sparingly and only for status semantics (green = interested / completed, red = not interested / overdue, blue = informational / email, yellow/amber = callback pending, gray = neutral / no-answer).
- **Typography**: single sans (appears to be Inter or system). Page title ≈22–24 px semibold, body 14 px, helper text 12 px muted.
- **Shape language**: 12–16 px radius cards, 8 px radius buttons/chips, 1 px hairline borders (`~#E5E7EB`), soft shadows only on floating elements (dialer, modals).
- **Icons**: Lucide throughout. Stroked, 16–20 px, muted gray.
- **Density**: tables are information-dense (Companies fits 25 rows in a viewport) — reps expect this. Do not inflate row height for aesthetic reasons; they will push back.
- **Status chip pattern**: chips stack vertically inside a cell when multiple statuses apply — this is load-bearing and must survive the redesign.
- **Empty/denied states**: currently a generic shield-X card with "Access Denied". Feels hard; a redesign could soften role gating with "request access" flow.
- **Time zones widget**: EST / PST / UTC clocks in the sidebar. Unusual; the team clearly relies on this for picking dialing windows. Keep it, but could move to a more useful position (e.g., per-company timezone indicator).

## 6b. Admin-surface observations (from screenshots 11–30)

- **Email Marketing is the most internally-complex module.** Five sub-surfaces (Templates / Campaigns / Lists / Sequences / Analytics) plus a 4-step wizard for campaign creation and a full Tiptap-style editor for templates. The hub page uses a *hero-tile* pattern for the 5 entry points — visually decent but inconsistent with the rest of the app, which does not use hero tiles anywhere else. A redesign should decide whether to standardize tile-style hubs or retire them.
- **Email template editor is minimal.** Variable insertion via a dropdown, basic inline formatting only, no blocks / layouts / media. Design proposal could argue for either keeping it plain-text-ish (intentional — cold outreach looks spammy when over-designed) **or** bringing it to parity with the Notes page (which already has a richer Tiptap block editor with slash commands).
- **Financial Overview is the design-densest page in the app.** Currency toggle (USD/PKR/More), date range toggle, 3 primary CTAs (Upload Invoice / +Income / +Expense) with distinct colors (blue/green/red), 3-column summary, savings-rate/pending row, two charts (line + donut), forecast card, recent-transaction list — all above the fold. The color-coded CTAs are bolder than anywhere else in the app. Risk: this page looks like it was designed by someone else. Opportunity: use this page to set the bar for *information density done well*, then normalize back to the rest of the app.
- **Team page doubles as live presence monitor.** Admin-only, but functionally the closest thing to a "manager floor view" — LIVE badge, session metrics, End Session button. A redesign could lean into this and make it a proper real-time dashboard (who's dialing, who's talking, recent outcomes ticker).
- **Roles editor is unexpectedly polished.** 4-tab editor (Display / Permissions / Members / Data Access), 12-color swatch + custom hex, live chip preview. This is the most designed single component in the product. It should inform the rest of the app's visual language.
- **Recent Transactions** in the Financial page mixes USD and PKR in the same list (`-Rs780.5` next to `-$5,000`) — currency handling is load-bearing and the redesign must not lose it.
- **Categories UI on Accounts tab** uses colored dots + sub-category indentation — a color-coded taxonomy that could be reused elsewhere (lead statuses, follow-up priorities).
- **Sequences + Goals + Actors are mostly empty-state today.** Redesign gets to define the empty-state pattern here; current empty states are muted gray icon + one-line label, which reads as "nothing built yet" rather than "ready for first entry."
- **"Coming Soon" chip** on Goals is a separate design pattern the rest of the app should adopt consistently for skeleton surfaces.

## 7. Pain points / opportunities for redesign

Observed directly from the screenshots — these are the most likely places design improvement pays off.

1. **Follow-ups page is an overdue graveyard.** 42 overdue items in pure pink with no visual hierarchy — no way to tell *which one* to call right now. Missing: priority scoring, last-contact recency, owner timezone, grouping by status or by suggested time-to-dial.
2. **Overview is under-utilized.** KPIs are bare counts ("3 calls") with no trend, no goal progress, no comparison to yesterday. The Recent Activity feed is the most valuable thing on the page but gets half the real estate. A redesign could invert this.
3. **Companies table is the workhorse but flat.** No visual pipeline (kanban) view toggle, no saved segments/views, no bulk actions surfaced. Status chips are useful but read as label soup when stacked.
4. **Cold-calls and recordings are near-identical tables.** Could merge or cross-link — currently a rep has to context-switch between two tables to go from "this call" → "its recording + transcript."
5. **Session launcher is polished but low-frequency.** Two big cards for a choice that's made once a day — this screen could compress to a single-step "Start session" with standalone as a subordinate option, freeing space for a pre-call briefing (today's queue, last-session recap).
6. **Sidebar groups `Cold Calls` oddly.** Expanding it reveals *Cold Calls, Call Session, Recordings, Session Logs* — which are four distinct noun/verb concepts. An IA pass could re-cluster around *Do* (Session), *Review* (Cold Calls, Recordings, Session Logs), *Reference* (Notes).
7. **Mobile responsiveness appears unaddressed.** Data tables assume ≥1280 px. Reps are desktop-bound, but mobile triage of follow-ups + quick call-back is an obvious extension.
8. **Access-Denied dead-ends.** Role-gated routes go to a generic denial screen instead of degrading gracefully (e.g., showing summary tiles with locked details, or offering "request admin review").
9. **No dark mode in evidence** despite Appearance tab existing.
10. **Floating phone bubble** is small and easy to miss — yet it's the single most-used control in the app. A redesign could make the call widget a peer of the sidebar, not a floater.

## 8. Constraints the redesign must respect

- **Next.js 15 / React 19 / Tailwind 4** stack; Lucide icons already in use — reuse, don't introduce a second icon system.
- **PocketBase schema is authoritative** (`packages/pocketbase-client/pb_db_schema.json`). Fields like `call_outcome` enums, `status` enums, role enums are fixed — redesign cannot invent new statuses without a schema migration.
- **Zoom Phone Smart Embed iframe** must fit inside the dialer widget (fixed min-size — Zoom defines it).
- **Persistent call state context** (`phone-context.tsx`) means the dialer widget must be globally mounted; it cannot be a per-route component.
- **Event log provenance**: many rows display "Recorded by CRM Agent" or attribute actions to specific users — audit trail is a first-class visual element and should survive the redesign.
- **Existing Playwright E2E suite (127 tests)** asserts on user-facing text and data-testids — the redesign should either preserve key selectors or budget for test updates.

## 9. Suggested "hero" screens for a design proposal

If Claude Design returns only three redesigned screens, these give the highest leverage:

1. **`/` Overview** — the daily launchpad. Prove the new design language on KPIs + activity feed + next-best-action.
2. **`/companies`** — the information-dense workhorse. Prove the new design handles dense tables, stacked chips, inline editing, and a possible kanban toggle.
3. **`/follow-ups`** — the highest-pain screen. Prove the new design can turn a flat overdue list into prioritized, actionable work.

A fourth bonus: the **floating dialer + active call UI** — it's the single highest-frequency interaction surface in the app.
