---
name: commit-changes
description: Automates the process of committing changes with optional version bumps (patch/major/none), smart grouping of related changes into multiple commits, and scraper extension support.
---

# Commit Changes Skill

This skill automates the workflow for committing changes in the TableTurnerr CRM repository, ensuring logical grouping of related changes, consistent versioning, and accurate commit messages.

## Prerequisites

- **Git** must be installed and configured.
- **Node.js** must be available to run the `bump_version.js` script.
- **cmd /c** should be used for all shell commands on Windows.

## Workflow

### 1. Analyze and Group Changes

Run `git status` and `git diff` to identify all changed files. Group these files into **logical sets** based on the objective or nature of the changes.

**Logical Grouping Examples:**
- **Core/Skill**: Changes to `.gemini/skills/`, `package.json` (root), etc.
- **PocketBase**: Changes to `packages/pocketbase-client/`, `pb_db_schema.json`.
- **Dashboard**: Changes to `apps/dashboard/`.
- **DiscordBot**: Changes to `tools/discord-bot/`.
- **Scraper**: Changes to `tools/TT-lead-scraper-extension/`.

**Goal**: Make multiple commits if changes are unrelated. Each commit should be self-contained and relevant to a specific objective.

### 2. Determine Bump Type

Decide on the bump type for this phase:
- `patch`: Increases the second digit (X.Y -> X.Y+1).
- `major`: Increases the first digit and resets the second (X.Y -> X+1.0).
- `none`: No version bump.

### 3. Apply Version Bumps (For each modified component)

If a bump is requested, apply it to the **root** and the **modified components** in their respective commits (or in a final sync commit if preferred, but usually at the start of the relevant component's commit).

**Component Mapping & Version Files:**
- `apps/dashboard` -> `Dashboard` (`package.json`)
- `packages/pocketbase-client` -> `PocketBase` (`package.json`)
- `tools/discord-bot` -> `DiscordBot` (`package.json`)
- `tools/TT-lead-scraper-extension` -> `Scraper` (`manifest.json` AND `version.json`)
- `packages/hubspot` -> `HubSpot` (`package.json`)

**Usage Example:**
```bash
cmd /c "node .gemini/skills/commit-changes/scripts/bump_version.js tools/TT-lead-scraper-extension/manifest.json patch true"
cmd /c "node .gemini/skills/commit-changes/scripts/bump_version.js tools/TT-lead-scraper-extension/version.json patch true"
```

### 4. Execute Sequential Commits (Windows Safe)

For EACH logical group identified in step 1:

1. **Stage only the relevant files**: `git add path/to/file1 path/to/file2 ...`
2. **Generate a specific commit message**:
   `Nature(Component): Detailed description of this specific group of changes`
3. **Write the message** to a temporary file `commit_msg.txt`.
4. **Commit**: `cmd /c "git commit -F commit_msg.txt"`
5. **Cleanup**: Delete `commit_msg.txt`.

## Guidelines

- **Atomic Commits**: Keep commits focused. Don't mix UI changes with database schema changes in one commit.
- **Nature of Change Tags**: `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `perf`, `test`.
- **Scraper UI**: When bumping the Scraper, ensure BOTH `manifest.json` and `version.json` are updated.
- **Root Bump**: Ensure the root `package.json` version is updated at least once during the process if any changes occurred.
