# Repo Cleanup Audit Summary

Date: `2026-04-10`

Audit stance: audit-only. No production code, migrations, or runtime behavior were changed in this pass.

Platform matrix:
- `Web: included`
- `iOS: included`
- `Android: included`
- `Admin/internal impact: yes`
- `Shared API/backend impact: yes`
- `Request type: admin/internal repo maintenance`

## Executive Summary

- The repo shape is broadly sane: one npm workspace monorepo, one web app, one Expo mobile app, shared packages, and Supabase at the root.
- The highest-value cleanup is not a broad refactor. It is removing tracked operational residue, consolidating stale docs, and tightening a few structural seams that currently bypass the intended architecture.
- The main bloat is documentation, evidence, and script sprawl:
  - `223` tracked files under `.artifacts/`
  - `9` tracked files under `docs/evidence/three-platform/`
  - `48` dated top-level docs in `docs/2026-*.md`
  - `22` broken local markdown references
  - multiple root-level one-off guides and session logs that still describe old repo paths or pre-monorepo layouts
- The main structural drift is:
  - `shared/` exists outside `packages/` and is imported by both `apps/web` and `supabase/functions`
  - root `scripts/` depends heavily on `apps/web` internals
  - large web/server modules such as `apps/web/lib/server/v1/mobileApi.ts` have become consolidation sinks
  - launch-detail UI logic is partially shared in packages, but web/mobile component trees still duplicate a large amount of structure
- The Supabase surface is large enough to require a dedicated cleanup lane, not opportunistic edits:
  - `323` migrations
  - `71` edge functions
  - `343` `ALTER TABLE` statements
  - `161` `CREATE POLICY` statements
  - `399` `cron.` references across migrations/functions

## Blunt Findings

- Safe-now cleanup exists, but it is concentrated in repo junk, stale docs, and tracked evidence artifacts.
- Medium-risk cleanup exists, but it should be done in small PRs:
  - move `shared/ws45*.ts` into `packages/`
  - quarantine zero-reference scripts
  - archive or merge stale planning/runbook docs
  - split oversized web server modules only after residue cleanup
- High-risk cleanup exists, but it should not start until the low-risk backlog is burned down:
  - `/api/v1` and legacy route teardown
  - launch-detail component consolidation across web/mobile
  - Supabase migration baselining/squashing
  - billing/auth/premium-onboarding cleanup in the middle of an already-dirty worktree

## Evidence Snapshot

- Toolchain and workspace:
  - Node `24.14.1`, npm `11.11.0`, `npm run doctor` passes
  - npm workspaces + Turborepo
  - Next.js web app in `apps/web`
  - Expo / React Native app in `apps/mobile`
  - shared packages in `packages/*`
  - Supabase functions/migrations at repo root
- Repo shape:
  - `apps/web` clean source files: `875`
  - `apps/mobile` clean source files: `275`
  - `scripts` files: `154`
  - `docs` files: `121`
  - `supabase` files: `438`
  - `shared` files: `3`
- Generated local trees are large but not tracked:
  - `apps/web/.next`: about `1.0G`
  - `.turbo`: about `983M`
  - `node_modules`: about `1.1G`
  - `apps/mobile/ios`: about `346M`
- Tracked residue that should not live in the main code path:
  - `.artifacts/**` is tracked
  - `docs/evidence/three-platform/*` is tracked
  - root temp files and patch logs are tracked
- Recent churn hotspots over the last 90 days:
  - `apps/web`
  - `apps/mobile`
  - `supabase/migrations`
  - `supabase/functions`
  - `packages/domain`
  - `docs/three-platform-overhaul-plan.md`

## Top 25 Cleanup Opportunities By Payoff/Risk

| Rank | Path | Why it matters | Proposed first action | Confidence | Risk |
| --- | --- | --- | --- | --- | --- |
| 1 | `samSessionToken.eq.*` | Zero-value tracked residue from the initial import | `DELETE` | HIGH | LOW |
| 2 | `tmp-check.cjs`, `tmp_sam_*` | Root-level temp audit files, tracked since initial commit, no production role | `DELETE` | HIGH | LOW |
| 3 | `supabase/.branches/_current_branch` | Tracked local Supabase state marker; should not be in git | `DELETE` | HIGH | LOW |
| 4 | `agent.md` | Duplicates a subset of `AGENTS.md` and adds root clutter | `MERGE` into `AGENTS.md` or `DELETE` | HIGH | LOW |
| 5 | `THREAD_PLAN_SEO_AUDIT_VS_LAUNCH_SITES_FULL_PATCH_LOG.md` | `565KB` root patch log; not referenced; pure thread archaeology | `ARCHIVE` | HIGH | LOW |
| 6 | `SESSION_CODE_CHANGES.md` | Stale old-repo session report with pre-monorepo paths | `ARCHIVE` | HIGH | LOW |
| 7 | `ROLLBACK_DOCS.md` | Stale rollback narrative against old `app/` / `components/` layout | `ARCHIVE` | HIGH | LOW |
| 8 | `DEPLOYMENT_GUIDE.md` | One-off rollout guide for a historical Mission Control change | `ARCHIVE` | HIGH | LOW |
| 9 | `MISSION_CONTROL_IMPLEMENTATION_GUIDE.md` | Duplicates the deployment guide family and mixes obsolete examples with current paths | `ARCHIVE` | HIGH | LOW |
| 10 | `SUPABASE_CLI_GUIDE.md` | Repo-local guide duplicates canonical CLI docs and drifts easily | `ARCHIVE` or reduce to a short local runbook | HIGH | LOW |
| 11 | `.artifacts/**` | `223` tracked evidence files pollute git history and root search | `ARCHIVE` or stop tracking after extracting canonical summaries | HIGH | MEDIUM |
| 12 | `docs/evidence/three-platform/*` | Duplicates evidence already described in runbooks; versioned JSON/MD pairs are low-signal in-tree | `MERGE` or `ARCHIVE` | HIGH | MEDIUM |
| 13 | `docs/three-platform-overhaul-plan.md` | Living plan also acts as historical dump and points to missing docs | `SPLIT` into active architecture doc + archive log | HIGH | MEDIUM |
| 14 | broken refs inside `docs/three-platform-overhaul-plan.md` | Multiple links target missing `2026-03-*` docs | `MERGE` or `ARCHIVE` references | HIGH | LOW |
| 15 | broken refs inside `docs/2026-04-03-web-ios-production-compliance-*.md` | Missing mobile store/compliance docs make audits unreliable | `MERGE` into surviving docs or `ARCHIVE` dead refs | HIGH | LOW |
| 16 | top-level dated plans in `docs/2026-*.md` | `48` dated docs at docs root with no archive taxonomy | `MOVE` into `docs/architecture/`, `docs/runbooks/`, or `docs/archive/2026/` | MEDIUM | LOW |
| 17 | `shared/ws45LiveBoard.ts` | Shared business logic bypasses package boundaries | `MOVE` to `packages/` | HIGH | MEDIUM |
| 18 | `shared/ws45Parser.ts` | Same drift: shared logic outside the shared layer | `MOVE` to `packages/` | HIGH | MEDIUM |
| 19 | `shared/ws45PlanningParser.ts` | Same drift: shared logic outside the shared layer | `MOVE` to `packages/` | HIGH | MEDIUM |
| 20 | `scripts/_runLog.ts`, `billing-evidence-export-entry.mts`, `billing-regression-smoke-entry.mts`, `three-platform-baseline-capture.mts`, `tmp-inspect-missing-infographics.cjs` | Zero-reference script entrypoints with no package/workflow/docs callers | `ARCHIVE` or `DELETE` after one manual pass | MEDIUM | LOW |
| 21 | `scripts/ts-node-web-loader.mjs`, `scripts/ts-paths-loader.mjs` | Custom loaders with no current callers; likely dead compatibility residue | `MANUAL_REVIEW` then `DELETE` or `ARCHIVE` | MEDIUM | MEDIUM |
| 22 | `scripts/prod-invoke-edge-job.ts`, `scripts/prod-pipeline-health.ts` | Self-documented one-off ops scripts with no callers; may be useful but are not integrated | `MANUAL_REVIEW` / quarantine | MEDIUM | MEDIUM |
| 23 | `apps/web/components/launch/*` and `apps/mobile/src/components/launch/*` duplicated component families | Shared package exists, but duplication is still high in the view layer | `MANUAL_REVIEW` for selective consolidation | MEDIUM | MEDIUM |
| 24 | `apps/web/lib/server/v1/mobileApi.ts` | Oversized god-module that concentrates many unrelated mobile/web BFF concerns | `SPLIT` by domain after low-risk cleanup | HIGH | HIGH |
| 25 | `supabase/migrations/*` migration history | Significant policy/cron/function churn; likely history bloat, but rewrite is risky | `MANUAL_REVIEW` leading to validated baseline strategy | HIGH | HIGH |

## First Three Safe Execution Batches

1. `Batch 1: zero-risk tracked junk`
   - Delete root temp files and the tracked Supabase local-state marker.
2. `Batch 2: root doc/archive cleanup`
   - Archive one-off guides, session logs, and patch logs that still describe old paths or one-time rollouts.
3. `Batch 3: tracked evidence cleanup`
   - Move `.artifacts/**` and `docs/evidence/**` out of the main repo narrative, after fixing the docs that still reference them.

## Do Not Touch Without Human Approval

- `apps/web/lib/server/auth*`, billing, premium onboarding, and current account-creation behavior
- active dirty-worktree files already being modified outside this audit
- `/api/v1` contracts and any route removals
- `supabase/migrations/*` rewrite/squash work
- `supabase/functions/*` job topology and scheduler changes
- launch-detail / AR / JEP behavior changes
- mobile signing, EAS, native config, and app-store-facing release config

