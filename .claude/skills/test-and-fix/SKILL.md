---
name: test-and-fix
description: Runs lint, build, and tests in parallel, analyzes all failures, fixes broken code/tests, and re-runs until everything passes. Speed-optimized with parallel execution and minimal re-run cycles.
---

# Test and Fix Skill

You are an autonomous lint/build/test runner and fixer. Your job is to run all validation checks, analyze failures, apply fixes, and iterate until everything passes — with maximum speed and minimum wasted cycles.

## When to Apply

Use this skill when:
- The user asks to "run tests and fix them"
- The user asks to "make tests pass"
- The user says "test and fix", "fix failing tests", "run tests"
- The user asks to "lint and fix", "build and fix", or any combination
- After implementing a feature, to validate it works end-to-end

## Speed Optimization Strategy

**Principle: Never run more tests than necessary. Never re-run tests that already passed.**

1. **Targeted first** — If the user's changes are scoped to a known area, run only that suite:
   - Auth changes → `pnpm --filter dashboard test:auth`
   - Companies changes → `pnpm --filter dashboard test:companies`
   - Call/session changes → `pnpm --filter dashboard test:calls`
   - Notes changes → `pnpm --filter dashboard test:notes`
   - Settings changes → `pnpm --filter dashboard test:settings`
   - Smoke check → `pnpm --filter dashboard test:smoke`
   - PocketBase client → `pnpm --filter pocketbase-client test`

2. **Smoke first** — If scope is unclear, run smoke tests first (`test:smoke`) to catch obvious breakage fast before running the full suite.

3. **Failed-only re-runs** — After fixing failures, re-run ONLY the failed test files, not the entire suite. Use:
   ```bash
   pnpm --filter dashboard exec playwright test <specific-file.spec.ts>
   ```

4. **Parallel by default** — Playwright is already configured for parallel workers. Never add `--workers=1` unless debugging a specific ordering issue.

5. **Skip UI mode** — Always run headless for speed. Never use `test:ui` or `test:headed` during fix cycles.

6. **Batch fixes before re-running** — If multiple failures share a root cause, fix ALL of them before re-running. Don't fix-one-run-one.

## Workflow

### Phase 1: Assess Scope

1. Check what files have been modified recently:
   ```bash
   git diff --name-only HEAD~3
   ```
2. Map changed files to test suites:
   - `src/app/(dashboard)/companies/` → `tests/03-companies.spec.ts`
   - `src/app/(dashboard)/session/` → `tests/05-session.spec.ts`, `tests/12-live-call-flow.spec.ts`, `tests/13-virtual-call-flow.spec.ts`
   - `src/app/(dashboard)/notes/` → `tests/07-notes.spec.ts`
   - `src/app/(dashboard)/settings/` → `tests/10-settings.spec.ts`
   - `src/contexts/`, `src/components/` → `tests/11-integration.spec.ts` + related suites
   - `packages/pocketbase-client/` → `pnpm --filter pocketbase-client test`
   - `tools/local-CRM-Agent/` → `dotnet build tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj -c Release` (build-only, no test suite)
3. If scope maps to 1-3 suites, run only those. If scope is broad or unclear, proceed to Phase 2.

### Phase 2: Run Lint, Build, and Tests IN PARALLEL

**CRITICAL: Launch all three checks simultaneously.** These are independent tasks — never run them sequentially. Use parallel tool calls (multiple Bash calls in a single message) to maximize speed.

**Run all three at once:**

| Check | Command | What it catches |
|-------|---------|-----------------|
| **Lint** | `pnpm --filter dashboard lint` | ESLint errors, unused imports, code style violations |
| **Build** | `pnpm --filter dashboard build` | TypeScript type errors, import resolution, build-time failures |
| **Tests** | *(targeted or smoke — see below)* | Runtime bugs, broken UI flows, regressions |

**Test selection (run alongside lint & build):**

- **Targeted run (preferred)** — when scope is known from Phase 1:
  ```bash
  pnpm --filter dashboard exec playwright test tests/<specific-file>.spec.ts
  ```
- **Smoke run (quick validation)** — when scope is unclear:
  ```bash
  pnpm --filter dashboard test:smoke
  ```
- **Full run (only when necessary):**
  ```bash
  pnpm --filter dashboard test
  ```

**If PocketBase client was modified**, also run in parallel:
```bash
pnpm --filter pocketbase-client lint
pnpm --filter pocketbase-client build
pnpm --filter pocketbase-client test
```

**If Local CRM Agent was modified**, also run in parallel:
```bash
dotnet build tools/local-CRM-Agent/src/LocalCrmAgent/LocalCrmAgent.csproj -c Release
```
Note: The Local CRM Agent is a C#/.NET 8.0 project. It has no lint or test suite — only build validation applies. Build failures indicate C# compilation errors (missing references, type mismatches, syntax errors).

Capture all outputs. For each check, note:
- **Lint:** file paths, line numbers, rule IDs, error vs warning
- **Build:** TypeScript errors with file:line, type mismatch details
- **Tests:** pass/fail/skip counts, failed test names, error messages and stack traces

### Phase 3: Analyze Failures

Collect ALL failures from lint, build, AND tests. Classify each:

**Lint Failures:**

| Category | Symptoms | Fix Strategy |
|----------|----------|--------------|
| **Unused import/variable** | `no-unused-vars`, `@typescript-eslint/no-unused-vars` | Remove the unused import/variable |
| **Missing import** | `no-undef`, reference errors | Add the missing import |
| **Code style** | `prefer-const`, `no-var`, formatting rules | Apply the required style change |
| **React-specific** | `react-hooks/exhaustive-deps`, `react/no-unescaped-entities` | Fix hook dependencies or escape entities |

**Build (TypeScript) Failures:**

| Category | Symptoms | Fix Strategy |
|----------|----------|--------------|
| **Type mismatch** | `Type 'X' is not assignable to type 'Y'` | Fix the type annotation or the value |
| **Missing property** | `Property 'x' does not exist on type 'Y'` | Add the property to the type or fix the access |
| **Missing module** | `Cannot find module 'x'` | Install the package or fix the import path |
| **Implicit any** | `Parameter 'x' implicitly has an 'any' type` | Add explicit type annotation |

**Test Failures:**

| Category | Symptoms | Fix Strategy |
|----------|----------|--------------|
| **Code bug** | Assertion fails on real behavior | Fix the application code, not the test |
| **Stale test** | Test expects old UI/behavior that was intentionally changed | Update the test to match new behavior |
| **Flaky timing** | Passes on retry, `waitForTimeout` issues, race conditions | Add proper `waitFor` / `expect().toBeVisible()` guards |
| **Selector broken** | Element not found, locator timeout | Update selector to match current DOM |
| **Test data issue** | Data not found, cleanup failed | Check `pb-client.ts` helpers, verify TEST_PREFIX cleanup |
| **Environment issue** | Server not running, auth expired | Restart dev server, re-run global setup |

**Priority order:** Fix build/type errors first (they block everything), then lint errors, then test failures. Within tests: code bugs first (they cascade), then stale tests, then flaky tests.

### Phase 4: Fix

1. **Read the failing test** to understand what it expects
2. **Read the relevant source code** to understand current behavior
3. **Determine if the test or the code is wrong:**
   - If the code was intentionally changed → update the test
   - If the code has a bug → fix the code
4. **Apply all fixes** for the current batch of failures before re-running
5. **Never disable or skip a test** unless explicitly told to by the user

### Phase 5: Re-run and Verify

**Re-run only what failed, all in parallel again:**

1. If lint failed → re-run `pnpm --filter dashboard lint`
2. If build failed → re-run `pnpm --filter dashboard build`
3. If tests failed → re-run ONLY the previously-failed test files:
   ```bash
   pnpm --filter dashboard exec playwright test tests/03-companies.spec.ts tests/07-notes.spec.ts
   ```
4. Launch all applicable re-runs simultaneously in parallel
5. If new failures appear, go back to Phase 3
6. If all checks pass, do ONE final parallel run of lint + build + affected test suites to confirm no regressions
7. **Max 3 fix cycles** — if checks still fail after 3 rounds of fixes, stop and report the remaining issues to the user with your analysis

### Phase 6: Report

Output a concise summary:

```
## Validation Results

**Lint:** Passing (or X errors remaining)
**Build:** Passing (or X errors remaining)
**Tests:** All passing (or X remaining failures)

**Suites run:** [list]
**Fixes applied:**
- [file:line] — what was wrong and what was fixed
- [file:line] — ...

**Remaining issues (if any):**
- [check:file:line] — why it's failing and recommended next steps
```

## File-to-Suite Mapping Reference

| Source Path | Test Suite |
|------------|------------|
| `src/app/(dashboard)/page.tsx` (overview) | `02-overview.spec.ts` |
| `src/app/(dashboard)/companies/` | `03-companies.spec.ts` |
| `src/app/(dashboard)/cold-calls/` | `04-cold-calls.spec.ts` |
| `src/app/(dashboard)/session/` | `05-session.spec.ts`, `12-live-call-flow.spec.ts`, `13-virtual-call-flow.spec.ts` |
| `src/app/(dashboard)/session-logs/` | `06-session-logs.spec.ts` |
| `src/app/(dashboard)/notes/` | `07-notes.spec.ts` |
| `src/app/(dashboard)/actors/`, team, goals | `08-actors-team-goals.spec.ts` |
| `src/app/(dashboard)/recordings/` | `09-recordings.spec.ts` |
| `src/app/(dashboard)/settings/` | `10-settings.spec.ts` |
| Cross-component, contexts, shared components | `11-integration.spec.ts` |
| `packages/pocketbase-client/` | `pnpm --filter pocketbase-client test` |
| `tools/local-CRM-Agent/` | `dotnet build` (build-only, no test suite) |
| Login/auth flows | `01-auth.spec.ts` |

## Guidelines

- **Speed is king** — always prefer targeted runs over full suite runs
- **Fix code, not symptoms** — if a test fails because the code is wrong, fix the code
- **Batch before re-run** — group related fixes and re-run once, not after each fix
- **Respect test data patterns** — always use `TEST_PREFIX` for test data, always clean up in `afterAll`
- **Don't touch passing tests** — if a test passes, leave it alone
- **3-cycle max** — escalate to the user after 3 failed fix attempts
- **Read before fixing** — always read both the test file and the source code before making changes
