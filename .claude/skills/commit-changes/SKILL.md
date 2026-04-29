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
   node .claude/skills/commit-changes/scripts/get_status.js
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
   node .claude/skills/commit-changes/scripts/bump_version.js apps/dashboard/package.json patch true
   ```
   For the Local CRM Agent (.csproj, semver X.Y.Z):
   ```bash
   node .claude/skills/commit-changes/scripts/bump_version.js tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj patch
   ```
2. **Stage all version files**: `git add package.json apps/dashboard/package.json ...`
3. **Generate commit message**: `chore(version): bump versions to [Root New Version] ([Component1] vX.Y, [Component2] vA.B)`
4. **Commit** using a heredoc for the message.

### 6. Merge to Release (Optional)

This step runs ONLY if the user's invocation parameters contain the literal phrase **"Merge to release"** (case-insensitive). If the phrase is absent, skip this step entirely.

If version bumping was skipped in step 5 (e.g., user said "no bump"), this step still runs — it operates independently of the bump decision.

1. **Push development**: Push the current `development` branch to origin so the PR has the latest commits.
   ```bash
   git push origin development
   ```
2. **Ensure release branch exists on remote**: Check with `git ls-remote --heads origin release`. If missing, abort this step and report the issue — do NOT auto-create the release branch.
3. **Create the PR** from `development` → `release` using `gh`:
   - **Title**: Reuse the version-bump commit summary if a bump occurred (e.g., `chore(release): bump versions to [Root New Version] ([Component1] vX.Y)`). If no bump occurred, use `chore(release): merge development into release`.
   - **Body**: Brief summary of the commits added in this skill invocation (one bullet per objective-based commit from step 4, plus the bump commit if any). Use a heredoc for formatting.
   ```bash
   gh pr create --base release --head development --title "..." --body "$(cat <<'EOF'
   ## Summary
   - <bullet per commit>

   ## Test plan
   - [ ] Verify deployments succeed on release branch
   EOF
   )"
   ```
4. **Merge the PR**: Immediately merge using a merge commit (preserves the development history on release):
   ```bash
   gh pr merge --merge --delete-branch=false --admin
   ```
   - Use `--merge` (NOT `--squash` or `--rebase`) so each commit lands on release individually.
   - Use `--delete-branch=false` so the development branch is preserved.
   - Use `--admin` to bypass branch protection rules (required for the `release` branch policy).
5. **Report**: Print the PR URL and merge confirmation. Do NOT switch the local working branch — leave the user on `development`.

## Guidelines

- **Autonomous Mode**: Do NOT ask the user for confirmation, approval, or additional information once the directive to commit is given.
- **No Co-Author**: NEVER add a `Co-Authored-By` line to commit messages.
- **Atomic Commits**: Keep commits focused. Don't mix UI changes with database schema changes in one commit.
- **Granularity**: If a component has two unrelated changes, make two separate commits.
- **Scraper UI**: When bumping the Scraper, ensure BOTH `manifest.json` and `version.json` are updated.
- **Local CRM Agent**: Uses `.csproj` with semver (`X.Y.Z`). The bump script handles this format automatically. Bump path: `tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj`. The tray label and heartbeat `version` field both read from the assembly at runtime — only the README example still requires a manual update:
  - `tools/local-CRM-Agent/README.md` — heartbeat example JSON `"version"` field
- **Root Bump**: Ensure the root `package.json` version is updated at least once during the process if any changes occurred.