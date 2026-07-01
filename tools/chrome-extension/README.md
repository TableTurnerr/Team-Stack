# Lead Scraper Extension

The **Lead Scraper** Chrome extension, packaged as a Tool Manager tool. The extension source
lives in [`extension/`](extension/); the scripts and `tool.json` here turn it into something the
Tool Manager can install and auto-update.

> **History:** the extension used to live in its own repo, `TableTurnerr/GMaps-Scraper`. It has
> been merged into this monorepo and that repo is deprecated/archived. `extension/` is now the
> single source of truth.

## Layout

| Path | What it is |
|------|------------|
| `extension/` | The Manifest V3 extension source. This is the **dev build**: its `name` is `(dev)`-marked and its `key` is the dev key. |
| `tool.json` | Tool Manager manifest (id, name, type). The release pipeline injects `version`. |
| `release.key` | The release signing key (public, not a secret). Injected at release time to pin the release extension id. |
| `apply-release-manifest.ps1` | Turns a staged manifest into the release manifest: strips `(dev)`, swaps the dev key for `release.key`. Shared by CI and `build-release.bat`. |
| `dev-build.bat` | Helper that points you at `extension/` to load unpacked. There's nothing to build — the source already *is* the dev build. |
| `build-release.bat` | Package `extension/` + `tool.json` + installers into a release zip (runs the release manifest transform). |
| `install.bat` / `uninstall.bat` | Shipped inside the release zip for standalone installs. |

| Field | Value |
|-------|-------|
| Tool id / install folder | `lead-scraper` |
| Release tag prefix | `lead-scraper-v<version>` |
| Tool type | `chrome-extension` |
| Source | `extension/` (version read from its `manifest.json`) |

The Tool Manager discovers tools from `TableTurnerr/Team-Stack` GitHub releases, grouped by tag
prefix (`local-agent-v*`, `tool-manager-v*`, `lead-scraper-v*`). Each release zip carries a
`tool.json`. The `chrome-extension` handler installs by extracting the files to
`%LocalAppData%\TableTurnerr\ToolManager\tools\lead-scraper`; the user loads/reloads it as an
unpacked extension in Chrome.

## Local dev

The committed `extension/` folder **is** the dev build, so there's nothing to build — just load it:

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**, and select
   `tools\chrome-extension\extension`.
2. It appears as **TableTurner Lead Scraper (dev)**.

Edit files in place and click the card's reload icon to pick up changes. `dev-build.bat` just
prints these steps and sanity-checks the manifest.

The source `manifest.json` carries the **dev key** (id `lgacebajcimhkmcgihcjcdnndkbdggak`), distinct
from the release key (id `jmedgkieldhfccjpjeafmgenaidchbmg`). Two different ids means the dev build
and the Tool Manager release install coexist in one Chrome instead of colliding.

## Running dev + release side by side

Because the dev and release builds have different extension ids, both load at once: the dev build
from `extension/` (above) and the release from the Tool Manager
(`%LocalAppData%\TableTurnerr\ToolManager\tools\lead-scraper`).

**Saved Sessions are shared across both** (and across machines) because they live in **GoHighLevel**,
not in `chrome.storage`. Each saved scraping session/campaign is a GHL custom object record scoped to
the logged-in user (see `extension/ghl_client.js` and the dashboard
`/api/ghl/locations/[loc]/scraping-sessions` routes), so signing into the same GHL account from either
build shows the same sessions. A local `chrome.storage` cache mirrors them for offline viewing. The
extension requires GHL login before any use.

## Release

CI (`.github/workflows/build-chrome-extension.yml`) is the normal path: run the workflow, it packages
`extension/` and publishes `lead-scraper-v<version>` (version from `extension/manifest.json`) to
Team-Stack. The Tool Manager picks it up on its next refresh.

`build-release.bat` is the manual equivalent — it produces `dist/LeadScraperExtension-v<version>.zip`
for direct sharing.

## Publishing a new version

1. Bump `version` in both `extension/manifest.json` and `extension/version.json`, and update
   `releaseNotes` in `extension/version.json`.
2. Commit and push. Run the **Build Lead Scraper Extension** workflow (it skips if a
   `lead-scraper-v<version>` release already exists).
