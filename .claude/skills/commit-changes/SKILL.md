---
name: commit-changes
description: Automates the process of committing changes with granular objective-based commits, separate final version bumps, and specialized "Fix" type formatting. Operates autonomously without asking for confirmation.
---

# Commit Changes Skill

This skill automates the workflow for committing changes in the TableTurnerr CRM repository, ensuring logical grouping of related changes, consistent versioning, and accurate commit messages. It is designed for autonomous execution.

## Prerequisites

- **Git** must be installed and configured.
- **Node.js** must be available to run the `bump_version.js` script.
- Use bash shell commands (Unix-style paths).

## Workflow

### 1. Status Audit

Before analyzing changes, the agent MUST report the current state of the workspace.

1. **Check Versions**: Run the status report script to see what versions everything is currently on.
   ```bash
   node .gemini/skills/commit-changes/scripts/get_status.js
   ```
2. **Report**: Display the current versions. Proceed autonomously to analyze changes without asking for confirmation or feature lists.

### 2. Analyze and Group Changes

Run `git status` and `git diff` to identify all changed files. Group these files into **logical sets** based on the objective or nature of the changes. **Maximize granularity**: create a separate group for each distinct objective.

### 3. Determine Bump Type

Decide on the bump type for this phase: `patch` (default for most changes), `major`, or `none`.

### 4. Execute Objective-Based Commits (Code Only)

For EACH logical group identified in step 2:

1. **Stage only the relevant files**: `git add path/to/file1 ...`
2. **Generate a specific commit message**:
   - **Regular Changes**: `Nature(Component): Detailed description of this specific group of changes`
   - **Fix Type**: If the change is a fix, use: `fix(Component): Description (vX.Y)` where `vX.Y` is the **current** version of the component (not the bumped one).
3. **Commit** using a heredoc for the message to ensure proper formatting.
4. Repeat for each logical group.

**CRITICAL**: Do NOT include version file updates (e.g., `package.json`, `manifest.json`, `.csproj`) in these commits.

### 5. Final Version Bump Commit

After all functional changes are committed, perform a single, final commit for all version bumps.

1. **Apply Bumps**: Run `bump_version.js` for the root and all modified components.
   ```bash
   node .gemini/skills/commit-changes/scripts/bump_version.js apps/dashboard/package.json patch true
   ```
   For the Local CRM Agent (.csproj, semver X.Y.Z):
   ```bash
   node .gemini/skills/commit-changes/scripts/bump_version.js tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj patch
   ```
2. **Stage all version files**: `git add package.json apps/dashboard/package.json ...`
3. **Generate commit message**: `chore(version): bump versions to [Root New Version] ([Component1] vX.Y, [Component2] vA.B)`
4. **Commit** using a heredoc for the message.

## Guidelines

- **Autonomous Mode**: Do NOT ask the user for confirmation, approval, or additional information once the directive to commit is given.
- **No Co-Author**: NEVER add a `Co-Authored-By` line to commit messages.
- **Atomic Commits**: Keep commits focused. Don't mix UI changes with database schema changes in one commit.
- **Granularity**: If a component has two unrelated changes, make two separate commits.
- **Scraper UI**: When bumping the Scraper, ensure BOTH `manifest.json` and `version.json` are updated.
- **Local CRM Agent**: Uses `.csproj` with semver (`X.Y.Z`). The bump script handles this format automatically. Bump path: `tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj`. The tray label and heartbeat `version` field both read from the assembly at runtime — only the README example still requires a manual update:
  - `tools/local-CRM-Agent/README.md` — heartbeat example JSON `"version"` field
- **Root Bump**: Ensure the root `package.json` version is updated at least once during the process if any changes occurred.