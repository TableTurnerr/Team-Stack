# TableTurner Lead Scraper

A Chrome extension for scraping Google Maps leads and syncing them directly to the TableTurner CRM (PocketBase). Supports both automated scraping and manual browsing modes.

---

## Features

- **Scraping Mode**: Automatically scrape Google Maps search results (title, rating, reviews, phone, industry, city, address, website, Instagram search link, Google Maps link).
- **Food Business Filter**: Optionally filter results to only include restaurants and food-related businesses. Enabled by default.
- **Manual Mode**:
  - **Google Maps Overlay**: When viewing a specific place on Maps, a "Quick Add" overlay appears. Supports auto-popup toggle.
  - **Website Scanner**: Visit any business website and the extension scans for contact info (phones with labels, emails, addresses).
- **CRM Integration**: Send leads directly to PocketBase — creates `companies` and `phone_numbers` records. Checks for duplicates before adding.
- **Lead Category Selection**: Pick a `lead_category` (Owner.com, ChowNow, etc.) every time you send a lead to the CRM. Set a default in CRM Settings; override per-lead in the confirm dialog. Categories are fetched live from PocketBase and cached.
- **Direct Assignment**: Pick a teammate to assign each lead to right from the confirm dialog (`assigned_to`). Assigned leads skip the new-lead pool and go straight to the chosen user. Set a default assignee in CRM Settings or leave blank to send to the unassigned/new-lead pool.
- **Multiple Phone Numbers**: Extracts and stores multiple phone numbers per business, each with a label and location name. All numbers normalized to US format (`1XXXXXXXXXX`).
- **Deduplication**: Prevents duplicate entries by Maps URL (fallback: Title + Address).
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

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **"Load unpacked"** and select the `TT-lead-scraper-extension` folder.
3. Required permissions: `activeTab`, `scripting`, `storage`, `notifications`, `alarms`.

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
1. Click **"Connect to TableTurnerr CRM"** in the popup (or use **Advanced** to enter a PocketBase URL + token manually).
2. Once connected, optionally pick a **Default Lead Category** (Owner.com, ChowNow, etc.) and a **Default Assignee**. Both pre-fill every confirm dialog.
3. On any overlay or in the results table, click **"Send to CRM"**, review the lead in the confirm dialog, optionally change the **Lead Category** and **Assign To** teammate, and click **Confirm & Send**.
4. Choosing a teammate in **Assign To** skips the new-lead pool and writes `assigned_to` directly. Leaving it blank sends the lead unassigned.
5. The overlay will show an **"Already in CRM"** badge if a matching company or phone number already exists in your database.

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
| Expensiveness | `$`, `$$`, etc. extracted from category |
| City | Derived from Maps search or address |
| Address | Street address |
| Website | "Goto Website" link or "Search For Website" |
| Insta Search | Google search link for `{Name} {City} Instagram` |
| Google Maps Link | Direct link to place on Google Maps |
| CRM Status | Sync status — "Synced" or "Send" button |

---

## Phone Number Format

All phone numbers are stored as 11-digit US format: `1XXXXXXXXXX` (e.g., `12125551234`). Numbers found without the country code have `1` prepended automatically. The `+` prefix is never stored.

---

## CRM Integration Details

Connects to your PocketBase instance and writes to several collections in one send:

- **companies** — `company_name`, `company_location`, `google_maps_link`, `google_rating`, `google_reviews_count`, `website`, `industry`, `price_range`, `email`, `source: 'Google Maps'` (or `'Website'`), `contact_source: 'Extension - …'`, `notes`, `status: ['Untouched']`, and (when selected) `lead_category` (relation to `lead_categories`) and `assigned_to` (relation to `users`).
- **phone_numbers** — one record per extracted phone, with `label`, `location_name`, and `location_address`.
- **company_notes** — a `pre_call` note record with the user-entered note (deduped by content).
- **interactions** — an outbound `phone` interaction stamped with the current user, so the lead shows up on the activity timeline.

Lead categories are loaded from `lead_categories` and cached for 5 minutes. Teammates are loaded from `users` and cached the same way. Use the **refresh** button next to either dropdown if the list has changed.

Configure via the **TableTurnerr CRM** panel in the popup.

---

## Food Business Filter

Filters scraped results to include only restaurants and food-related businesses, excluding grocery stores, gas stations, pharmacies, hotels, etc. Toggle on/off in the popup.

---

## Publishing a New Version

1. Update version in `manifest.json` and `version.json`.
2. Update `releaseNotes` in `version.json`.
3. Create distribution zip:
   ```bash
   zip -r TT-lead-scraper-v3.0.zip . -x "*.git*"
   ```
4. Create a GitHub release with tag `v3.0` and upload the zip.

---

## License

MIT
