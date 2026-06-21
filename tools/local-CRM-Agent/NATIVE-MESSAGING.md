# CRM Agent — Chrome Native Messaging host

The agent doubles as a Chrome **Native Messaging** host so the Lead Scraper
extension (`tools/chrome-extension/extension`) can trigger recording on Zoom **web
phone** calls. The desktop client path is handled locally (the agent's audio /
window monitors detect Zoom.exe calls and auto-record), but a web-phone call
plays inside the browser, so the agent can't see it on its own — the extension
is the only thing that knows the call started, and it reaches the agent through
this host.

## Why Native Messaging (not a localhost socket)

Chrome's Local Network Access rollout gates page→localhost, and an HTTPS page
talking to `ws://localhost` is mixed-content-blocked. Native Messaging sidesteps
both and authenticates the caller by extension ID via `allowed_origins`.

## How it works

```
Zoom web call (browser)
  → extension content script detects start/end + dialed number
  → background.js: chrome.runtime.connectNative('com.tableturnerr.crm_agent')
  → Chrome launches LocalCrmAgent.exe with the extension origin in argv
  → agent runs in RELAY mode (NativeMessagingHost.Run), NOT the tray app
  → relay forwards to the already-running tray agent over ws://127.0.0.1:9876
  → tray agent records the call exactly like a desktop call, then uploads the
    clip to GHL via the worker (see RECORDING-UPLOAD.md)
```

The relay tags the forwarded `startRecording` with `channel:"web"` so the upload
is labelled and the minted callId is distinct from desktop calls.

`Program.Main` checks `NativeMessagingHost.IsNativeMessagingLaunch(args)` first
(Chrome appends `chrome-extension://<id>/` to argv). In relay mode it does **not**
take the single-instance mutex or start any services — it just bridges stdin/stdout
to the running agent's WebSocket, launching the tray agent first if it isn't up.

## Protocol mapping

The extension sends the frozen START/STOP shapes (architecture plan §4); the relay
translates them to the agent's existing WebSocket commands:

| Extension → host | Forwarded to agent WS |
|------------------|-----------------------|
| `{type:"START", callId, repUserId, channel:"web", phoneE164, connectTsMs}` | `{type:"startRecording", phoneNumber: phoneE164}` |
| `{type:"STOP", callId, endTsMs}` | `{type:"stopRecording"}` |
| `{type:"PING"}` | (host replies `{type:"PONG"}`) |

The agent attributes the recording to a contact by `phoneNumber` at upload time,
so the web path needs no dashboard `clientCallId`.

## Registration (automatic)

`StartupRegistrar.EnsureNativeMessagingHost()` runs on every launch (alongside the
Run-key and `crm-agent://` protocol registration) and is idempotent:

- **Manifest:** `%AppData%\CrmAgent\com.tableturnerr.crm_agent.json` — written with
  the current exe path. Lives outside the install folder so it survives tool-manager
  updates that replace the install dir.
- **Registry pointers** (per-user):
  - `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.tableturnerr.crm_agent`
  - `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.tableturnerr.crm_agent`

Both default values point at the manifest file.

## Extension ID

Pinned to `jmedgkieldhfccjpjeafmgenaidchbmg` (derived from the `key` in the
extension's `manifest.json`). It is the only origin in `allowed_origins`. If the
Chrome Web Store ever assigns a different published ID, update
`StartupRegistrar.ExtensionId`.

## Testing it

1. Run the agent (tray icon appears).
2. Confirm the manifest exists at `%AppData%\CrmAgent\com.tableturnerr.crm_agent.json`
   and the two registry keys point at it.
3. Load the extension unpacked, place a Zoom web-phone call.
4. Watch `%AppData%\CrmAgent\native-host.log` for `START` / `STOP` lines, and the
   tray agent's recording indicator. A clip should appear in the upload queue.

If nothing happens, the extension's service-worker console logs
`CRM Agent native port closed: <reason>` when the host can't be launched.
