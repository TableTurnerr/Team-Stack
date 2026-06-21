# Local CRM Agent — Rollout & Provisioning Runbook

A step-by-step guide for shipping a new Local CRM Agent build to the whole
sales team and provisioning each rep's Windows machine so their Zoom Phone calls
record locally and upload to GoHighLevel via the `zoomphone-bridge` worker.

This runbook is grounded in the agent's actual code. Key files referenced:

- `src/LocalCrmAgent/Program.cs` — startup wiring, config/env resolution.
- `src/LocalCrmAgent/Services/AgentConfig.cs` — `agent-config.json`, DPAPI encryption.
- `src/LocalCrmAgent/Services/RecordingUploadService.cs` — what uploads, and where.
- `src/LocalCrmAgent/Services/ZoomPhoneApiService.cs` — `zoom-api.json` + call_history resolution.
- `src/LocalCrmAgent/Services/AutoUpdateService.cs` — GitHub-release auto-update.
- `LocalCrmAgent.csproj` — `<Version>` and single-file publish settings.
- `.github/workflows/build-local-agent.yml` — CI publish path.
- `tools/tool-manager/...` — how the Tool Manager picks up and installs releases.

The current build version is **4.0.0** (`<Version>4.0.0</Version>` in
`LocalCrmAgent.csproj`). Reps on the stale **v3.0.8** auto-update to it once the
release is published.

---

## 1. Build & publish

### 1a. What the build produces

`LocalCrmAgent.csproj` is configured for a single-file, self-contained,
`win-x64` build (no .NET runtime needed on the rep's machine):

```xml
<PublishSingleFile>true</PublishSingleFile>
<SelfContained>true</SelfContained>
<RuntimeIdentifier>win-x64</RuntimeIdentifier>
<IncludeNativeLibrariesForSelfExtract>true</IncludeNativeLibrariesForSelfExtract>
<EnableCompressionInSingleFile>true</EnableCompressionInSingleFile>
<Version>4.0.0</Version>
```

The exe carries its version from `<Version>`. `AutoUpdateService` reads the
running build's version via `Assembly.GetExecutingAssembly().GetName().Version`,
so **bump `<Version>` for every release** or no one auto-updates.

### 1b. Build the exe

The `.csproj` already pins `RuntimeIdentifier=win-x64` and the single-file/
self-contained flags, so a plain publish is enough. From `tools/local-CRM-Agent`:

```powershell
dotnet publish src\LocalCrmAgent\LocalCrmAgent.csproj -c Release -o dist
```

Output: `tools\local-CRM-Agent\dist\LocalCrmAgent.exe` (self-contained, ~75 MB).

`build-release.bat` runs exactly this command, then copies `install.bat`,
`uninstall.bat`, and `tool.json` next to the exe and zips the folder to
`dist\LocalCrmAgent-v<version-dashed>.zip`. You can run the script instead of
the raw command:

```powershell
.\build-release.bat
```

> Note: the build copies `zoom-api.json` into the output dir (`<None Update="zoom-api.json">`
> in the `.csproj`). **Do not ship a `zoom-api.json` containing real secrets in
> the release zip.** Provision it per-machine (section 2d). Verify the published
> `dist\zoom-api.json` is the placeholder template (or absent) before publishing.

### 1c. Publish so the team auto-updates (the real rollout)

Two distribution surfaces exist; both pull from GitHub Releases on
**`TableTurnerr/Team-Stack`**. The recommended path is CI:

1. **Bump `<Version>`** in `LocalCrmAgent.csproj` (e.g. to a value greater than
   every rep's current `3.0.8`).
2. **Push the source change to the `release` branch.** The workflow
   `.github/workflows/build-local-agent.yml` triggers on pushes to `release`
   that touch `tools/local-CRM-Agent/src/**`. It:
   - reads `<Version>` from the `.csproj`,
   - skips if a release `local-agent-v<version>` already exists (so you must
     bump the version to publish a new one),
   - runs the same `dotnet publish ... -c Release`,
   - **generates `tool.json`** into the package (note: the CI manifest sets
     `registryAutoStart.args = "--background"`, which the local `tool.json`
     in the repo does not),
   - zips `LocalCrmAgent-v<version>.zip` with `install.bat` + `uninstall.bat`,
   - creates GitHub release **tag `local-agent-v<version>`** with that zip asset.
3. `workflow_dispatch` is also enabled, so you can trigger the build manually
   from the Actions tab without a code push.

**How reps end up on the new version (two independent updaters):**

- **The agent's own auto-update** (`AutoUpdateService`): every running agent
  polls `GET /repos/TableTurnerr/Team-Stack/releases` hourly (30 s after launch,
  then every hour). It looks for tags starting with `local-agent-v`, parses the
  version, and if it is **greater than the running version**, downloads the
  `.zip` asset, extracts it, and swaps `LocalCrmAgent.exe` in place via a
  `LocalCrmAgent_Updater.bat` helper that kills the process, copies the new exe
  (with one retry), and relaunches. So a rep on `3.0.8` silently moves to the
  new version within the hour, no action required.
- **Tool Manager** (`tools/tool-manager`): the team's installer/updater app
  reads the same releases feed, matches tags of the form `<prefix>-v<version>`
  (here `local-agent`), and installs/updates the tool to
  `%LocalAppData%\TableTurnerr\ToolManager\tools\local-crm-agent`. On update it
  kills `LocalCrmAgent.exe`, copies the new files (retrying locked files), and
  re-registers Run-key auto-start, the `crm-agent://` protocol handler, and the
  Start Menu shortcut from `tool.json`, then relaunches the exe with the
  manifest's auto-start args. Reps who manage tools via Tool Manager get the
  update on its next refresh.

> Manual fallback: share `dist\LocalCrmAgent-v<version>.zip`; the rep extracts it
> and runs `install.bat`. The installer is fine for standalone installs but
> Tool Manager / auto-update is the supported path.

**Publish checklist:**

- [ ] `<Version>` bumped above the highest deployed version (above `3.0.8`).
- [ ] Change pushed to `release` and the `Build Local CRM Agent` workflow is green.
- [ ] Release `local-agent-v<version>` exists with the zip asset attached.
- [ ] Confirmed no real `zoom-api.json` secrets are inside the published zip.

---

## 2. Per-machine provisioning

Each rep machine needs **four** things. The first three are the worker upload
config; the fourth (`zoom-api.json`) is the Zoom S2S OAuth credentials.

`Program.cs` resolves the first three at startup as **persisted config first,
then environment variable** (per value, independently):

```csharp
var workerUrl = !string.IsNullOrEmpty(config.WorkerBaseUrl)
    ? config.WorkerBaseUrl
    : Environment.GetEnvironmentVariable("CRM_AGENT_WORKER_URL");
var agentToken = config.GetUnprotectedAgentToken()
    ?? Environment.GetEnvironmentVariable("CRM_AGENT_TOKEN");
var repUserId = !string.IsNullOrEmpty(config.RepUserId)
    ? config.RepUserId
    : Environment.GetEnvironmentVariable("CRM_AGENT_REP_USER_ID");
```

If both a worker URL and a token resolve, the agent calls
`uploader.SetWorkerConfig(...)`. If the values came from env vars (and config did
not already hold them), the agent **persists them to `agent-config.json`** on
first run, DPAPI-encrypting the token, so later launches no longer depend on the
environment.

| # | Value | Env var | Config field (`agent-config.json`) | Notes |
|---|-------|---------|-----------------------------------|-------|
| 1 | Worker URL | `CRM_AGENT_WORKER_URL` | `workerBaseUrl` | `https://zoomphone.tableturnerr.com` |
| 2 | Shared token | `CRM_AGENT_TOKEN` | `agentTokenProtected` (DPAPI) | the bridge `AGENT_SHARED_TOKEN`; same value for all reps |
| 3 | repKey | `CRM_AGENT_REP_USER_ID` | `repUserId` | **the rep's GoHighLevel user ID** — unique per machine |
| 4 | Zoom S2S creds | — | `zoom-api.json` next to the exe | account/client id + secret + shared Zoom login email |

`agent-config.json` lives at **`%APPDATA%\CrmAgent\agent-config.json`**
(`AgentConfig.ConfigPath`).

### 2a. Worker URL — `https://zoomphone.tableturnerr.com`

The base URL of the `zoomphone-bridge` worker. Recordings are POSTed to
`{workerBaseUrl}/recordings/ingest` (`RecordingUploadService.UploadRecording`).
A trailing slash is trimmed by `SetWorkerConfig`. Set via env
`CRM_AGENT_WORKER_URL` or config `workerBaseUrl`.

### 2b. Shared token — the bridge `AGENT_SHARED_TOKEN`

Every upload request sends `Authorization: Bearer <agentToken>`. This is the
worker's single `AGENT_SHARED_TOKEN` value, the same for all agents. It is
**DPAPI-encrypted at rest** (`AgentConfig.SetWorkerConfig` →
`ProtectedData.Protect(..., DataProtectionScope.CurrentUser)`), so the stored
`agentTokenProtected` string is scoped to that Windows user and is unreadable on
another machine or profile. A `401` from the worker makes the agent broadcast
`auth_required`; a token that exists but fails to DPAPI-decrypt (e.g. profile
change) sets `AuthDecryptionFailed` and also broadcasts `auth_required`.
Set via env `CRM_AGENT_TOKEN` or config (encrypted) `agentTokenProtected`.

### 2c. repKey — **the rep's GoHighLevel user ID** (per machine)

This is the single most important per-machine value. It is sent as the
`repUserId` form field on every upload and is how the worker attributes a
recording to the correct GHL user. Because the whole team shares one Zoom
account across many machines, the agent itself cannot tell reps apart — the
`repUserId` provisioned on each machine is the attribution key.

- It must be **the rep's GoHighLevel user ID** for the machine's owner.
- It is **unique per machine** — never copy one rep's value to another's box.
- The minted dedup `callId` is `"{channel}:{repUserId}:{connectTsMs}"`, so a
  wrong `repUserId` both misattributes and breaks retry dedup.

Set via env `CRM_AGENT_REP_USER_ID` or config `repUserId`.

> Code-vs-prompt note: in the source/comments `repUserId` is sometimes described
> as "the rep's Zoom user_id." For this rollout it must be **the rep's
> GoHighLevel user ID**, because that is what the worker maps for GHL
> attribution. The field name is `repUserId` either way.

### 2d. `zoom-api.json` — Zoom Server-to-Server OAuth creds

`ZoomPhoneApiService` loads this file to resolve, for each recording, the **real
Zoom `call_id` and the external party's number** from Zoom's `call_history` API.
On the shared Zoom account this is how the dialed number is obtained at all (it
is not reliably visible in the desktop UI): each machine has a distinct
`device_private_ip`, so the agent matches the `call_history` record whose
`device_private_ip` is one of **this machine's** local IPv4 addresses and whose
`start_time` is near the recording start — an exact per-device match
(`ResolveOwnCallAsync`).

**Location** (`ZoomPhoneApiService` checks these in order):

1. Next to the exe: `<exe dir>\zoom-api.json` (preferred for production).
2. Else: `%APPDATA%\CRM Agent\zoom-api.json` (note the **space** — `CRM Agent`,
   which is different from the `CrmAgent` folder used by `agent-config.json`).

**Format** (read by `LoadConfig` — exactly these four keys):

```json
{
  "accountId": "YOUR_ZOOM_ACCOUNT_ID",
  "clientId": "YOUR_S2S_OAUTH_CLIENT_ID",
  "clientSecret": "YOUR_S2S_OAUTH_CLIENT_SECRET",
  "zoomUserId": "shared-zoom-login@yourcompany.com"
}
```

- `accountId`, `clientId`, `clientSecret` come from a **Server-to-Server OAuth**
  app in the Zoom Marketplace (needs phone scopes; `call_history` read plus
  `phone:write:call:admin` for the end-call path).
- `zoomUserId` is the **shared Zoom account's** login email / Zoom user ID (the
  same on every machine, since the team shares one Zoom account). The per-machine
  disambiguation comes from `device_private_ip`, not from `zoomUserId`.

The agent only loads the four keys above and is considered configured when all
four are present (`IsConfigured`). If `zoom-api.json` is missing or incomplete,
recording and upload still work, but the upload falls back to phone+time
correlation on the worker (the exact Zoom `call_id` is omitted).

---

## 3. Verification per machine

After provisioning, confirm the agent records **and** uploads on that machine.

### 3a. Tray icon

The agent runs as a system-tray dot (click the `^` overflow if hidden):

| Color | State |
|-------|-------|
| Gray  | Idle (no active call) |
| Gold  | Ringing |
| Green | Call connected |
| Blue  | Call just ended |

Right-click for status (call state, connected CRM clients, Zoom detection). If
there is no icon, the agent is not running — relaunch it (Start Menu "CRM Agent",
or the exe in the install dir), or run `install.bat`.

### 3b. Diagnostic log

`Program.cs` initializes a rolling file log at
**`%APPDATA%\CrmAgent\diagnostic.log`** (rolls to `diagnostic.log.old` at ~256 KB).
This survives in Release builds (unlike `Debug.WriteLine`). Open it and look for:

- Startup lines, and config/auth lines from `[Main]` / `[Config]`.
- `[Upload] Resolved Zoom call <id> for <file> (phone=...)` — confirms
  `zoom-api.json` is working and the device-IP match succeeded.
- A successful upload (the entry is marked uploaded and a GHL message id is logged).
- Failure signals to watch for: `auth_required` / DPAPI unprotect failures
  (bad/lost token), `[Upload] Permanent failure` with an `HTTP 4xx` (worker
  rejected metadata), or repeated network failures tripping the circuit breaker.

### 3c. Test call + what success looks like

1. Place a short Zoom Phone call from the machine (desktop app or web phone).
2. Watch the tray dot go Gold → Green → Blue.
3. End the call. The agent records the clip (WAV → MP3), then resolves the Zoom
   `call_id` from `call_history` and uploads.
4. A successful upload, per `RecordingUploadService`:
   - `POST {workerBaseUrl}/recordings/ingest` returns **`200`** with
     `{ ghlMessageId }` (clip attached to the GHL contact), or
   - **`202`** `{ status: "review" }` — accepted but parked in GHL Medias because
     no phone number matched (still a success, not a drop), or
   - **`409`** — already ingested (a dedup of a retried upload), also terminal-OK.
   - The recording entry is marked uploaded and removed from the pending queue;
     `diagnostic.log` shows the GHL message id.
5. Confirm in GoHighLevel that the recording is attached to the right contact and
   attributed to the right user (the `repUserId` you provisioned).

Recordings are stored locally under **`Documents\CRM Recordings`**
(`RecordingStorageManager`), with a `recordings.json` manifest/queue; pending
clips retry with exponential backoff until they upload.

---

## 4. Multi-rep / shared-account behavior

- **One agent per machine.** A `Global\LocalCrmAgent_SingleInstance` mutex in
  `Program.cs` enforces a single running instance per machine.
- **The whole team shares one Zoom account** across many machines. Calls are
  disambiguated per device, not per Zoom user.
- **Correlation is by exact Zoom `call_id` first.** Each machine has a distinct
  `device_private_ip`; `ResolveOwnCallAsync` matches the `call_history` record on
  this machine's IP + the recording start time and takes the real `call_id` and
  the external `*_did_number`. That `zoomCallId` is sent to the worker so the
  clip attaches to exactly the right logged call. If it cannot be resolved, the
  worker falls back to **phone number + connect time**; if neither is known, the
  clip is parked for review (never dropped).
- **Concurrency across reps is handled by per-device `call_id` resolution.**
  Multiple reps can be on calls simultaneously on the shared Zoom account; the
  device-IP match keys each recording to that machine's own call, so concurrent
  calls do not cross-contaminate. (A machine can only be on one call at a time,
  which is what makes the per-device match exact.)
- **`repUserId` provides rep attribution.** Correlation finds the *call*; the
  per-machine `repUserId` tells the worker *which rep* it belongs to in GHL.
- VPN caveat: a rep on a VPN matches on the VPN-assigned IP — still per-machine,
  still exact.

---

## 5. Provisioning checklist (copy-paste)

Do this once per rep machine, under that rep's own Windows login (so DPAPI
encrypts the token to the right user profile).

Replace the placeholders. **Do not commit or paste real secrets anywhere shared.**

### Option A — environment variables (PowerShell)

Per-user (no admin; recommended — DPAPI is per-user anyway). Set the worker URL,
the shared token, and **this rep's GHL user id**:

```powershell
# Per-user (no admin needed)
[Environment]::SetEnvironmentVariable('CRM_AGENT_WORKER_URL',  'https://zoomphone.tableturnerr.com', 'User')
[Environment]::SetEnvironmentVariable('CRM_AGENT_TOKEN',       '<AGENT_SHARED_TOKEN>',               'User')
[Environment]::SetEnvironmentVariable('CRM_AGENT_REP_USER_ID', '<THIS_REP_GHL_USER_ID>',             'User')
```

Machine-wide variant (run PowerShell **as Administrator**; use only if the rep
machine has a single Windows user):

```powershell
# Machine-wide (requires elevated PowerShell)
[Environment]::SetEnvironmentVariable('CRM_AGENT_WORKER_URL',  'https://zoomphone.tableturnerr.com', 'Machine')
[Environment]::SetEnvironmentVariable('CRM_AGENT_TOKEN',       '<AGENT_SHARED_TOKEN>',               'Machine')
[Environment]::SetEnvironmentVariable('CRM_AGENT_REP_USER_ID', '<THIS_REP_GHL_USER_ID>',             'Machine')
```

Then **restart the agent** (kill the tray process and relaunch, or sign out/in)
so it reads the new variables. On that first launch the agent persists these into
`%APPDATA%\CrmAgent\agent-config.json` (token DPAPI-encrypted), so later launches
no longer need the env vars. You may then clear the plaintext `CRM_AGENT_TOKEN`
env var if you prefer not to leave it on disk:

```powershell
[Environment]::SetEnvironmentVariable('CRM_AGENT_TOKEN', $null, 'User')   # or 'Machine'
```

### Option B — write `agent-config.json` directly

Worker URL and `repUserId` are plaintext; the token field
(`agentTokenProtected`) must be DPAPI-protected, so the simplest way to populate
it is to set `CRM_AGENT_TOKEN` once (Option A) and let the agent encrypt + persist
it. A hand-written file can carry the non-secret fields:

`%APPDATA%\CrmAgent\agent-config.json`:

```json
{
  "autoRecordEnabled": true,
  "recordOnRinging": false,
  "workerBaseUrl": "https://zoomphone.tableturnerr.com",
  "repUserId": "<THIS_REP_GHL_USER_ID>",
  "agentTokenProtected": null
}
```

> `agentTokenProtected` is a DPAPI+base64 blob, not the raw token — never paste
> the raw `AGENT_SHARED_TOKEN` here. Leave it `null` and provision the token via
> `CRM_AGENT_TOKEN` once; the agent fills `agentTokenProtected` in on first run.
> A third runtime option exists: the dashboard can send a `setWorkerConfig`
> WebSocket message (`workerBaseUrl` / `agentToken` / `repUserId`) to the agent
> on `ws://127.0.0.1:9876`, which also persists the same way.

### Zoom S2S creds — `zoom-api.json`

Place next to the installed `LocalCrmAgent.exe` (e.g. the Tool Manager install
dir `%LocalAppData%\TableTurnerr\ToolManager\tools\local-crm-agent\`), or at
`%APPDATA%\CRM Agent\zoom-api.json`:

```json
{
  "accountId": "<ZOOM_ACCOUNT_ID>",
  "clientId": "<ZOOM_S2S_CLIENT_ID>",
  "clientSecret": "<ZOOM_S2S_CLIENT_SECRET>",
  "zoomUserId": "<SHARED_ZOOM_LOGIN_EMAIL>"
}
```

Restart the agent after placing the file. `accountId` / `clientId` /
`clientSecret` are shared S2S app credentials; `zoomUserId` is the shared Zoom
account login email. No reinstall needed.

### Final per-machine sign-off

- [ ] Tray dot visible; right-click shows status.
- [ ] `%APPDATA%\CrmAgent\agent-config.json` has `workerBaseUrl`, `repUserId`,
      and a non-null `agentTokenProtected` after first run.
- [ ] `repUserId` = **this rep's** GHL user id (not a copy of someone else's).
- [ ] `zoom-api.json` present next to the exe (or in `%APPDATA%\CRM Agent\`).
- [ ] Test call shows `[Upload] Resolved Zoom call ...` then a `200`/`202`
      upload in `diagnostic.log`, and the clip appears on the right GHL contact.
```
