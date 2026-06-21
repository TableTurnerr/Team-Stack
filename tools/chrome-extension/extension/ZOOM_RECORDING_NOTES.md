# Zoom web-phone call recording — extension notes

This documents the extension side of the local call-recording feature (Workstreams
E + F from `tools/zoomphone-ghl-bridge/docs/local-recording-architecture-plan.md`). The
extension detects a Zoom **web phone** call starting/ending and tells the local
**CRM Agent** desktop app to start/stop recording over Chrome **Native Messaging**.

## Files

| File | Role |
|------|------|
| `zoom_call_detect_main.js` | MAIN-world content script. Monkey-patches `window.WebSocket` to detect Zoom phone signaling open/close; posts to the isolated script via `window.postMessage`. |
| `zoom_call_detect.js` | Isolated content script. Hybrid detector (WS signal + DOM MutationObserver on the in-call timer / ARIA End/Hang up / Mute control, recursing shadow roots). Captures the dialed number and emits `ZOOM_CALL_STARTED` / `ZOOM_CALL_ENDED`. |
| `ghl_enhancements.js` | Click-to-call now stashes the dialed E.164 number into `chrome.storage.session` (`gmes_zoom_last_dialed`) so the detector can attach it. |
| `background.js` | Native Messaging bridge: relays `ZOOM_CALL_*` to the agent as `START` / `STOP`. Also grants content scripts session-storage access. |
| `manifest.json` | Adds the `nativeMessaging` permission, the two Zoom content scripts, and a `key` for a stable extension ID. |
| `zoom_phone_settings.js` / `popup.html` | "Record Zoom calls" toggle (default ON), key `gmes_zoom_record_calls`. |

## Extension ID (`<EXT_ID>`)

The `key` field in `manifest.json` pins the extension ID so the agent's native
host manifest can allow it regardless of how the extension is loaded (unpacked,
zip, or store).

```
EXT_ID = jmedgkieldhfccjpjeafmgenaidchbmg
```

This ID is derived from the public `key` in `manifest.json`. To re-derive it from
the key (sanity check):

```bash
# echo the base64 "key" value, then:
echo "<KEY_BASE64>" | base64 -d | openssl dgst -sha256 -binary \
  | xxd -p -c 256 | head -c 32 | tr '0-9a-f' 'a-p'
```

If the published store ID ever differs (Chrome Web Store can assign its own ID),
read the real ID from `chrome://extensions` and update the agent's native host
manifest `allowed_origins` accordingly. The `key` keeps unpacked/dev installs
stable so day-to-day development doesn't churn the ID.

> The private key that generated this public key is **not** stored in the repo.
> It is only needed to repackage a `.crx` with this exact ID; for unpacked loads
> the `key` field alone fixes the ID. Keep the private key in the team secrets
> store if `.crx` packaging is ever required.

## Native Messaging host (installed by the CRM Agent, Workstream G)

The agent's installer must register a Native Messaging host manifest so Chrome
can launch it. The host name **must** match what `background.js` connects to:

```
host name: com.tableturnerr.crm_agent
```

Windows registry key (per-user):

```
HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts\com.tableturnerr.crm_agent
  (Default) = C:\Path\To\com.tableturnerr.crm_agent.json
```

The JSON manifest it points at:

```json
{
  "name": "com.tableturnerr.crm_agent",
  "description": "TableTurner CRM Agent — local call recorder",
  "path": "C:\\Program Files\\TableTurner\\CrmAgent\\crm_agent.exe",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://jmedgkieldhfccjpjeafmgenaidchbmg/"
  ]
}
```

The trailing slash in `allowed_origins` is required. For Edge, register under
`HKCU\SOFTWARE\Microsoft\Edge\NativeMessagingHosts\...` as well.

## Message contracts (frozen — do not rename fields)

Emitted by `background.js` to the agent (plan §4):

```jsonc
// on detected call start
{ "type": "START", "callId": "web:<repUserId>:<connectTsMs>",
  "repUserId": "<string>", "channel": "web",
  "phoneE164": "+1XXXXXXXXXX" | null,
  "counterpartyName": "<string>"?,   // omitted when unknown
  "connectTsMs": 1718800000000 }

// on detected call end
{ "type": "STOP", "callId": "web:<repUserId>:<connectTsMs>", "endTsMs": 1718800123000 }
```

- `callId` = `"web:" + repUserId + ":" + connectTsMs`.
- `repUserId` resolution (best available; the agent is authoritative and overrides
  it on upload, so this is a routing/label hint): explicit setting
  `gmes_zoom_rep_user_id` → connected CRM email (`gmes_ghl_email`) → a persisted
  random `rep_xxxx` fallback. Provision `gmes_zoom_rep_user_id` to equal the rep's
  Zoom `user_id` for clean correlation with the worker's webhook events.
- `phoneE164` may be `null` (number unknown); the worker handles null as a
  manual-review upload.

## How detection works (and its fragility)

1. **MAIN-world WebSocket timing (primary).** Zoom phone signaling rides a
   WebSocket. We can't read the opaque payloads, but the open/close of the
   call socket brackets the call. `zoom_call_detect_main.js` patches
   `window.WebSocket`, flags sockets whose URL hints at Zoom call/phone
   signaling, and posts `open`/`close`/`activity` to the isolated script.
2. **DOM MutationObserver (fallback).** `zoom_call_detect.js` watches for an
   ARIA-labeled End call / Hang up / Mute control and a ticking `mm:ss` timer,
   recursing open shadow roots. Either sub-signal counts as "in a call".
3. A small state machine debounces both signals (start confirmed after ~1.2s of
   evidence, end after ~4s of no evidence) so transient blips don't flap.

**Fragility points (TUNE blocks are marked in the source):**
- WebSocket URL hints (`CALL_URL_HINTS`) are guesses; verify the real signaling
  socket URL in DevTools on a live web call and tighten/loosen the list.
- ARIA labels / class hints (`INCALL_CONTROL_SELECTORS`, `NUMBER_HINT_SELECTORS`)
  are best-effort against Zoom's obfuscated DOM and may need updating on a Zoom
  release. The two detectors are independent, so a Zoom change that breaks one
  usually leaves the other working.
- The number is most reliable from the click-to-call stash; page-scraped numbers
  are a weaker fallback and may be null.

## Quick manual test

1. Load the extension unpacked; confirm the ID is `jmedgkieldhfccjpjeafmgenaidchbmg`
   on `chrome://extensions`.
2. With the CRM Agent installed (or a stub native host that logs stdin), make a
   web phone call from `app.zoom.us`. The service-worker console should show the
   native port opening and a `START`; hanging up should send `STOP`.
3. Without the agent installed, the port disconnects immediately with
   "native messaging host not found" — by design this is swallowed and nothing
   else breaks.
