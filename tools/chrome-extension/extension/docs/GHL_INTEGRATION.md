# GoHighLevel Integration

This document is the durable in-repo reference for how the extension talks to
GoHighLevel (GHL) through the TableTurnerr backend proxy. It covers the
architecture, the OAuth connect flow, the backend API contract, the
`chrome.storage.local` keys, and the Google Maps item to GHL field mapping.

The GHL Marketplace app registration, OAuth callback, token storage/refresh, and
the `/ghl/*` proxy endpoints live in the **Team-Stack** monorepo's dashboard app
(`apps/dashboard`, the Next.js app serving `crm.tableturnerr.com`). This document is
the contract the extension depends on.

The Marketplace app is a **sub-account (Location) level** app: the user installs it
into one sub-account at a time, and each install returns an OAuth token already
scoped to that single location. There is no agency token and no per-location token
minting. The set of sub-accounts the extension can target is exactly the set the
user has connected (one OAuth install per sub-account).

### Backend implementation (Team-Stack `apps/dashboard`)

| Piece | Path |
|---|---|
| GHL client (per-location OAuth tokens, refresh, API calls) | `src/lib/ghl.ts` |
| Route auth + error helper | `src/lib/ghl-route.ts` |
| OAuth start / callback | `src/app/api/hl/oauth/{start,callback}/route.ts` |
| Status / disconnect | `src/app/api/ghl/{status,disconnect}/route.ts` |
| Locations + per-location reads / send | `src/app/api/ghl/locations/**/route.ts` |
| Connect page (writes `tt_session`) | `src/app/connect/page.tsx` |
| Token storage collection | `ghl_connections` in `packages/pocketbase-client/pb_db_schema.json` (one row per `user` + `location_id`, unique on the pair) |

The proxy reuses the dashboard's PocketBase session: the extension's
`gmes_ghl_session` is the user's PocketBase auth token, validated server-side via
`authenticateRequest` (`src/lib/api-auth.ts`). Per-user GHL OAuth tokens are stored
in `ghl_connections` and read with the superuser admin client. Env vars:
`GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_REDIRECT_URI`, `GHL_STATE_SECRET`.

---

## Architecture

The extension never holds a GHL token. It holds a **TableTurnerr session token**
(`gmes_ghl_session`) captured during the OAuth connect. Every GHL call goes through
the TableTurnerr backend proxy, which holds the GHL OAuth `client_secret` and the
user's GHL tokens and injects them server-side.

```
+-------------------------------+
|  Chrome extension             |
|  (popup / results tab)        |
|                               |
|  holds: gmes_ghl_session      |
|         gmes_ghl_api_base     |
+---------------+---------------+
                |
                |  HTTPS, Authorization: Bearer <gmes_ghl_session>
                v
+-------------------------------+
|  TableTurnerr backend proxy   |
|                               |
|  holds: GHL OAuth client_secret
|         per-(user,location) tokens
|  maps session -> location token
|  injects Version: 2021-07-28  |
+---------------+---------------+
                |
                |  HTTPS, GHL OAuth bearer (server-side only)
                v
+-------------------------------+
|  GoHighLevel API              |
|  services.leadconnectorhq.com |
+-------------------------------+
```

---

## Marketplace app scopes

Create the app with **distribution type: Sub-Account** and enable exactly these
eight OAuth scopes (the source of truth is `GHL_SCOPES` in `src/lib/ghl.ts`):

```
locations.readonly
locations/tags.readonly
locations/tags.write
contacts.readonly
contacts.write
opportunities.readonly
opportunities.write
users.readonly
```

Each scope and what it powers:

| Scope | Why it's needed | GHL endpoints used |
|---|---|---|
| `locations.readonly` | Resolve the sub-account name on connect, and load custom fields for the pickers | `GET /locations/:loc`, `GET /locations/:loc/customFields` |
| `locations/tags.readonly` | Load the existing tags for the tag pickers | `GET /locations/:loc/tags` |
| `locations/tags.write` | Create a new tag from the "+ Create new tag…" option in the tag pickers (sub-account scope; **not** `locations.write`, which is agency-only and manages locations themselves) | `POST /locations/:loc/tags` |
| `contacts.readonly` | Pre-send "Already in GHL" duplicate check, and reading an existing contact's current fields to decide which are still empty | `GET /contacts/search/duplicate`, `GET /contacts/:id` |
| `contacts.write` | Create the contact (new lead) or backfill the empty fields of an existing one and add the chosen tag; attach the pre-call note; delete the contact when a send is undone | `POST /contacts/upsert`, `PUT /contacts/:id`, `POST /contacts/:id/tags`, `POST /contacts/:id/notes`, `DELETE /contacts/:id` |
| `opportunities.readonly` | Populate the pipeline + stage pickers | `GET /opportunities/pipelines` |
| `opportunities.write` | Create the opportunity when enabled; delete it when a send is undone | `POST /opportunities/`, `DELETE /opportunities/:id` |
| `users.readonly` | Populate the assignee picker | `GET /users/search` |

This is the minimal set: every scope maps to a call the extension makes, and no
call needs a scope outside this list. If you drop a `*.readonly` scope the matching
picker comes back empty; if you drop a `*.write` scope the send fails. The scopes
are requested verbatim in the authorize URL, so they must be enabled on the app or
the OAuth consent screen will reject them.

---

## Connect flow

OAuth uses the sub-account (Location) level GHL Marketplace app. The user logs in
to their own GHL and approves the install for one sub-account. No token is ever
shown or pasted. To target more than one sub-account, the user repeats the connect
(the `+` / "Connect another sub-account" action), once per sub-account.

1. User clicks **Connect GoHighLevel** in the popup.
2. The extension opens `https://crm.tableturnerr.com/connect`.
3. The connect page runs the GHL OAuth install for the chosen sub-account.
4. On success, the connect page stores a `tt_session` object in its `localStorage`:
   ```json
   { "token": "<pocketbase session token>", "email": "...", "agency": "...", "apiBase": "https://crm.tableturnerr.com/api" }
   ```
5. The extension polls/reads that tab (the same tab-read mechanism used by the
   previous CRM login) and, when `tt_session` appears, copies it into
   `chrome.storage.local` as `gmes_ghl_session`, `gmes_ghl_email`, and
   `gmes_ghl_api_base`.
6. The connect page writes `tt_session` as soon as the user is logged into the CRM,
   **before** any sub-account is authorized. So the extension saves the session
   right away (to enable `/ghl/*` calls) but keeps polling `GET /ghl/status` and
   leaves the funnel tab open until `connected` is true (at least one sub-account
   linked). Only then does it close the tab it opened (`gmes_ghl_connect_tab`).
   A pre-existing CRM tab the user opened for other work is not tracked, so it is
   never auto-closed.

After connect, all `/ghl/*` calls carry `Authorization: Bearer <gmes_ghl_session>`.

> The redirect URI registered on the GHL Marketplace app must match `GHL_REDIRECT_URI`
> on the backend **exactly** (prod: `https://crm.tableturnerr.com/api/hl/oauth/callback`).
> The callback is served by our own app, so it lives on the domain we control
> (`crm.tableturnerr.com`), not on the GHL instance (`ghl.tableturnerr.com`, which is
> GoHighLevel's own software and only hosts the authorization consent screen).

---

## Backend API contract

Base URL is stored as `gmes_ghl_api_base` (the dashboard sets it to its own origin
plus `/api`, i.e. `https://crm.tableturnerr.com/api`; the paths below are relative to
that, so `/ghl/status` is served by `app/api/ghl/status/route.ts`). Every call sends
`Authorization: Bearer <gmes_ghl_session>` (the user's PocketBase session token,
**not** a GHL token). The backend maps the session to the user's stored GHL OAuth
tokens, mints a per-location token, and adds `Version: 2021-07-28` when forwarding to
`services.leadconnectorhq.com`.

| Method | Path | Returns / Notes |
|---|---|---|
| `GET` | `/ghl/status` | `{ connected, agencyName, email }` (`agencyName` is a summary, e.g. the sole sub-account name or "N sub-accounts") |
| `GET` | `/ghl/locations` | `[{ id, name }]` the sub-accounts the user has connected (not an agency-wide list) |
| `POST` | `/ghl/disconnect` | removes all connections; `?location=<id>` removes one sub-account |
| `GET` | `/ghl/locations/:loc/users` | `[{ id, name, email }]` for the assignee picker |
| `GET` | `/ghl/locations/:loc/pipelines` | `[{ id, name, stages:[{id,name}] }]` |
| `GET` | `/ghl/locations/:loc/tags` | `[{ id, name }]` (tags may also be free-form) |
| `POST` | `/ghl/locations/:loc/tags` | create a tag; body `{ name }`, returns `{ id, name }` (or `{ tag: { id, name } }`). Needs the `locations/tags.write` scope. |
| `GET` | `/ghl/locations/:loc/custom-fields` | `[{ id, name, fieldKey }]` (map rating/reviews/maps link) |
| `GET` | `/ghl/locations/:loc/duplicate?phone=&email=` | `{ exists, contactId }` (pre-send "already in GHL" check) |
| `POST` | `/ghl/locations/:loc/leads` | composite send (below) |
| `DELETE` | `/ghl/locations/:loc/contacts/:id` | undo a send: deletes the contact; optional `?opportunityId=<id>` also deletes its opportunity. Returns `{ success: true }`. Uses `contacts.write` (and `opportunities.write` when an opportunity id is passed). |

### `POST /ghl/locations/:loc/leads`

Request body:

```json
{
  "contact": {
    "companyName": "",
    "phone": "+1XXXXXXXXXX",
    "email": "",
    "address1": "",
    "city": "",
    "state": "",
    "postalCode": "",
    "country": "US",
    "timezone": "America/New_York",
    "website": "",
    "source": "Google Maps - Scraper",
    "tags": [],
    "assignedTo": "<userId|null>",
    "customFields": [{ "id": "", "value": "" }]
  },
  "note": "pre-call note text",
  "opportunity": {
    "create": true,
    "pipelineId": "",
    "stageId": "",
    "name": "",
    "status": "open",
    "monetaryValue": 0,
    "assignedTo": "<userId|null>"
  }
}
```

Response:

```json
{ "contactId": "", "opportunityId": "", "duplicate": false, "status": "created|updated|skipped" }
```

The backend resolves whether the contact already exists (GHL duplicate search,
email-first then phone) and branches:

- **New contact** (`status: "created"`, `duplicate: false`) — `POST /contacts/upsert`
  with the full sanitised contact (tags, custom fields, source), then attaches the
  note and, when requested, creates the opportunity.
- **Existing contact** (`status: "updated"`, `duplicate: true`) — the contact is
  **updated in place by id and never re-created, so no duplicate is added to GHL.**
  The backend reads the current contact (`GET /contacts/:id`), then `PUT /contacts/:id`
  with **only the fields GHL does not already have** — a value GHL already holds is
  left untouched; a blank field is filled from the scraped data. The chosen tag is
  added with `POST /contacts/:id/tags`, which merges (existing tags are kept). The
  pre-call note is attached **only when at least one field was actually backfilled**,
  so re-sending an already-complete lead doesn't pile up identical notes, and **no
  opportunity is created** for an existing contact (backfill only). If the current
  contact can't be read, field updates are skipped entirely rather than risk
  overwriting existing data (the tag is still added).

This keeps the extension thin and the orchestration server-side. Because existing
contacts are matched first and updated by id, the send is safe to re-run: it only
ever fills gaps.

### `DELETE /ghl/locations/:loc/contacts/:id`

Backs the per-lead **Undo** button. After a send, each synced row shows an Undo
control; clicking it calls this endpoint to remove the contact so the row reverts to
an un-synced "Send to GHL" state and can be re-sent.

Optional query param `opportunityId=<id>` — when present, the backend also deletes the
opportunity created alongside the contact. Response: `{ "success": true }`.

```
DELETE /ghl/locations/:loc/contacts/<contactId>?opportunityId=<oppId>
```

Maps to GHL `DELETE /contacts/:id` (`contacts.write`) and, when an opportunity id is
supplied, `DELETE /opportunities/:id` (`opportunities.write`). Both scopes are already
in the app's scope set, so no new scope is required for undo.

---

## Storage keys

All keys live in `chrome.storage.local`.

| Key | Purpose |
|---|---|
| `gmes_ghl_api_base` | Backend base URL (set per-connect to `https://crm.tableturnerr.com/api`) |
| `gmes_ghl_session` | TableTurnerr session token (bearer for all `/ghl/*` calls) |
| `gmes_ghl_email` | Connected account email (display) |
| `gmes_ghl_waiting` | Connect-in-progress flag (polling for the session token) |
| `gmes_ghl_connect_tab` | Tab id of the funnel tab the extension opened; closed once a sub-account is linked, then cleared |
| `gmes_ghl_default_location` | Default sub-account (location) id |
| `gmes_ghl_default_pipeline` | Default pipeline id |
| `gmes_ghl_default_stage` | Default stage id |
| `gmes_ghl_create_opp` | Whether to create an opportunity by default (on/off) |
| `gmes_ghl_default_tag` | Default tag/category |
| `gmes_ghl_default_assignee` | Default assignee user id (empty = Unassigned) |

Caches (with a paired `*_ts` freshness timestamp, TTL-checked against `Date.now()`):

| Key | Purpose |
|---|---|
| `gmes_ghl_locations_cache` | Cached sub-account list |
| `gmes_ghl_users_cache_<loc>` | Cached users per location |
| `gmes_ghl_pipelines_cache_<loc>` | Cached pipelines/stages per location |
| `gmes_ghl_tags_cache_<loc>` | Cached tags per location |

Per-item flags stored on each scraped lead:

| Flag | Purpose |
|---|---|
| `crmSynced` | Lead has been sent to GHL |
| `crmExistingId` | Existing GHL contact id found during dedup |
| `ghlContactId` | GHL contact id from the `/leads` response |
| `ghlOpportunityId` | GHL opportunity id from the `/leads` response |

---

## Field mapping

How a scraped Google Maps `item` maps to the GHL contact/opportunity/note.

| Scraped item field | GHL field | Notes |
|---|---|---|
| `title` | `companyName` | The business name goes in **Company Name only**. No person name is scraped, so `firstName`/`lastName`/`name` are left blank. |
| `phones[0].number` | `phone` | Converted to `+1XXXXXXXXXX` (E.164). Google Maps URLs are skipped, matching the existing website logic. |
| extra `phones[1..]` | custom field / note | Folded into a custom field where available, otherwise appended to the note. |
| `rating` | custom field / note | Mapped by `fieldKey` from `/custom-fields`; falls back to the note. |
| `reviewCount` | custom field / note | `()` stripped. Falls back to the note. |
| `industry` | custom field / note | Falls back to the note. |
| `href` (Maps link) | custom field / note | Falls back to the note. |
| `email` | `email` | |
| `address` | `address1` | |
| `city` | `city` | Cleaned of any trailing state (e.g. "Columbus, OH" → "Columbus"). |
| `state` / parsed from `city` | `state` | Detail-mode scrapes carry a real state from the formal address; otherwise the USPS code is parsed out of the search-query location. |
| `zip` / parsed from `address` | `postalCode` | Detail-mode scrapes carry a real ZIP; the feed-card paths fall back to a best-effort ZIP from the street address (often empty). |
| (derived) | `country` | `"US"` whenever a US state or ZIP was resolved (this is a US-focused, `+1`-phone pipeline). |
| `lat` / `lng` | `timezone` | Best-effort IANA zone from the coordinates (continental longitude bands + AK/HI; Arizona approximates to Mountain). |
| `companyUrl` | `website` | Google Maps URLs are skipped (not treated as a website). |
| `note` | contact note | Sent as the `note` field; attached as a note record on the contact. |
| category | `tags: [tag]` | The chosen category becomes a single GHL tag. |
| assignee | `assignedTo` | The chosen GHL user id; omitted when Unassigned. |
| (constant) | `source` | Always `"Google Maps - Scraper"`. |

---

## Keep this in sync

These docs are part of the definition of done. Any change to a connect flow, a
storage key, or a backend endpoint updates this file and the matching `README.md`
section in the same commit.
