# Email Marketing System — Implementation Plan

## Context

The CRM currently has no native email sending capability. Emails are only referenced as a call outcome ("Send Email") and tracked as a channel in the `interactions` collection. This plan adds a full Email Marketing sector — campaigns, templates, sequences, analytics, and compliance — seamlessly integrated with the existing CRM design language and PocketBase backend.

**Email Service: Resend** — Simple HTTP API callable from PB hooks via `$http.send` (same pattern as `discord_cron.pb.js`). No SDK needed, webhook support for bounces/complaints, generous free tier.

---

## Database Schema Additions (10 New Collections)

All added to `packages/pocketbase-client/pb_db_schema.json`. Plus `do_not_contact` (bool) field on existing `companies` collection.

| Collection | Purpose | Key Fields |
|---|---|---|
| `email_templates` | Reusable email designs | name, subject, html_body, json_body (Tiptap), preview_text, category, created_by |
| `email_campaigns` | Campaign orchestration | name, template (rel), subject, html_body, json_body, status (draft/scheduled/sending/sent/paused/cancelled), campaign_type (one_time/ab_test), audience_list (rel→email_lists), exclusion_list (rel), scheduled_at, sent_at, counters (sent/delivered/opened/clicked/bounced/unsubscribed), ab_variant, ab_parent (self-rel), ab_split_pct, ab_winner_metric |
| `email_lists` | Audience segments | name, list_type (static/dynamic/suppression), filter_json (dynamic rules), company_ids (static), cached_count |
| `email_recipients` | Per-recipient send status | campaign (rel), company (rel), email_address, status (pending→sent→delivered→opened→clicked→bounced→unsubscribed), tracking_id (UUID), open_count, click_count, timestamps, personalization_data (snapshot) |
| `email_sequences` | Drip campaign definitions | name, status, trigger_type (manual/status_change/new_company/tag_added), trigger_config (JSON), stop_on_reply, stop_on_status_change, stop_statuses, audience_list (rel) |
| `email_sequence_steps` | Steps within a sequence | sequence (rel), step_order, template (rel), delay_days, delay_hours, send_window_start/end, subject/body overrides |
| `email_sequence_enrollments` | Per-company enrollment state | sequence (rel), company (rel), status (active/completed/stopped_reply/stopped_status/stopped_manual), current_step, next_send_at, enrolled_at |
| `email_events` | Granular event log | recipient (rel), enrollment (rel), company (rel), event_type (sent/delivered/opened/clicked/bounced/unsubscribed/complained), event_data (JSON), ip_address, user_agent |
| `email_unsubscribes` | Suppression registry | company (rel), email_address, reason, source (link_click/manual/bounce/complaint), campaign (rel) |

---

## Tracking System

- **Open tracking**: 1x1 transparent GIF via `GET /api/email-tracking/open/[trackingId]` — records event, increments counter, returns GIF with `Cache-Control: no-store`
- **Click tracking**: All links rewritten to `GET /api/email-tracking/click/[trackingId]?url=[base64]` — records event, 302 redirects to original URL
- **Unsubscribe**: Direct link to `GET /api/email-tracking/unsubscribe/[trackingId]` — renders confirmation page, POST processes it, sets `do_not_contact=true`
- **Bounce webhook**: `POST /api/email-tracking/webhook` receives Resend events, validates signature, updates recipient status

## A/B Testing

1. Parent campaign creates two variant children (A & B) via `ab_parent` relation
2. `ab_split_pct` determines audience split (e.g., 10% A, 10% B, 80% held back)
3. PB cron checks every 30 min — after 4h minimum, compares winner metric (open_rate or click_rate)
4. Winner's content sent to remaining 80%

## Sequence Engine

- PB cron every 5 min: finds active enrollments where `next_send_at <= NOW()`, sends current step, advances
- Trigger hooks on `companies` status change auto-enroll matching sequences
- Reply detection via `interactions` hook: inbound email → stops enrollment if `stop_on_reply=true`

## Personalization

- `{{Variable_Name}}` syntax with smart fallbacks: `{{Owner_Name|Valued Partner}}`
- Variables sourced from company record at send time, snapshot stored in `personalization_data`

---

## 5 Agent Workstreams

### Agent 1: Foundation Layer (DB Schema, Types, Shared Utilities, Navigation)

**Purpose**: Build the data layer, shared utilities, and navigation so all other agents have stable types and helpers.

**Files to CREATE**:
- `apps/dashboard/src/lib/email-types.ts` — All TypeScript interfaces (EmailTemplate, EmailCampaign, EmailList, EmailRecipient, EmailSequence, EmailSequenceStep, EmailSequenceEnrollment, EmailEvent, EmailUnsubscribe) + EMAIL_COLLECTIONS constant
- `apps/dashboard/src/lib/email-personalization.ts` — `resolveVariables(template, company)` with `{{Var|fallback}}` support, `getAvailableVariables()` returning variable list with descriptions
- `apps/dashboard/src/lib/email-html-utils.ts` — `injectTrackingPixel()`, `rewriteLinks()`, `wrapInEmailLayout()` (responsive email wrapper), `generatePreviewText()`

**Files to MODIFY**:
- `packages/pocketbase-client/pb_db_schema.json` — Add 10 new collections + `do_not_contact` field on companies
- `apps/dashboard/src/lib/types.ts` — Add email collection names to COLLECTIONS constant, add `do_not_contact` to Company type
- `apps/dashboard/src/components/sidebar.tsx` — Add "Email Marketing" nav section with sub-items: Campaigns, Templates, Lists, Sequences, Analytics (use Mail icon from lucide-react)

**Implementation Order**:
1. PocketBase schema (all 10 collections + companies modification)
2. TypeScript types file
3. Personalization engine
4. HTML utilities (tracking pixel injection, link rewriting, responsive wrapper)
5. Sidebar navigation update
6. COLLECTIONS constant update in types.ts

---

### Agent 2: Templates & Email Editor UI

**Purpose**: Build the template library, Tiptap-based email editor, and preview system.

**Components to CREATE** (`apps/dashboard/src/components/email/`):
- `template-card.tsx` — Grid card for template library (name, category badge, preview thumbnail, clone/edit/delete actions)
- `template-editor.tsx` — Tiptap-based email editor extending existing block-editor pattern, with email-specific extensions (button block, image block, divider, columns) and `{{variable}}` insertion via `{` trigger or slash command
- `template-preview.tsx` — Desktop/mobile toggle preview using iframe sandbox, renders actual variable data from a selected company record
- `variable-inserter.tsx` — Dropdown/popover showing all available CRM variables with descriptions, triggered by `{` key or toolbar button
- `send-test-modal.tsx` — Modal to send test email to typed-in address with variable preview

**Pages to CREATE** (`apps/dashboard/src/app/(dashboard)/email/`):
- `layout.tsx` — Shared layout for email section
- `page.tsx` — Email Marketing hub/overview with quick stats and recent campaigns
- `templates/page.tsx` — Template library grid with category filter and search
- `templates/[id]/page.tsx` — Template editor page (edit existing)
- `templates/new/page.tsx` — New template page

**Implementation Order**:
1. Variable inserter component
2. Template editor (Tiptap with email extensions + variable insertion)
3. Template preview (desktop/mobile toggle with live variable rendering)
4. Template card component
5. Send test modal
6. Email layout + hub page
7. Template library page
8. Template editor/new pages

**UI Conventions to Follow**:
- `'use client'` at top of all pages
- `useAuth()` hook for auth check
- `pb` from `@/lib/pocketbase` for data
- Skeleton loading states (match `dashboard-skeletons.tsx`)
- CSS variables for colors (never hardcoded)
- `lucide-react@0.468.0` for icons
- Extend existing `block-editor` patterns from `src/components/block-editor/`

---

### Agent 3: Campaigns & Audience Management UI

**Purpose**: Build campaign builder wizard, audience/list management, and suppression UI.

**Components to CREATE** (`apps/dashboard/src/components/email/`):
- `campaign-builder.tsx` — Multi-step wizard: (1) Name & Subject, (2) Select/Edit Template, (3) Choose Audience & Exclusions, (4) Review & Schedule/Send
- `audience-picker.tsx` — Select existing list or create inline dynamic/static list
- `schedule-picker.tsx` — Date/time picker for scheduled sends or "Send Now"
- `ab-test-setup.tsx` — Configure A/B variants (subject/body) and split percentage
- `list-builder.tsx` — Dynamic filter builder (status, source, date range, has_email, exclude do_not_contact) with live count preview
- `list-members-table.tsx` — Table showing companies in a list with email, status columns
- `suppression-manager.tsx` — View/manage unsubscribes and do_not_contact entries

**Pages to CREATE** (`apps/dashboard/src/app/(dashboard)/email/`):
- `campaigns/page.tsx` — Campaign list with status tabs (Draft, Scheduled, Sent, All)
- `campaigns/new/page.tsx` — New campaign wizard (uses campaign-builder)
- `campaigns/[id]/page.tsx` — Campaign detail: stats dashboard + recipient table
- `lists/page.tsx` — Audience lists management
- `lists/[id]/page.tsx` — List detail with member table and filter editor

**Implementation Order**:
1. List builder component (dynamic filter UI)
2. List members table
3. Suppression manager
4. Lists pages (list + detail)
5. Audience picker component
6. Schedule picker + A/B test setup
7. Campaign builder wizard
8. Campaign pages (list, new, detail)

**UI Conventions to Follow**:
- `'use client'` at top of all pages
- `useAuth()` hook for auth check
- `pb` from `@/lib/pocketbase` for data
- Skeleton loading states (match `dashboard-skeletons.tsx`)
- CSS variables for colors (never hardcoded)
- `lucide-react@0.468.0` for icons
- `SearchInput`, `ColumnSelector` for table pages

---

### Agent 4: Sequences, Analytics & CRM Integration UI

**Purpose**: Build the sequence/drip builder UI, analytics dashboard, and email activity integration on company profiles.

**Components to CREATE** (`apps/dashboard/src/components/email/`):
- `sequence-builder.tsx` — Visual step editor with drag-to-reorder, delay config, trigger selection, template selection per step
- `sequence-step-card.tsx` — Card for each step showing template name, delay, send window
- `enrollment-table.tsx` — Table of enrolled companies with status, current step, next send time
- `campaign-stats-cards.tsx` — Stats cards row (sent, delivered, opened, clicked, bounced, unsubscribed) using existing `stats-card.tsx` pattern
- `campaign-chart.tsx` — Recharts line/bar chart for campaign performance over time (reuse patterns from `cash-flow-chart.tsx`)
- `email-activity-feed.tsx` — Component for company profile pages showing email timeline (opens, clicks, sends)

**Pages to CREATE** (`apps/dashboard/src/app/(dashboard)/email/`):
- `sequences/page.tsx` — Sequences list with status filter
- `sequences/[id]/page.tsx` — Sequence builder page
- `analytics/page.tsx` — Aggregate analytics dashboard (overall send volume, open/click trends, top campaigns, bounce rates)

**Files to MODIFY**:
- `apps/dashboard/src/app/(dashboard)/companies/[id]/page.tsx` — Add "Email Activity" tab showing email history for that company (using email-activity-feed component)

**Implementation Order**:
1. Sequence step card component
2. Sequence builder (visual editor with drag-to-reorder)
3. Enrollment table
4. Sequences pages (list + builder)
5. Campaign stats cards
6. Campaign chart (Recharts)
7. Analytics page
8. Email activity feed component
9. Company profile integration (add Email Activity tab)

**UI Conventions to Follow**:
- `'use client'` at top of all pages
- `useAuth()` hook for auth check
- `pb` from `@/lib/pocketbase` for data
- Skeleton loading states (match `dashboard-skeletons.tsx`)
- CSS variables for colors (never hardcoded)
- `lucide-react@0.468.0` for icons
- `stats-card` for metrics display
- Recharts patterns from `cash-flow-chart.tsx` and `expense-breakdown-chart.tsx`

---

### Agent 5: Backend Logic (API Routes, PB Hooks, Sending Engine)

**Purpose**: Build all server-side logic — tracking endpoints, PB crons for sending/scheduling/sequences/A/B, webhook processing.

**API Routes to CREATE** (`apps/dashboard/src/app/api/`):
- `email-tracking/open/[trackingId]/route.ts` — GET returns 1x1 transparent GIF, records open event in `email_events`, increments `email_recipients.open_count`, sets `opened_at` if first
- `email-tracking/click/[trackingId]/route.ts` — GET with `?url=` param, records click event, 302 redirects to decoded URL
- `email-tracking/unsubscribe/[trackingId]/route.ts` — GET renders simple unsubscribe confirmation HTML page; POST processes unsubscribe (creates `email_unsubscribes` record, sets `do_not_contact=true` on company, updates recipient status)
- `email-tracking/webhook/route.ts` — POST receives Resend webhook events (delivery, bounce, complaint), validates signature, maps to recipient, updates status. Hard bounces set `do_not_contact=true`
- `email-send/route.ts` — POST accepts `{to, subject, html, trackingId, fromName?}`, calls Resend API via fetch, returns `{success, messageId}`. Used for test sends from UI.
- `email-send/campaign/route.ts` — POST accepts `{campaignId}`, triggers campaign send (resolves audience, creates recipients, queues sends). For immediate sends from UI.

**PocketBase Hooks to CREATE** (`packages/pocketbase-client/`):
- `email_campaign_sender.pb.js` — Cron every 1 minute:
  - Finds campaigns with `status='scheduled'` AND `scheduled_at <= NOW()`
  - Sets status to `'sending'`
  - Resolves audience list (evaluates dynamic filters or static IDs)
  - Excludes: `do_not_contact=true`, entries in exclusion_list, entries in `email_unsubscribes`
  - Creates `email_recipients` records
  - For each recipient: resolves personalization variables, injects tracking pixel, rewrites links, sends via `$http.send` to Resend API
  - Rate limiting: 10 emails/second batch with delays
  - Updates campaign counters, sets status to `'sent'`
  - Creates `interactions` records (channel: 'email', direction: 'outbound') for CRM timeline

- `email_sequence_engine.pb.js` — Cron every 5 minutes:
  - Finds active enrollments where `next_send_at <= NOW()`
  - For each: looks up current step, checks send window, re-checks suppression
  - Sends email (same personalization + tracking as campaigns)
  - Advances `current_step`, computes `next_send_at` from next step's delays
  - If no next step: sets status to `'completed'`

- `email_sequence_triggers.pb.js` — Record hooks:
  - `onRecordAfterUpdateRequest('companies')`: On status change, checks for matching active sequences with `trigger_type='status_change'`. Auto-enrolls if criteria match and company has email + not suppressed.
  - `onRecordAfterCreateRequest('companies')`: Checks for `trigger_type='new_company'` sequences.
  - `onRecordAfterCreateRequest('interactions')`: If `channel='email'` AND `direction='inbound'`, stops active enrollments where `stop_on_reply=true`.

- `email_ab_resolver.pb.js` — Cron every 30 minutes:
  - Finds A/B parent campaigns where both variants sent, no winner decided
  - Waits minimum 4 hours after send
  - Compares `ab_winner_metric` between variants
  - If difference < 2%, waits up to 24h then picks better one
  - Winner's content sent to remaining held-back audience

- `email_analytics_cache.pb.js` — Cron every 15 minutes:
  - Recomputes aggregate stats on sent campaigns (open_rate, click_rate from event counts)
  - Updates `cached_count` on dynamic email_lists by evaluating their `filter_json`

**Implementation Order**:
1. Tracking API routes (open pixel, click redirect, unsubscribe page)
2. Webhook route (Resend event processing)
3. Email send API route (for test sends + direct sends)
4. Campaign sender PB hook (the core sending engine)
5. Sequence engine PB hook
6. Sequence trigger hooks (auto-enroll, auto-stop on reply)
7. A/B resolver PB hook
8. Analytics cache PB hook
9. Interaction integration (creating timeline entries on send)

**Environment Variables Required**:
- `RESEND_API_KEY`
- `EMAIL_FROM_ADDRESS` (e.g., `crm@yourdomain.com`)
- `EMAIL_FROM_NAME` (e.g., `Tableturnerr CRM`)
- `RESEND_WEBHOOK_SECRET` (for webhook signature validation)
- `NEXT_PUBLIC_APP_URL` (already exists — used for tracking URLs)

---

## Dependency & Merge Strategy

```
Agent 1 (Foundation)       Agent 2 (Templates)      Agent 3 (Campaigns)      Agent 4 (Sequences)     Agent 5 (Backend)
====================       ==================       ===================      ==================      ==================
pb_db_schema.json          template-card.tsx         campaign-builder.tsx     sequence-builder.tsx    API routes (tracking)
email-types.ts             template-editor.tsx       audience-picker.tsx      sequence-step-card.tsx  API routes (send)
email-personalization.ts   template-preview.tsx      schedule-picker.tsx      enrollment-table.tsx    PB hooks (5 files)
email-html-utils.ts        variable-inserter.tsx     ab-test-setup.tsx        campaign-stats-cards.tx
sidebar.tsx                send-test-modal.tsx       list-builder.tsx         campaign-chart.tsx
types.ts                   email/layout.tsx          list-members-table.tsx   email-activity-feed.tsx
                           email/page.tsx            suppression-manager.tsx  analytics/page.tsx
                           templates/* pages         campaigns/* pages        sequences/* pages
                                                     lists/* pages            companies/[id] update
```

**Merge order**: Agent 1 first (provides types/schema). Then Agents 2, 3, 4, 5 in any order (all independent of each other).

**No file conflicts**: Each agent owns distinct files. Agents 2-5 all import types from Agent 1's `email-types.ts`. No two agents touch the same file.

**Parallel start**: All 5 agents can start simultaneously. Agents 2-5 work against the documented interfaces. When Agent 1 merges, they import from the canonical location.

---

## Verification Plan

1. **Schema**: Import `pb_db_schema.json` into PocketBase admin, verify all 10 collections created with correct fields/relations
2. **Sidebar**: Navigate dashboard, confirm "Email Marketing" section appears with all sub-links
3. **Templates**: Create a template with Tiptap editor, save, verify it appears in library grid, edit and re-save
4. **Variable insertion**: Type `{{` in template editor, verify variable dropdown appears with CRM fields
5. **Preview**: Toggle desktop/mobile preview, verify variables render with actual company data
6. **Lists**: Create a dynamic list with filter (e.g., status="Cold No Reply"), verify member count matches
7. **Campaign**: Create campaign → select template → select audience → schedule → verify status changes
8. **Test send**: Use test send button, verify email arrives at test address with correct variables
9. **Tracking**: Open test email, verify open event recorded. Click link, verify click event + redirect works
10. **Unsubscribe**: Click unsubscribe link, verify confirmation page, verify `do_not_contact` set on company
11. **Sequences**: Create 3-step sequence with delays, manually enroll a company, verify steps fire at correct intervals
12. **Auto-stop**: Create inbound email interaction for enrolled company, verify sequence stops
13. **A/B test**: Create A/B campaign, verify split sends, verify winner selection after threshold
14. **Analytics**: View campaign dashboard, verify open/click/bounce rates display correctly
15. **Company profile**: Check email activity tab on a company that received campaigns
