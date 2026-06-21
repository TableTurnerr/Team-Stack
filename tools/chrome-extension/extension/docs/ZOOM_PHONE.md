# Zoom Phone for GoHighLevel

This document covers the client-side workaround that replaces GoHighLevel's built-in
LeadConnector (LC Phone) dialer with Zoom Phone. The feature is implemented entirely
inside the extension with no backend changes.

---

## Why this exists

GoHighLevel has no official Zoom Phone integration. LC Phone is the default dialer and
there is no built-in way to route calls through Zoom instead. This feature intercepts
click-to-call events on GHL pages and hands them off to the Zoom desktop client via a
custom URL scheme, so every call goes through Zoom Phone rather than LC Phone.

GHL runs the same web app on many different domains. Known hosts (`*.gohighlevel.com`,
`*.leadconnectorhq.com`, and `ghl.tableturnerr.com`) are declared as static match
patterns in `manifest.json`. Other white-label installs run on arbitrary agency-branded
domains. The extension handles both with a combination of static host declarations, asset
fingerprinting, and a user-editable custom-domain list.

---

## Architecture

```
GHL page (any host)
  |
  +-- ghl_enhancements.js (content script)
  |     - detects GHL environment
  |     - intercepts click events (capture phase)
  |     - injects CSS to hide LC Phone widget
  |     - injects dark-mode palette (when enabled)
  |     - dispatches zoomphonecall:// via hidden iframe
  |
  +-- background.js
  |     - dynamic injection for white-label domains
  |     - reads gmes_ghl_domains list
  |
  +-- zoom_phone_settings.js (popup Settings panel)
        - reads / writes all gmes_zoom_* and gmes_ghl_* keys
        - no backend calls; all state is chrome.storage.local
```

The feature has no server component. It reads settings from `chrome.storage.local` on
every page load and operates entirely in the browser.

---

## Host detection

The content script decides whether it is running on a GHL page using three methods,
evaluated in order:

1. **Static hosts** — `manifest.json` declares `*.gohighlevel.com`,
   `*.leadconnectorhq.com`, and `ghl.tableturnerr.com` as known match patterns. The
   content script is injected automatically on these.

2. **Asset fingerprinting** — on any other host, the script checks whether the page has
   loaded LeadConnector or `msgsndr` assets (JS/CSS URLs containing those strings). If
   it finds them, it treats the page as a GHL white-label install.

3. **Custom domain list** — the user can add arbitrary domains to `gmes_ghl_domains` in
   Settings. `background.js` reads this list and calls `chrome.scripting.executeScript`
   to inject the content script dynamically when a matching tab navigates.

If none of the three methods matches, the content script exits without doing anything.

---

## Click-to-call

### How it works

The content script attaches a single `click` listener in the **capture phase** so it
sees click events before any GHL handler does. When a click lands on a phone number
(plain text or a `tel:`/`callto:` link) or a GHL "Call" button, the handler:

1. Extracts the destination number and normalizes it to E.164.
2. Builds a `zoomphonecall://` URL:
   ```
   zoomphonecall://+15551234567
   zoomphonecall://+15551234567?callerid=+15557654321
   ```
3. Creates a transient hidden `<iframe>` pointing at that URL, appends it to
   `document.body`, then removes it after a short delay. The iframe triggers the OS URL
   scheme handler without navigating the page or opening a new tab.
4. Calls `event.preventDefault()` and `event.stopPropagation()` to suppress the
   original action.

### Why `zoomphonecall://` instead of `tel:`

Using `tel:` or `callto:` would let the OS default handler decide what to open (often
the system dialer or a different VoIP app). The `zoomphonecall://` scheme is registered
exclusively by the Zoom desktop client, so it always targets Zoom Phone.

### Caller ID

When `gmes_zoom_caller_id` is set (E.164 string), it is appended as the `callerid`
query parameter. Zoom Phone uses this to present a specific number as the outbound
caller ID, matching whatever number the team has configured in their Zoom Phone account.

### Hard requirement: Zoom desktop client

The Zoom desktop client must be installed and logged in on the machine. When
`zoomphonecall://` fires and Zoom is running, Zoom auto-dials the number. When Zoom
is not installed, the OS shows a "no application can open this link" prompt and
nothing dials.

### Launching Zoom when it's closed

Zoom does not have to be already open. Firing `zoomphonecall://` launches the Zoom
desktop client if it's installed but not running: the OS starts the registered protocol
handler, then hands it the number to dial. The only requirements are that Zoom is
installed (so the scheme is registered) and logged in (so it can place the call).

The rough edge is a cold start. When Zoom launches from fully closed, the very first call
can occasionally arrive before Zoom Phone has finished starting and may open the dialer
without auto-dialing. The optional **Pre-launch Zoom on GHL pages** setting
(`gmes_zoom_prewarm`, default OFF) mitigates this: when on, the content script opens the
Zoom client (via `zoomus://zoom.us/`) on the user's first interaction with a GHL page, so
Zoom is already warm by the time a number is clicked. A real user gesture is required
(Chrome blocks gesture-less external-protocol launches), so the warm-up fires on the first
`pointerdown`, at most once per page load. It is best-effort: if `zoomus://` is not
registered the warm-up quietly does nothing and normal dialing is unaffected.

The browser shows a one-time "Open Zoom?" prompt the first time any Zoom scheme fires.
Ticking "Always allow" silences it for future calls. The extension cannot dismiss this
prompt for you, it is a browser security gate.

---

## Disabling LC Phone

When `gmes_zoom_hide_lc` is ON, the content script injects a `<style>` block that hides
the LeadConnector dialer widget via CSS selectors targeting its container elements. It
also intercepts any programmatic call triggers the LC Phone widget fires natively.

The exact selectors are tuned against the current GHL UI. GHL updates its front end
without notice, so these selectors may need adjustment when the widget markup changes.
When LC Phone reappears after a GHL update, inspect the widget container in DevTools,
find the new selector, and update `ghl_enhancements.js`.

---

## Settings and storage keys

All keys live in `chrome.storage.local`. The Zoom Phone settings are managed by
`zoom_phone_settings.js` in the popup's Settings panel.

| Key | Type | Default | Purpose |
|---|---|---|---|
| `gmes_zoom_enabled` | bool | ON | Master switch for the entire dialer replacement. When OFF, the content script exits on GHL pages without intercepting anything. |
| `gmes_zoom_click_to_call` | bool | ON | Make displayed phone numbers and Call buttons Zoom-clickable. |
| `gmes_zoom_hide_lc` | bool | ON | Inject CSS to hide the LeadConnector dialer widget and intercept its native triggers. |
| `gmes_zoom_prewarm` | bool | OFF | Open the Zoom client on first interaction with a GHL page so a cold-start call connects on the first try. |
| `gmes_zoom_caller_id` | string | `""` | Outbound caller ID passed to Zoom as `?callerid=` (E.164 format, e.g. `+15557654321`). Leave blank to let Zoom use its own default. |
| `gmes_ghl_domains` | string[] | `[]` | Custom white-label GHL domains for dynamic injection (e.g. `["ghl.tableturnerr.com"]`). |

These toggles are independent of the extension's main power switch. The GHL
enhancements run whenever you are on a detected GHL page, regardless of whether the
scraper itself is active.

---

## Implementation files

| File | Role |
|---|---|
| `ghl_enhancements.js` | Content script: detection, click interception, LC hiding |
| `zoom_phone_settings.js` | Popup Settings section: reads/writes all `gmes_zoom_*` and `gmes_ghl_*` keys |
| `manifest.json` | Declares static GHL host match patterns for the content script |
| `background.js` | Dynamic injection for white-label domains via `chrome.scripting.executeScript` |

---

## Verification checklist

1. Load the extension unpacked at `chrome://extensions`.
2. Open a GHL page (e.g. `app.gohighlevel.com` or your white-label domain).
3. Confirm the LC Phone dialer widget is no longer visible.
4. Click any displayed phone number or a GHL "Call" button. Zoom should launch and
   auto-dial; you should not be prompted by the system dialer.
5. Add a custom white-label domain to the domain list in Settings, navigate to that
   domain, and confirm the content script runs (LC dialer hidden, click-to-call active).
6. Toggle **Zoom Phone Enabled** OFF, reload the GHL page, and confirm the LC dialer
   reappears and phone links behave normally.

---

## Future: Zoom Smart Embed (not yet built)

The documented next step is an in-browser Zoom Phone softphone inside a Chrome Side
Panel. Instead of handing off to the desktop client, this would load:

```
https://applications.zoom.us/integration/phone/embeddablephone/home?originDomain=chrome-extension://<extension-id>
```

Calls would be initiated via `postMessage`:

```js
iframe.contentWindow.postMessage({
  type: 'zp-make-call',
  data: { number: '+15551234567', callerId: '+15557654321', autoDial: true }
}, 'https://applications.zoom.us');
```

The Side Panel hosts the iframe at the extension's own origin, which sidesteps GHL's
`frame-src` CSP restrictions that would block it if embedded directly in the GHL page.

Prerequisites:
- A Zoom Marketplace app registered with `embeddablephone` permissions.
- The extension origin added to the Zoom app's domain allowlist.
- Zoom Phone licenses on the Zoom account.

References:
- `developers.zoom.us/docs/phone/outbound-call`
- `developers.zoom.us/docs/phone/smart-embed`
- `developers.zoom.us/docs/phone/smart-embed-guide`

---

## Keep this in sync

Any change to a storage key name, a GHL selector, the URL scheme format, or the
dark-mode palette variables should update this file in the same commit.
