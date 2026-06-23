# Google Sheets - "Time Right now" column

Companion Apps Script for the Lead Scraper extension. It shows the **current local
time at each lead's location**, so an SDR can tell at a glance whether it's a sane
hour to call.

## How it resolves each row's timezone

For every row it uses the first method that works:

1. **`TimeZone` column** - the IANA zone the extension exports (e.g. `America/Chicago`).
2. **`Latitude` / `Longitude` columns** - exact, offline lookup.
3. **US state** parsed from the `State` / `Address` / `City` text (e.g. `..., TX 77494`).
4. **Geocode** the `City` / `Address` via Google's Maps service.

If none resolve, the cell is left blank. Because the time is formatted against the
IANA zone name, **daylight-saving is handled automatically** (Central, Eastern,
Arizona-no-DST, etc. are all correct). It works whether or not the sheet has a
`TimeZone` column.

## File

Just one: **[`LocalTime.gs`](./LocalTime.gs)**. It is fully self-contained - the
offline lat/lng → timezone lookup that powers fallbacks #2 and #4 is bundled at the
bottom of the same file, so there is nothing else to paste.

## One-time setup

1. Open your Google Sheet.
2. **Extensions → Apps Script**.
3. Paste the whole of [`LocalTime.gs`](./LocalTime.gs) into `Code.gs` (replace
   whatever is there) and **Save**.
4. Reload the spreadsheet. A **🕒 Local Time** menu appears.
5. **🕒 Local Time → Enable auto-refresh (5 min)** and approve the permissions
   prompt once.

The `Time Right now` column fills in and keeps updating - on open, every 5 minutes,
and via **🕒 Local Time → Refresh now (this tab)**.

## Which tab does it use?

Whichever tab you're **viewing** when you click **Refresh now (this tab)** or
**Enable auto-refresh** - that choice is remembered, so the 5-minute trigger keeps
updating the same tab. (To pin a specific tab regardless, set `SHEET_NAME` in
`CONFIG`.) The new column is added automatically next to `TimeZone`/`Longitude`, or
at the **far right** if you have neither - so scroll right if you don't see it. The
tab needs headers in row 1 and at least one data row.

## Notes

- The script finds columns by header name, not position, so re-imports keep working.
- The geocoding fallback (#4) uses Apps Script's free, quota-limited geocoder and
  caches each location so a given city is looked up at most once. It's skipped on the
  on-open refresh (simple triggers can't make external requests) and fills in on the
  next auto-refresh. Turn it off with `ENABLE_GEOCODE_FALLBACK: false`.
- The US state map (#3) resolves multi-zone states (TX, FL, etc.) to the zone
  covering most of the state - good enough for call-window decisions, not exact for
  edge cities like El Paso. Rows with `Latitude`/`Longitude` get the exact zone via #2.
- Tweak the display format, refresh interval, or target tab in the `CONFIG` block at
  the top of `LocalTime.gs` (e.g. `TIME_FORMAT: 'EEE, MMM d · h:mm a'`). The interval
  must be one of Apps Script's allowed values: 1, 5, 10, 15, or 30 minutes.
