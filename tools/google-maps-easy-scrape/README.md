# Google Maps Easy Scrape

A small Chrome extension that extracts listings from Google Maps Search results into a table you can export. This fork includes deduplication, persistence, keyboard shortcuts, and an HTML->.xls exporter that preserves clickable links in Excel.

---

## Features

- **Scraping Mode**: Automatically scrape Google Maps Search results (title, rating, reviews, phone, industry, expensiveness, city, address, website, Instagram search link, Google Maps link).
- **Restaurant/Food Business Filter**: Automatically filters results to only include restaurants and food-related businesses, excluding grocery stores, gas stations, and other non-food businesses. This is enabled by default.
- **Manual Mode**:
  - **Google Maps Overlay**: When viewing a specific place on Maps, a "Quick Add" overlay appears allowing you to add the business to your list with one click. Requires a mandatory note field.
  - **Website Scanner**: Visit any business website and the extension will automatically scan for contact info (phones, emails, addresses) and provide an overlay to add them to your list.
- **Deduplication**: Automatically prevents duplicate entries by Maps URL (fallback: Title + Address).
- **Persistence**: Results are saved across popup opens and browser restarts via `chrome.storage.local`.
- **Ignore Lists**: Support for remote ignore lists (via Google Apps Script) to filter out chains or specific industries.
- **Keyboard shortcuts**:
  - Open popup: _extension action_ (default: `Ctrl+Shift+Y`).
  - Scrape active Maps tab: `Ctrl+Shift+S`.
  - Toggle Manual Mode Overlay: `Ctrl+Shift+M`.
  - Add to List (Manual Mode): `Alt+Shift+S`.
  - Open Website (Manual Mode): `Ctrl+Shift+G`.
- **Excel Export**: Export your collected leads to an Excel-compatible `.xls` file that preserves clickable links.
- **Update Notifications**: Automatic checking for new releases on GitHub.

## Columns and behavior

- **Title** — place name.
- **Rating** — star rating where available.
- **Reviews** — numeric review counts.
- **Phone** — extracted phone number if present.
- **Industry** — alphabetical-only industry name (e.g. `Pizza restaurant`).
- **Expensiveness** — non-letter characters extracted from the industry cell (only digits, `$`, `-`, en-dash, `+`).
- **City** — derived from the Maps search box or heuristically from the address.
- **Address** — street address where available.
- **Website** — if a company website is present, shows `Goto Website`; otherwise shows `Search For Website`.
- **Insta Search** — a Google search link for `{Title} {City} Instagram`.
- **Google Maps Link** — link back to the place on Google Maps.

## Installation (developer)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **"Load unpacked"** and choose this project folder.
3. Ensure the extension has the required permissions (`activeTab`, `scripting`, `storage`, `notifications`, `alarms`).

## Usage

### Scraping Mode
1. Perform a search on Google Maps (e.g., "Restaurants in Houston").
2. Open the extension popup.
3. Click **"Start Scraping"**. The extension will continuously gather visible results as you scroll.
4. Click **"Stop Scraping"** when finished.

### Manual Mode
1. Toggle to **Manual Mode** in the extension popup.
2. Visit a Google Maps place page; a **"Quick Add"** overlay will appear.
3. Visit a business's own website; the **"Contact Info Scanner"** will appear, highlighting found emails and phones.
4. Use `Ctrl+Shift+M` to show/hide the overlay if it gets in your way.

### Exporting & Cleaning
1. Click **"Download as CSV"** (produces an `.xls` file) to export your list.
2. Click **"Remove Chains"** to filter out businesses based on your ignore list.
3. Click **"Clear List"** to remove all saved items.

## Keyboard shortcuts

- **Scrape active tab**: `Ctrl+Shift+S`
- **Toggle Manual Overlay**: `Ctrl+Shift+M`
- **Add to List (Manual Mode)**: `Alt+Shift+S`
- **Open Website (Manual Mode)**: `Alt+Shift+W`
- **Open Popup**: Configurable in Chrome Extensions Shortcuts (typically `Ctrl+Shift+Y` or click the icon).

**Note:** You can customize all these shortcuts at `chrome://extensions/shortcuts`.

## Implementation notes

- **Manifest**: MV3 with a background service worker (`background.js`).
- **Persistence**: Uses `chrome.storage.local` to share data between scripts.
- **Manual Mode Injection**: The website scanner is injected dynamically when Manual Mode is active on non-Maps pages.

## Restaurant/Food Business Filter

The extension automatically filters scraped results to only include restaurants and food-related businesses. This is designed for use cases like restaurant lead generation where you want to exclude:

- Grocery stores, supermarkets, convenience stores
- Gas stations, liquor stores
- Pharmacies, retail stores
- Hotels, gyms, banks
- And other non-food businesses

The filter includes a comprehensive list of food-related industries (restaurants, cafes, bakeries, pizzerias, etc.) and will include businesses that match any of these categories while excluding businesses that match non-food categories.

This filter is enabled by default to ensure you get only relevant restaurant leads.

## Remove Chains (Ignore list)

The extension can fetch a JSON array or newline-separated list of "chains" or "industries" to ignore.
Example Apps Script return:
```json
{
  "names": ["Subway", "McDonald's"],
  "industries": ["Gas station", "Convenience store"]
}
```

## Publishing a New Version (For Developers)

1. Update version in `manifest.json` and `version.json` (e.g., `1.2`).
2. Update `releaseNotes` in `version.json`.
3. Create a distribution zip:
   ```bash
   zip -r google-maps-easy-scrape-v1.2.zip . -x "*.git*" -x "node_modules/*"
   ```
4. Create a GitHub release with the tag `v1.2` and upload the zip.

## License

MIT — feel free to adapt and reuse.

---