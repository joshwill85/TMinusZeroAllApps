# Guardrails Proposal

Date: `2026-04-10`

The goal is to slow bloat growth without making the repo miserable to work in.

## 1. AGENTS.md Updates To Add

Add explicit repo-hygiene rules:

- canonical root structure:
  - `apps/`
  - `packages/`
  - `supabase/`
  - `tooling/` or `scripts/`
  - `docs/`
- root-level file allowlist:
  - config only
  - no session logs
  - no patch logs
  - no temp scripts
- generated artifact policy:
  - `.artifacts/` is local by default
  - if evidence must be preserved, summarize it in `docs/runbooks/` or archive it explicitly
- docs policy:
  - active docs go in `docs/architecture/`, `docs/runbooks/`, or `docs/adr/`
  - superseded docs go in `docs/archive/<year>/`
- shared logic policy:
  - runtime shared logic must live in `packages/*`, not `shared/`
- script policy:
  - new scripts must declare whether they are `guard`, `audit`, `backfill`, or `ops`
- feature-flag rule:
  - every new flag needs an owner, a cleanup issue/date, and a declared removal condition

## 2. CODEOWNERS Recommendations

Suggested ownership boundaries:

- `.github/**`, `Dockerfile`, `docker-compose.yml`
  - platform / release owner
- `apps/mobile/app.json`, `apps/mobile/app.config.ts`, `eas.json`, native modules
  - mobile owner
- `apps/web/lib/server/auth*`, `apps/web/lib/server/billing*`, `apps/web/app/api/billing/**`, `apps/web/app/api/auth/**`
  - auth/billing owner
- `packages/contracts/**`, `packages/api-client/**`, `packages/domain/**`, `packages/navigation/**`, `packages/query/**`
  - shared-platform owner
- `supabase/migrations/**`, `supabase/functions/**`, `supabase/config.toml`
  - database/backend owner
- `docs/architecture/**`, `docs/runbooks/**`
  - architecture/release owner

## 3. CI Guardrails: Report-Only First

Do this before adding hard failures.

### Proposed report-only checks

- `repo-hygiene-report`
  - fail level: report-only initially
  - flags:
    - tracked files under `.artifacts/`
    - tracked root temp files (`tmp*`, `samSessionToken*`)
    - root markdown files outside an allowlist
    - tracked local state files under `supabase/.branches` or `supabase/.temp`
- `docs-reference-report`
  - report missing local markdown links
- `script-reference-report`
  - report script entrypoints with no package/workflow/doc references
- `shared-boundary-report`
  - report imports from `shared/`
- `script-import-boundary-report`
  - report scripts importing UI modules or app-internal code

### After tuning false positives

Promote only the safest rules to hard fail:
- tracked root temp files
- tracked local state files
- missing local markdown refs in active docs
- new files under `shared/`

## 4. Boundary Enforcement

The repo already has `scripts/three-platform-boundary-check.cjs`.

Recommended path:
- extend existing custom checks before introducing a large new framework
- add:
  - no new runtime code under root `shared/`
  - no `scripts/` imports from UI component paths
  - no new root docs outside allowlisted files

Possible later follow-up:
- `dependency-cruiser` in report-only mode for circulars/import drift
- only after rules are tuned and noise is acceptable

## 5. Generated Files Policy

- `.artifacts/`
  - local by default
  - not tracked unless there is a deliberate exception
- `docs/evidence/`
  - for curated, small, human-readable evidence only
  - not for raw generated JSON dumps
- snapshots / fixtures
  - keep only when they protect behavior
  - keep them beside the owning test/tooling domain
- native generated folders
  - continue ignoring `.expo`, `.next`, `.turbo`, native build outputs, and local state

## 6. Duplicate Helper Policy

Before adding a new helper/module:
- search the canonical homes first:
  - `packages/domain`
  - `packages/navigation`
  - `packages/query`
  - `packages/contracts`
  - `apps/web/lib/server`
- if a helper is single-use and UI-local, keep it near the owner
- if it is shared business logic, move or create it in the shared package layer
- do not add new “compat”, “shim”, or “legacy” modules without a removal note

## 7. Docs Placement Rules

- `docs/architecture/`
  - active structure/source-of-truth docs
- `docs/runbooks/`
  - operational procedures still used by humans
- `docs/adr/`
  - durable decisions
- `docs/archive/2026/`
  - superseded plans, audits, and rollout notes

Rules:
- one active source-of-truth per topic
- historical notes can exist, but they should be archived and linked from the current source-of-truth

## 8. Feature-Flag Retirement Rule

Every new flag must include:
- owner
- date added
- intended removal milestone
- cleanup issue or doc reference
- whether it protects runtime, data migration, or UI rollout

Retirement review:
- flags older than one release cycle should be reviewed
- “temporary”, “compat”, and “legacy” flags should be treated as debt by default

