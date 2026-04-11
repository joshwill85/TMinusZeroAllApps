# Execution Batches

Date: `2026-04-10`

The batches below are ordered for reviewability and rollback safety. No production-code cleanup should start before Batch 1 and Batch 2 are complete.

## Batch 1: Zero-Risk Tracked Junk

Target files:
- `samSessionToken.eq.`
- `samSessionToken.eq.,metadata-`
- `samSessionToken.eq.,raw-`
- `tmp-check.cjs`
- `tmp_sam_audit.js`
- `tmp_sam_audit_log.js`
- `tmp_sam_checkpoint_check.cjs`
- `tmp_sam_range_check.cjs`
- `tmp_sam_solnum_check.cjs`
- `supabase/.branches/_current_branch`

Why this batch exists:
- all items are root/local-state residue
- none are part of the runtime or shared package graph
- several are tracked since the initial import and have no credible product role

Expected payoff:
- immediate root cleanup
- lower search noise
- removes obviously accidental tracked state

Validation:
- `git diff --stat`
- `rg -n 'samSessionToken|tmp_sam|tmp-check|_current_branch' .`

Rollback:
- restore from git if any item turns out to matter

Human approval required:
- `No`

## Batch 2: Root Docs And Session Logs

Target files:
- `agent.md`
- `SESSION_CODE_CHANGES.md`
- `ROLLBACK_DOCS.md`
- `THREAD_PLAN_SEO_AUDIT_VS_LAUNCH_SITES_FULL_PATCH_LOG.md`
- `DEPLOYMENT_GUIDE.md`
- `MISSION_CONTROL_IMPLEMENTATION_GUIDE.md`
- `SUPABASE_CLI_GUIDE.md`

Why this batch exists:
- these files are root clutter
- several reference old repo paths or the pre-monorepo layout
- two are a duplicate guide family for one historical rollout

Expected payoff:
- cleaner root
- fewer misleading setup/rollback instructions
- less search pollution from historical narratives

Validation:
- `rg -n '/Users/petpawlooza/Documents/TMinusNow|app/|components/' docs *.md`
- ensure `README.md` and active docs still point to the right current sources

Rollback:
- archive rather than hard-delete if preferred
- restore individual files from git if needed

Human approval required:
- `Yes` if the user wants archival rather than direct removal

## Batch 3: Evidence Rationalization

Target files:
- tracked `.artifacts/**`
- tracked `docs/evidence/three-platform/*`
- docs that still reference those evidence paths

Why this batch exists:
- raw evidence and generated outputs should not live as general repo source
- the repo currently has two different long-term homes for generated proof

Expected payoff:
- materially smaller tracked noise
- fewer generated JSON/markdown blobs in normal search results
- clearer line between durable docs and regeneratable evidence

Validation:
- missing-doc/reference check
- confirm surviving runbooks still explain how to reproduce evidence

Rollback:
- archive first, then remove tracking later if desired

Human approval required:
- `Yes`

## Batch 4: Broken Docs And Archive Taxonomy

Target files:
- `docs/three-platform-overhaul-plan.md`
- `docs/2026-04-03-web-ios-production-compliance-audit.md`
- `docs/2026-04-03-web-ios-production-compliance-deep-audit.md`
- other docs with missing local references
- dated docs to relocate into `docs/archive/2026/`, `docs/runbooks/`, or `docs/architecture/`

Why this batch exists:
- broken local references are objective staleness
- docs root currently mixes active and historical material without taxonomy

Expected payoff:
- active docs become trustworthy again
- historical docs remain available but stop polluting the active path

Validation:
- markdown local-reference check
- spot-check current source-of-truth links from `README.md` and `AGENTS.md`

Rollback:
- file moves are easily reversible

Human approval required:
- `Yes`

## Batch 5: Script Quarantine

Target files:
- likely orphans:
  - `scripts/_runLog.ts`
  - `scripts/billing-evidence-export-entry.mts`
  - `scripts/billing-regression-smoke-entry.mts`
  - `scripts/three-platform-baseline-capture.mts`
  - `scripts/tmp-inspect-missing-infographics.cjs`
- manual-review scripts:
  - `scripts/ts-node-web-loader.mjs`
  - `scripts/ts-paths-loader.mjs`
  - `scripts/prod-invoke-edge-job.ts`
  - `scripts/prod-pipeline-health.ts`

Why this batch exists:
- some script entrypoints have no package/workflow/doc callers
- the repo needs a quarantine lane before deletion

Expected payoff:
- lower tooling sprawl
- clearer set of maintained operational entrypoints

Validation:
- `npm run doctor`
- `rg -n '<script-name>' package.json .github docs`
- if moved, verify remaining commands still work

Rollback:
- restore quarantined scripts from git or move them back

Human approval required:
- `Yes`

## Batch 6: Shared Runtime Boundary Cleanup

Target files:
- `shared/ws45LiveBoard.ts`
- `shared/ws45Parser.ts`
- `shared/ws45PlanningParser.ts`
- all import sites in `apps/web` and `supabase/functions`

Why this batch exists:
- runtime shared logic belongs in `packages/`, not root `shared/`

Expected payoff:
- clearer package graph
- fewer architecture exceptions

Validation:
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run type-check:ci`
- `npm run type-check:mobile` if any shared imports reach mobile later
- relevant WS45 smoke if a repo-owned one exists; otherwise `npm run test:smoke`

Rollback:
- revert move/import changes together

Human approval required:
- `No`

## Batch 7: Helper And Module Consolidation

Target files:
- `apps/web/lib/server/v1/mobileApi.ts`
- related v1 helper modules
- selected duplicated launch-detail pure logic where a canonical shared home is obvious

Why this batch exists:
- this is where maintainability gains start, but risk rises

Expected payoff:
- smaller modules
- less duplicated payload shaping logic
- easier review and testing

Validation:
- `npm run doctor`
- `npm run test:v1-contracts`
- `npm run test:web-regression`
- `npm run test:smoke`
- `npm run type-check:ci`
- `npm run lint`

Rollback:
- keep changes batched by domain; revert batch as one unit

Human approval required:
- `Yes`

## Batch 8: Legacy Path / Flag Teardown

Target files:
- legacy or compatibility surfaces such as:
  - `apps/web/app/api/public/launches/[id]/trajectory/v2/route.ts`
  - compatibility shims like `apps/web/lib/utils/returnTo.ts`
  - selected rollout-gated paths proven fully cut over

Why this batch exists:
- only after the repo is cleaner should legacy-path removal start

Expected payoff:
- less dead-path maintenance
- lower cognitive overhead

Validation:
- route-level impact analysis
- `npm run test:v1-contracts`
- `npm run test:web-regression`
- `npm run test:mobile-query-guard` if shared flows are affected
- targeted smoke for owning surfaces

Rollback:
- keep fallback path available until new path has soak evidence

Human approval required:
- `Yes`

## Batch 9: Supabase Baseline And Guardrails

Target files:
- migration inventory docs
- later: baseline migration branch
- CI/report-only hygiene scripts
- AGENTS/CODEOWNERS updates

Why this batch exists:
- migration cleanup and anti-bloat guardrails should land after the low-risk residue is gone

Expected payoff:
- safer long-term DB maintenance
- slower bloat regrowth

Validation:
- for guardrails:
  - `npm run doctor`
  - existing CI checks
- for migration work:
  - `supabase db reset`
  - `supabase db diff`
  - `npm run test:v1-contracts`
  - `npm run test:smoke`

Rollback:
- keep guardrails report-only first
- keep baseline migration work on a dedicated branch until parity is proven

Human approval required:
- `Yes`

