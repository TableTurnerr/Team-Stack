# Tableturnerr Tech Stack — Optimization Plan

> Generated 2026-07-06 from a deep review of all five repos: CRM-Tableturnerr, ParentSite-Tableturnerr, TT-ChildSite-Wireframe, Al-Baghdadi-Website, TT-Leads.
> Priorities: **P0** = security/compliance, do now · **P1** = correctness bugs & broken things · **P2** = structural/architecture · **P3** = hygiene/polish.

---

## Executive Summary

The stack is modern (Next 15/16, React 19, Tailwind 4, .NET 8, PocketBase + Supabase) and unusually well-documented per tool, but it has three systemic weaknesses:

1. **Zero quality gates.** No repo runs tests or lint in CI. The CRM's CI only packages release artifacts; ParentSite, Wireframe and Al-Baghdadi have no CI at all. The dashboard's Playwright suite exists but never runs automatically.
2. **A real XSS/injection surface in the wireframe + client-site template**, amplified by AI-writable content (MCP) and realtime broadcast to every viewer.
3. **Drift**: half-finished migrations (Supabase client in the CRM), orphaned apps (insta-outreach-agent), stale docs (now fixed in the CLAUDE.md pass), version sprawl across ~9 files, and three independent implementations of phone normalization.

The highest-leverage strategic move is **finishing the client-site template extraction** (Al-Baghdadi → true white-label) since new client sites are the revenue engine, followed by **a minimal CI baseline everywhere**.

---

## P0 — Security & Compliance (do immediately)

### 1. Stored XSS in the wireframe override system — `TT-ChildSite-Wireframe`
`src/lib/wireframe/inline-edit.ts` (`applyOverridesToDom()`) sets `el.innerHTML` from stored override strings; `EditableFrame.tsx` persists arbitrary `afterHtml`. Overrides are writable by any lock-holding editor **and any MCP bearer token** (`set_override`, `replace_canvas`), then rendered unsanitized in every viewer's browser via Supabase realtime.
**Fix:** sanitize with DOMPurify (or equivalent) on both write (`content-api.ts`) and render (`applyOverridesToDom`). Allowlist basic formatting tags only.

### 2. JSON-LD `</script>` injection — Wireframe **and** Al-Baghdadi
`SchemaInjector.tsx` (both repos) injects `JSON.stringify(schema)` via `dangerouslySetInnerHTML`. `JSON.stringify` does not escape `</script>`, so any client-controlled string (restaurant name, review text) containing it breaks out of the tag. This component ships into **real client sites**.
**Fix:** replace `<` with `<` (and `&` / `>` for safety) in the serialized string. One-line fix, apply in both repos (template first, then propagate).

### 3. Rotate and remove committed/loose service-role credentials
- **ParentSite**: tracked `.mcp.json` contains a service-role JWT for the deprecated VPS (`psdb.tableturnerr.com`). Even "stopped", rotate it and delete the `localsupabase` MCP entry.
- **Wireframe**: a live `SUPABASE_SERVICE_ROLE_KEY` for the shared Supabase project sits in `.env.local` on disk. Rotate; keep the service key only in Vercel env.
- **CRM**: `.mcp.json` / `.claude/settings.local.json` hold plaintext tokens (21st-dev, Vercel, Supabase PAT) — gitignored but cleartext; move to env-var indirection. Also fix the stale `C:/Users/Hashaam/...` path in `.mcp.json`.

### 4. MCP key hardening — Wireframe
`verifyToken` in `src/app/api/mcp/route.ts` has no rate limiting/lockout, and any valid `ttwf_*` token can edit **every** canvas (`list_canvases` → `replace_canvas`).
**Fix:** scope keys to a client id, add per-token throttling, and replace the `z.any()` schemas in `tools.ts` (`theme`, `data`, `items`, `replace_canvas` payload) with real zod shapes so malformed writes can't poison `wireframe_content`.

### 5. Review gating on the client template — Al-Baghdadi (compliance)
`ReviewModal.tsx` routes 4–5★ raters to Google and diverts <4★ to a private form (`LOW_STAR_THRESHOLD = 4`). This is textbook review gating and **violates Google's review policies** — a penalty risk for every client site cloned from this template.
**Fix (business decision):** show both options to all raters (ask-for-review + private-feedback), regardless of star selection.

### 6. GHL OAuth tokens at rest — CRM
`ghl_connections` stores `access_token`/`refresh_token` as plain PocketBase fields. Verify collection API rules lock them to superusers, and consider encrypting at rest (or storing only refresh tokens server-side).

### 7. TT-Leads data handling
Thousands of business phone numbers + call outcomes are committed to git history (`prev_leads/`, `exclusion_phones.txt`, hardcoded script data). DNC/TCPA hygiene applies: keep the repo private, honor the DNC ledger rigorously, and stop committing raw chat logs (`chat_files/entire_raw_chat.txt`).

---

## P1 — Correctness & Broken Things

| Repo | Issue | Fix |
|---|---|---|
| Al-Baghdadi | `src/data/dishes.ts` references 6 gallery images that don't exist (`kunafa.webp`, `kahi.webp`, `mabrouma.webp`, `samoon.webp`, `manakish.webp`, `fatayer.webp`) — will 404 the moment the mesh route ships | Add the images or repoint to existing ones **before** enabling `MATRIX_ALLOWLIST` |
| Al-Baghdadi | `public/manifest.json` icons declare `image/png` but files are `.webp`; `background_color` (#FDF6EC) ≠ site background (#FFFFFF) | Fix MIME types + color |
| Al-Baghdadi | `--font-display` maps to Inter, so headings never render Fraunces (docs said they should) | Decide intended design; fix the token mapping if Fraunces headings were intended |
| ParentSite | `app/api/cron/uptime-check` exists but `vercel.json` only schedules `publish-scheduled` — the uptime poller may never run | Register it in `vercel.json` crons or document the external trigger |
| ParentSite | Version numbers went non-monotonic across a merge (4.1 → 3.26 → 3.27 → 4.2) — the commit-changes bump automation mishandles branch merges | Add a "version must be ≥ current on target branch" check to the skill/script |
| Wireframe | Sticky autosave error: once `saveStatus.kind === "error"` (ClientProfileBar.tsx), later successful saves don't clear the indicator | Reset status at save start |
| Wireframe | `beforeunload` lock release builds headers before the async session-token fetch resolves — release often 401s and locks linger the full 90s stale window | Cache the token synchronously or use `navigator.sendBeacon` with a pre-fetched token |
| CRM | `apps/insta-outreach-agent` has no entrypoint and isn't wired into anything | Finish it or move to an `archive/` branch — it currently reads as live code |
| CRM | `packages/supabase-client` is a `dist/`-only vestige of an abandoned migration; `.env.info.example` + MCP config still reserve Supabase vars | Delete the package and the dangling config, or write the ADR and finish the migration |
| TT-Leads | Every script hardcodes `C:\Users\Hashaam\...` (machine user is `hisha`) — nothing runs | Convert to `__file__`-relative paths |
| TT-Leads | `generate_chownow_leads.py` silently drops malformed phone numbers (`clean_phone()` → `None`, no log) | Log dropped records; validate the hardcoded dataset |
| TT-Leads | `exclusion_phones.txt` exists in two locations with 10- vs 11-digit format mismatch across scripts | Consolidate to `scripts/exclusion_phones.txt`, normalize to last-10-digits everywhere |

---

## P2 — Architecture & Structure

### Stack-wide

1. **CI baseline everywhere (highest ROI item in this plan).** One reusable GitHub Actions workflow per repo: install → lint → typecheck → build (+ tests where they exist). The CRM's release workflows stay as-is; this adds the missing *quality* gate. Wireframe must first re-enable ESLint (`eslint.ignoreDuringBuilds: true`) and add `lint`/`typecheck` scripts.
2. **Minimal viable test pyramid.** Target the pure logic that's already test-shaped:
   - CRM dashboard: `lib/csv-utils.ts`, `lib/phone-canonical.ts`, `lib/call-claim.ts` (unit, Vitest); wire the existing Playwright suite into CI on a schedule.
   - Wireframe: `inline-edit.ts` (diff/tier/path logic), `store.ts` hydration + `labelEmpties`, `registry.ts` layout math.
   - ParentSite: the ingest pipeline (`rateLimit`, `auth`, `validation`, `cors`) — it's the public attack surface.
   - Al-Baghdadi: a build-time test that validates all JSON-LD against schema shapes and asserts every image path in `src/data/*` exists — SEO is the product; this catches the `dishes.ts` class of bug forever.
3. **De-duplicate phone normalization.** Three parallel implementations: `apps/dashboard/src/lib/phone-canonical.ts` (TS), `tools/local-CRM-Agent/.../PhoneNormalize.cs` (C#), bridge `phone.ts` (TS). Extract the two TS ones into a workspace package; pin all three to one shared spec + shared test vectors.
4. **Version management.** The release version lives in ~9 files bumped by hand/skill. Adopt a single-source script (`scripts/bump-version.mjs` writing all manifests) or changesets; keep the CI version-guard.
5. **Database strategy ADR.** PocketBase (CRM) + Supabase (ParentSite/Wireframe) is a workable split, but write it down: what lives where, and that the CRM→Supabase migration is dead. Kill the vestiges (see P1).

### CRM-Tableturnerr

- **Split the monsters**: `session/page.tsx` (3,259 lines), `current-call-form.tsx` (2,070), `financial/page.tsx` (1,461), `companies/page.tsx` (1,424), `import-leads-modal.tsx` (1,397). Extract per-panel components + hooks.
- **Chrome extension modernization**: `background.js` (3,327) and `popup.js` (2,939) are plain unbundled JS with no tests. Introduce a light esbuild/Vite bundle step (keeps MV3 output identical, enables modules + shared utils with the dashboard) — the dev/release manifest transform already gives you the packaging hook.
- **Tooling consistency**: add a root `tsconfig.base.json` + shared ESLint config; discord-bot/telemetry-client are on ESLint 8 + `@typescript-eslint` 7 while the dashboard is on ESLint 9 — unify.
- **Bridge**: `node:sqlite` is experimental — pin the Node version in `engines`/docs, or move to `better-sqlite3` for stability.
- Clean the stale `.claude/worktrees/gifted-montalcini-f70482/` full repo copy and the committed `playwright-report/`/`test-results/` clutter.
- Add missing READMEs: `apps/dashboard`, `packages/pocketbase-client`, `tools/tool-manager`, `tools/database`.

### ParentSite-Tableturnerr

- **Consolidate dual roots**: root `components/` + `app/components/`, root `lib/` + `app/lib/` (and `app/lib/schema.ts` vs `lib/report-schema.ts`). Pick one home (suggest `app/…`), move, and fix imports — this is the repo's biggest confusion generator.
- **Split `PostEditor.tsx` (1,782 lines)** into toolbar / editor pane / preview / autosave hook / media upload.
- **Audit bulk admin tables** (`CompaniesBulkTable` 740, `ReportsBulkTable` 642) for full-dataset client fetches; add pagination or virtualization.
- **Dependency hygiene**: move `shadcn` out of runtime `dependencies`; verify `@base-ui/react` is the intended package (vs `@base-ui-components/react`); remove the unused `playwright` devDep or add actual tests; audit the `marked` render paths (PostEditor, reports route, integrations) for sanitization of user/AI-authored markdown.
- **Rewrite `README.md`** — the top half is still create-next-app boilerplate and the report section documents the retired Markdown flow. Delete the empty `basic-client-report` skill; fix the `commit-changes` skill's copy-pasted "CRM repository" wording.

### TT-ChildSite-Wireframe

- **Frame virtualization**: all 18 frames render eagerly (home frame ≈ 15,650px tall) — mount frames only when near the viewport; this is the main perf ceiling.
- Make `createClientProfile` transactional via a server-side RPC (currently a client-side two-step that can leave unseeded rows).
- Remove the stale `out/` export + `serve-out` script.
- After P0 items: keep MCP writes bypassing edit-locks (documented, intentional) but log MCP write events for auditability.

### Al-Baghdadi-Website (the template — highest business leverage)

- **Finish the white-label extraction.** TEMPLATE.md promises "swap 6 data files"; in reality ~22 of ~30 components hardcode "Al-Baghdady"/"Iraqi"/"Richardson" (e.g. `Header.tsx` tagline, every homepage section), and `layout.tsx` embeds GTM/GA IDs + a Google verification token. Move all brand strings into `src/data/` (extend `copy.ts`/`restaurant.ts`) and analytics IDs into env. Measure success as: onboarding a new client touches **only** `src/data/` + `public/Images/` + `.env`.
- **Responsive images**: `SmartImage` renders `<img>` with a `sizes` attr but no `srcSet` — full-size photos ship to mobile. Generate width variants at build time with the already-present `sharp` (extend `scripts/optimize-images.mjs`) and emit real `srcSet`.
- **Rewrite `docs/TEMPLATE.md`** (sitemap instructions are flat wrong) and refresh README route counts — an agent following them today is actively misled.
- Drop the ~45 boilerplate keywords `metadata.ts` injects into every page (`meta keywords` is ignored by Google; it reads as stuffing).
- Repo hygiene: gitignore/remove root clutter (`audit-review.html`, `board-*.jpeg`, `screenshots/`), delete the stale `.jpg`-targeting parts of `optimize-images.mjs`.

### TT-Leads

- **Create a single source of truth**: one master table (SQLite file or `ALL_LEADS_MASTER.csv` treated as canonical) keyed on normalized 10-digit phone, with status + batch columns. This kills the dedup-by-prose problem and becomes the natural future feed into the CRM's `companies` collection if ever wanted.
- Add `requirements.txt` (playwright, openpyxl) and consolidate the three near-identical extractor scripts into one shared module; replace `eval()`/bare `except: pass` usage.
- Delete the committed 2.1 MB `repreng.csv-1.3.0.vsix` and `chat_files/entire_raw_chat.txt`; fix or remove the broken `commit-changes` skill (references non-existent `.gemini/` paths).

---

## P3 — Polish / Nice-to-have

- CRM dashboard: three.js + `@react-three/fiber` are heavyweight deps — confirm they're still used; drop if not.
- ParentSite: comment *why* `next build --webpack` opts out of Turbopack.
- Wireframe: naming — first-run seed "Al-Baghdady" vs repo "Al-Baghdadi" (cosmetic, documented in CLAUDE.md).
- Extend the telemetry hub: dashboard (Vercel) errors currently aren't shipped to the ParentSite Status/Logs pages — the ingest API already exists.
- Consider a shared `@tableturnerr/seo` package for the JSON-LD builders + `createMetadata` factory + (fixed) `SchemaInjector`, consumed by the template and future client sites, so SEO fixes propagate instead of forking.

---

## Suggested Sequence

**Week 1 — P0 sweep**
Rotate all three credential exposures → DOMPurify on wireframe overrides → `<` escaping in both SchemaInjectors → MCP zod schemas + per-client key scoping → decide the review-gating UX change.

**Weeks 2–3 — correctness + CI baseline**
All P1 fixes (small, mechanical) → lint/typecheck/build CI on all four code repos → re-enable ESLint in the wireframe → Al-Baghdadi JSON-LD + asset-existence build test.

**Month 2 — structure**
Template white-label extraction (biggest business win) → ParentSite dual-root consolidation + PostEditor split → CRM monster-file splits + phone-normalization dedup + version-bump single-sourcing → wireframe frame virtualization → TT-Leads master-table consolidation.

**Ongoing**
Unit tests alongside every touched module; keep CLAUDE.md files current (they were all refreshed 2026-07-06 — treat them as the authoritative per-repo guides).
