# Candidate Matrix

Date: `2026-04-10`

Legend:
- Allowed actions: `DELETE`, `ARCHIVE`, `MERGE`, `MOVE`, `KEEP`, `MANUAL_REVIEW`
- Confidence:
  - `HIGH`: multiple proofs of deadness/duplication + low runtime/data risk
  - `MEDIUM`: strong signal, some runtime/config uncertainty
  - `LOW`: ambiguous or high-risk

| Path | Category | Evidence | Proposed action | Confidence | Risk | Canonical replacement or home | Validation needed | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `samSessionToken.eq.` + siblings | dead file / residue | tracked since initial commit, zero product role | `DELETE` | HIGH | LOW | none | grep absence | root junk |
| `tmp-check.cjs`, `tmp_sam_*` | dead file / residue | tracked temp audit helpers, never integrated | `DELETE` | HIGH | LOW | none | grep absence | root junk |
| `supabase/.branches/_current_branch` | local state | tracked local Supabase branch marker | `DELETE` | HIGH | LOW | none | git status + grep absence | should never be versioned |
| `agent.md` | duplicate doc | tiny subset of `AGENTS.md`, root clutter | `MERGE` | HIGH | LOW | `AGENTS.md` | compare content | likely removable |
| `THREAD_PLAN_SEO_AUDIT_VS_LAUNCH_SITES_FULL_PATCH_LOG.md` | abandoned archive log | huge root patch log, no callers | `ARCHIVE` | HIGH | LOW | `docs/archive/2026/` | none beyond broken-ref scan | git history already preserves patches |
| `SESSION_CODE_CHANGES.md` | stale doc | references old repo path and old layout | `ARCHIVE` | HIGH | LOW | `docs/archive/2026/` | broken-ref scan | historical only |
| `ROLLBACK_DOCS.md` | stale doc | pre-monorepo `app/` / `components/` paths | `ARCHIVE` | HIGH | LOW | `docs/archive/2026/` | broken-ref scan | misleading if left active |
| `DEPLOYMENT_GUIDE.md` | stale doc | one-off Mission Control rollout guide | `ARCHIVE` | HIGH | LOW | `docs/archive/2026/` | none | superseded |
| `MISSION_CONTROL_IMPLEMENTATION_GUIDE.md` | duplicate doc | overlaps deployment guide; one-time rollout narrative | `ARCHIVE` | HIGH | LOW | `docs/archive/2026/` | none | duplicate guide family |
| `SUPABASE_CLI_GUIDE.md` | stale doc | duplicates generic CLI knowledge, likely to drift | `ARCHIVE` | HIGH | LOW | short local runbook under `docs/runbooks/` | verify README pointers | keep only repo-specific guidance if needed |
| `.artifacts/**` | tracked generated artifacts | `223` tracked files; generated logs/json/md outputs | `ARCHIVE` | HIGH | MEDIUM | external artifact store or archived evidence bundle | doc-reference repair | large payoff |
| `docs/evidence/three-platform/*` | duplicated evidence | overlaps `.artifacts` and runbooks | `MERGE` | HIGH | MEDIUM | `docs/runbooks/` or `docs/archive/2026/` | doc-reference repair | keep only curated summaries |
| `docs/three-platform-overhaul-plan.md` | doc sprawl | living plan + history dump + missing refs | `MERGE` | HIGH | MEDIUM | `docs/architecture/three-platform.md` + `docs/archive/2026/` | broken-ref scan | split active vs historical |
| missing refs from `docs/three-platform-overhaul-plan.md` | broken docs | missing `2026-03-*` and other plan files | `MERGE` | HIGH | LOW | surviving active docs or archive index | link check | objective staleness |
| missing refs from `docs/2026-04-03-web-ios-production-compliance*.md` | broken docs | missing mobile store/compliance docs | `MERGE` | HIGH | LOW | active compliance source-of-truth doc | link check | archive or replace refs |
| `docs/2026-*.md` at docs root | docs taxonomy drift | `48` dated docs at top level | `MOVE` | MEDIUM | LOW | `docs/architecture/`, `docs/runbooks/`, `docs/archive/2026/` | link check | classification pass |
| `shared/ws45LiveBoard.ts` | architecture drift | imported by web + Supabase functions outside packages | `MOVE` | HIGH | MEDIUM | `packages/ws45/src/liveBoard.ts` | type-check + smoke | good early structural fix |
| `shared/ws45Parser.ts` | architecture drift | imported by web + Supabase functions outside packages | `MOVE` | HIGH | MEDIUM | `packages/ws45/src/parser.ts` | type-check + smoke | same issue |
| `shared/ws45PlanningParser.ts` | architecture drift | imported by Supabase functions outside packages | `MOVE` | HIGH | MEDIUM | `packages/ws45/src/planningParser.ts` | type-check + smoke | same issue |
| `scripts/_runLog.ts` | orphan script | zero known callers | `ARCHIVE` | MEDIUM | LOW | `tooling/scripts/archive/` | grep + manual review | quarantine first |
| `scripts/billing-evidence-export-entry.mts` | orphan script | zero known callers | `ARCHIVE` | MEDIUM | LOW | `tooling/scripts/archive/` | grep + manual review | quarantine first |
| `scripts/billing-regression-smoke-entry.mts` | orphan script | zero known callers | `ARCHIVE` | MEDIUM | LOW | `tooling/scripts/archive/` | grep + manual review | quarantine first |
| `scripts/three-platform-baseline-capture.mts` | orphan script | zero known callers; `.ts` variant is the actual command target | `DELETE` | HIGH | LOW | `scripts/three-platform-baseline-capture.ts` | grep absence | strong duplicate signal |
| `scripts/tmp-inspect-missing-infographics.cjs` | orphan temp script | zero known callers; temp naming | `DELETE` | HIGH | LOW | none | grep absence | root temp pattern inside scripts |
| `scripts/ts-node-web-loader.mjs`, `scripts/ts-paths-loader.mjs` | compatibility residue | zero known callers; custom loaders | `MANUAL_REVIEW` | MEDIUM | MEDIUM | none yet | grep + manual review | could be old tooling fallback |
| `scripts/prod-invoke-edge-job.ts`, `scripts/prod-pipeline-health.ts` | one-off ops scripts | zero package/workflow/doc callers, but self-documented usage | `MANUAL_REVIEW` | MEDIUM | MEDIUM | `tooling/scripts/ops/` | owner review | do not delete blind |
| `scripts/*` importing `apps/web` internals | architecture drift | many scripts use `@/lib/...` and `../apps/web/...` | `MANUAL_REVIEW` | MEDIUM | MEDIUM | shared packages or `tooling/` utilities | targeted refactor + smoke | tooling/app coupling |
| `apps/web/components/launch/*` and `apps/mobile/src/components/launch/*` | duplication | large set of same-named components in both trees | `MANUAL_REVIEW` | MEDIUM | MEDIUM | shared package for pure logic only | UI diff + targeted regression | do not over-share UI |
| `apps/web/lib/server/v1/mobileApi.ts` | god module | huge file with many unrelated responsibilities | `MANUAL_REVIEW` | HIGH | HIGH | split by domain under `apps/web/lib/server/v1/` | full targeted validation | worth doing, not first |
| `apps/web/app/api/public/launches/[id]/trajectory/v2/route.ts` | legacy path | explicit `v2` route in active tree | `MANUAL_REVIEW` | LOW | HIGH | current public/v1 trajectory path | route usage review | could still be live |
| `apps/web/lib/utils/returnTo.ts` | compatibility shim | guard script explicitly calls it a compatibility shim | `MANUAL_REVIEW` | MEDIUM | MEDIUM | `@tminuszero/navigation` | auth flow regression checks | remove only after call-site review |
| `apps/web/next.config.mjs` `transpilePackages` list | config drift | includes packages with little/no current web usage | `MANUAL_REVIEW` | LOW | LOW | minimal actual import set | build + dev boot | tiny payoff |
| `supabase/migrations/*` policy churn | migration bloat | many drop/create policy cycles | `MANUAL_REVIEW` | HIGH | HIGH | validated baseline migration branch | `supabase db reset` + diff | strategy only for now |
| `supabase/migrations/*` scheduler/function churn | migration bloat | repeated `invoke_edge_job` / `managed_scheduler_*` rewrites | `MANUAL_REVIEW` | HIGH | HIGH | validated baseline migration branch | `supabase db reset` + diff | strategy only for now |
| `supabase/.temp/*` | local generated state | local state exists but is ignored and untracked | `KEEP` | HIGH | LOW | ignored local state | none | report only |
| `apps/web/.next`, `.turbo`, `node_modules` | generated / vendor | large locally, not tracked | `KEEP` | HIGH | LOW | ignored outputs | none | exclude from architecture cleanup |
| `apps/mobile/ios`, `apps/mobile/android`, `apps/mobile/.expo` | local generated/native | large locally, not tracked | `KEEP` | HIGH | LOW | ignored local native/build outputs | none | do not treat as tracked bloat |
| `packages/launch-detail-ui` | shared package | real cross-web/mobile usage | `KEEP` | HIGH | LOW | current package | none | not dead code |
| `packages/design-tokens` | shared package | small but active on mobile; valid shared home | `KEEP` | HIGH | LOW | current package | none | not a deletion target |

