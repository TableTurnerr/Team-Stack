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
| `extension/` | The Manifest V3 extension source (`manifest.json`, content scripts, popup, docs). |
| `tool.json` | Tool Manager manifest (id, name, type). The release pipeline injects `version`. |
| `dev-build.bat` | Stage `extension/` into the managed tools folder for local Chrome testing. |
| `build-release.bat` | Package `extension/` + `tool.json` + installers into a release zip. |
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

```bat
dev-build.bat
```

Stages the extension into the managed tools folder (`...\ToolManager\tools\lead-scraper`) so you can
load/reload it at `chrome://extensions`. It reads from `extension/` by default; set
`GMAPS_SCRAPER_DIR` to override the source path. It does not modify the Tool Manager registry —
that's reserved for real installs from a release, so a dev build can never corrupt `installed.json`.

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
