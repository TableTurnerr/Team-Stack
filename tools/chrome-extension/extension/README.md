# Lead Scraper Extension (GMaps Scraper)

A Chrome extension for scraping Google Maps leads and syncing them directly to GoHighLevel. Supports both automated scraping and manual browsing modes.

> Part of the [CRM-Tableturnerr](../../../README.md) monorepo at `tools/chrome-extension/extension`.
> Packaging, release, and Tool Manager wiring live one level up in
> [`tools/chrome-extension`](../README.md). This was previously the standalone
> `TableTurnerr/GMaps-Scraper` repo, now deprecated.

---

## Features

- **Scraping Mode**: Automatically scrape Google Maps search results (title, rating, reviews, phone, industry, city, address, website, Instagram search link, Google Maps link).
- **Food Business Filter**: Optionally filter results to only include restaurants and food-related businesses. Enabled by default.
- **Manual Mode**:
  - **Google Maps Overlay**: When viewing a specific place on Maps, a "Quick Add" overlay appears. Supports auto-popup toggle.
  - **Website Scanner**: Visit any business website and the extension scans for contact info (phones with labels, emails, addresses).
- **GoHighLevel Integration**: Send leads straight into GHL. Each send creates a **Contact** (name/company, phone, email, address, website, source, tags, custom fields) and an optional **Opportunity** in the pipeline and stage you choose, plus a pre-call **note** on the contact. Duplicate detection runs before each send so the same lead isn't created twice.
- **Sub-Account Picker**: Choose which GHL sub-account (location) a batch goes to. The picker lists every sub-account you've connected (the Marketplace app is sub-account level, so you authorize one sub-account per connect and add more with the **+** button). Selectable per batch from the results tab, with a default set in Settings.
- **Category as Tag**: Pick a category every time you send a lead; it becomes a GHL **tag** on the contact. Set a default in Settings; override per-lead in the confirm dialog.
- **Direct Assignment**: Pick a GHL user to assign each lead to right from the confirm dialog. Maps to the contact's (and opportunity's) `assignedTo`. Defaults to **Unassigned**; set a default assignee in Settings or leave it unassigned.
- **Contact Note**: The note you enter is attached to the GHL contact as a note record.
- **Multiple Phone Numbers**: Extracts multiple phone numbers per business, each with a label and location name. All numbers normalized to US format internally.
- **Deduplication**: Prevents duplicate entries by Maps URL (fallback: Title + Address) in the list, and checks GHL for an existing contact (by phone/email) before sending.
- **Persistence**: Results saved across sessions via `chrome.storage.local`.
- **Keyboard shortcuts**:
  - Open popup: extension action icon (or configurable shortcut).
  - Scrape active Maps tab: `Ctrl+Shift+S`.
  - Toggle Manual Mode Overlay: `Ctrl+Shift+M`.
  - Add to List (Manual Mode): `Alt+Shift+S`.
  - Open Website (Manual Mode): `Alt+Shift+W`.
- **Excel Export**: Export leads to `.xls` with clickable links.
- **Update Notifications**: Automatic checking for new releases.

---

## Installation (Developer)

Most team members install via the **Tool Manager** (it auto-updates the extension). For local
development from source:

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **"Load unpacked"** and select this `tools\chrome-extension\extension` folder. It loads as
   **TableTurner Lead Scraper (dev)** — the committed manifest already carries the dev key, so it
   gets its own extension id and coexists with the Tool Manager release. `dev-build.bat` just prints
   these steps. See [`../README.md`](../README.md#running-dev--release-side-by-side) for details,
   including how Saved Sessions stay shared across the dev and release builds.
3. Edit files in place and click the card's reload icon to pick up changes.
4. Required permissions: `activeTab`, `tabs`, `scripting`, `storage`, `notifications`, `alarms`.

---

## Usage

### Scraping Mode
1. Perform a search on Google Maps (e.g., "Restaurants in Houston").
2. Open the extension popup and click **"Start Scraping"**.
3. Scroll through results; the extension gathers visible listings continuously.
4. Click **"Stop Scraping"** when finished.

### Manual Mode
1. Toggle to **Manual Mode** in the popup.
2. Use the **Auto-Popup toggle** (ON/OFF) to control whether the overlay opens automatically on every place/website visit.
3. Visit a Google Maps place page — the **"Quick Add"** overlay appears.
4. Visit a business website — the **"Contact Info Scanner"** overlay shows all detected phones (with labels), emails, and addresses.
5. Use `Ctrl+Shift+M` to show/hide the overlay at any time.

### CRM Sync
1. Click **"Connect GoHighLevel"** in the popup. This opens the TableTurnerr connect page and runs the GHL OAuth flow. You just log in to your GHL and approve the install for the sub-account you pick. There is no token to copy or paste. To connect more sub-accounts, use the **+** button next to the sub-account selector (or "Connect another sub-account" on the connect page) and approve each one.
2. Once connected, set your defaults in Settings: a **Default Sub-Account**, **Default Pipeline** and **Stage**, **Default Tag/Category**, and a **Default Assignee** (defaults to Unassigned). These pre-fill every send.
3. In the results tab, pick the **Sub-Account** for the current batch (defaults to your Default Sub-Account).
4. On any overlay or in the results table, click **"Send to GHL"**, review the lead in the confirm dialog, optionally change the **Sub-Account**, **Tag/Category**, **Assign To** user, and **Pipeline/Stage**, then click **Confirm & Send**.
5. Choosing a user in **Assign To** sets `assignedTo` on the contact and opportunity. Leaving it on **Unassigned** sends the lead with no assignee.
6. The overlay or row will show an **"Already in GHL"** badge if a matching contact (by phone or email) already exists in the chosen sub-account.

### Exporting
- Click **"Download as CSV"** to export your list as an `.xls` file.
- Click **"Clear List"** to remove all saved items.

---

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Scrape active Maps tab | `Ctrl+Shift+S` |
| Toggle Manual Mode overlay | `Ctrl+Shift+M` |
| Add to list (Manual Mode) | `Alt+Shift+S` |
| Open business website (Manual Mode) | `Alt+Shift+W` |
| Open popup | Click icon (configurable at `chrome://extensions/shortcuts`) |

---

## Table Columns

| Column | Description |
|--------|-------------|
| Title | Place/business name |
| Rating | Star rating |
| Reviews | Numeric review count |
| Phone | Primary phone (`1XXXXXXXXXX` format) + count of additional numbers |
| Industry | Category name (letters only) |
| City | Derived from Maps search or address |
| Address | Street address |
| Website | "Goto Website" link or "Search For Website" |
| Insta Search | Google search link for `{Name} {City} Instagram` |
| Google Maps Link | Direct link to place on Google Maps |
| GHL Status | Sync status — "In GHL" when synced, otherwise a "Send" button |

---

## Phone Number Format

Phone numbers are stored internally in 11-digit US format: `1XXXXXXXXXX` (e.g., `12125551234`). Numbers found without the country code have `1` prepended automatically. When a lead is sent to GHL, the primary phone is converted to E.164 format with a leading `+`, i.e. `+1XXXXXXXXXX` (e.g., `+12125551234`).

---

## GoHighLevel Integration Details

The extension does not talk to the GoHighLevel API directly and never holds a GHL token. It calls a **TableTurnerr backend proxy** that holds the GHL OAuth `client_secret` and tokens and forwards requests to the GHL API (`services.leadconnectorhq.com`) server-side. The extension authenticates to the proxy with a TableTurnerr session token captured during the OAuth connect.

Each send to GHL does the following in one round trip:

- **Contact** — for a **new** lead, creates a contact with the business name in `companyName` (first/last name are left blank — no person name is scraped), `phone` in `+1` E.164 format, `email`, `address1`, and the resolved location fields `city`, `state`, `postalCode`, `country`, and `timezone` (state/ZIP come from the formal address in detail mode or are parsed from the search-query location; timezone is derived from the coordinates), plus `website`, `source` ("Google Maps - Scraper"), `tags` (your category), `assignedTo` (the chosen user, omitted when Unassigned), and `customFields` (rating, reviews, Maps link, industry, price, extra phones, mapped where available; otherwise folded into the note). For an **existing** lead, the contact is updated in place (never duplicated): only the fields GoHighLevel does not already have are filled, a value it already holds is never overwritten, and the chosen tag is added on top of the contact's existing tags.
- **Opportunity** — when enabled, creates an opportunity in the chosen pipeline and stage with `status: "open"` (new contacts only — existing contacts are backfill-only, so re-sending never spawns duplicate opportunities).
- **Contact note** — attaches the pre-call note you entered as a note on the contact (on creation, and when an existing contact actually gained a field, so repeat sends don't pile up identical notes).

Before sending, the extension checks GHL for an existing contact by phone/email and surfaces an "Already in GHL" badge. Sub-accounts (locations), users, pipelines, tags, and custom fields are loaded from the backend and cached per location.

After a lead is sent, its row shows **Update** and **Undo** buttons next to the "In GHL" badge. Update re-sends the lead to fill any fields still empty in GoHighLevel; Undo removes the contact (and its opportunity, if one was created) via `DELETE /ghl/locations/:loc/contacts/:id`, reverting the row so it can be re-sent. The popup's **Send All to GHL** button opens the results tab and launches a review/confirm step that lists new leads and leads already in GHL (whose empty fields are backfilled in place) before anything is sent.

See [`docs/GHL_INTEGRATION.md`](docs/GHL_INTEGRATION.md) for the full backend API contract, storage keys, and field mapping.

---

## Zoom Phone for GoHighLevel

GHL has no official Zoom Phone integration, so the extension includes a client-side workaround. A content script (`ghl_enhancements.js`) intercepts clicks on phone numbers and GHL "Call" buttons and routes them to the Zoom desktop client via the `zoomphonecall://` URL scheme (a transient hidden iframe fires the scheme so the GHL page never navigates). The LeadConnector dialer widget is hidden via injected CSS at the same time.

The feature covers GHL's known hosts (`app.gohighlevel.com`, `app.leadconnectorhq.com`), white-label installs detected by asset fingerprinting, and any custom domains you add in Settings. The Zoom desktop client must be installed and logged in; without it the OS will show a "no app to open this link" prompt instead of dialing.

Settings are independent of the extension's main power switch. Key toggles: **Zoom Phone Enabled** (master switch), **Click-to-Call**, **Hide LC Phone**, **Caller ID** (E.164), and **Custom GHL Domains**. All stored in `chrome.storage.local` under `gmes_zoom_*` / `gmes_ghl_*` keys.

See [`docs/ZOOM_PHONE.md`](docs/ZOOM_PHONE.md) for architecture, all storage keys, selector maintenance notes, and the future Smart Embed (in-browser softphone) plan.

---

## Food Business Filter

Filters scraped results to include only restaurants and food-related businesses, excluding grocery stores, gas stations, pharmacies, hotels, etc. Toggle on/off in the popup.

---

## Publishing a New Version

1. Update version in `manifest.json` and `version.json`.
2. Update `releaseNotes` in `version.json`.
3. Commit and push to `main`. The **Build Lead Scraper Extension** workflow
   (`.github/workflows/build-chrome-extension.yml` at the monorepo root) packages this `extension/`
   folder and publishes a `lead-scraper-v<version>` release into the Team-Stack repo. The Tool
   Manager (and the extension's auto-update checker) pick it up on the next refresh.

---

## License

MIT
