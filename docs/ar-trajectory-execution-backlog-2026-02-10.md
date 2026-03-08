# AR Trajectory Execution Backlog

Date: 2026-02-10  
Owner model: Backend, Frontend AR, Platform/Ops, QA.  
Status key: `done`, `in_progress`, `todo`, `blocked`.

## P0 — Reliability + Truth Guardrails

1. `AR-P0-01` Android field validation evidence
- Status: `in_progress`
- Owner: QA + Frontend AR
- Scope: Complete required device/browser checklist runs and attach telemetry session IDs.
- Current state: Field-evidence report automation is now available through `npm run trajectory:lock-on:field-report`; remaining work is running required device/browser sessions and attaching session IDs.
- Acceptance: All required rows pass/fail with linked evidence and no untriaged failures.

2. `AR-P0-02` Precision-claim publish guard
- Status: `done`
- Owner: Backend
- Scope: Enforce pad-only fallback whenever precision claim contract/freshness/lineage checks fail.
- Implemented in:
  - `lib/ar/trajectoryPublishPolicy.ts`
  - `app/api/public/launches/[id]/trajectory/v2/route.ts`
  - `app/launches/[id]/ar/page.tsx`
  - `scripts/smoke-tests.ts`

3. `AR-P0-03` Cron vs enabled mismatch visibility
- Status: `done`
- Owner: Platform/Ops + Backend
- Scope: Detect and alert when `system_settings` enablement diverges from cron active state.
- Implemented in:
  - `supabase/functions/monitoring-check/index.ts`
  - `app/api/admin/summary/route.ts`
  - `app/admin/_lib/jobs.ts`
  - `app/admin/ops/page.tsx`

## P1 — UX Automation + Gates

1. `AR-P1-01` Production zero-manual lock workflow
- Status: `in_progress`
- Owner: Frontend AR
- Scope: Keep manual lock controls debug-only, confirm production auto-lock dominance via telemetry.
- Current state: Manual lock controls are already behind `NEXT_PUBLIC_AR_LOCK_ON_MANUAL_DEBUG=1`; field evidence still pending in `AR-P0-01`.

2. `AR-P1-02` Calibration friction reduction
- Status: `in_progress`
- Owner: Frontend AR
- Scope: Reduce user calibration interactions without increasing replay drift/error.
- Current state: auto-calibration arming + execution path added in `components/ar/ArSession.tsx` when motion/camera/aim stability conditions are satisfied.

3. `AR-P1-03` Replay gate release enforcement
- Status: `done`
- Owner: Platform/DevEx
- Scope: Run replay bench + strict gate in CI.
- Current state: Present in `.github/workflows/ci.yml`.

## P2 — Model + Data Authority

1. `AR-P2-01` Authority-backed source coverage expansion
- Status: `in_progress`
- Owner: Backend/Data
- Scope: Increase high-confidence non-pad-only coverage for eligible launches.
- Current state:
  - Orbit ingest now supports up to 4 docs per launch (default 3) and prioritizes multiple truth-tier docs before fallback selection.
  - Default truth-domain allowlist expanded to include additional official launch-provider/agency domains.
  - URL/title ranking now favors mission-brief, flight-profile, payload-user-guide, and fact-sheet style documents.
  - Derived source seeds expanded for Blue Origin, NASA, JAXA, and Rocket Lab mission/update pages.
  - Coverage report now summarizes truth-tier vs derived-only orbit constraint coverage.
  - Policy-based coverage checker now emits pass/fail JSON + Markdown artifacts for next-launch coverage windows.
  - Latest DB-backed coverage check (2026-02-10, default window) reports: truth-tier orbit coverage `0.0%`, no-directional-constraint `50.0%`, missing/stale products `62.5%` (still below policy target).
  - Remediation command now exists to trigger trajectory source/product refresh jobs and re-check coverage in a single runbook flow.
- Implemented in:
  - `supabase/functions/trajectory-orbit-ingest/index.ts`
  - `scripts/ar-trajectory-coverage.ts`
  - `docs/specs/ar-trajectory-coverage-policy-v1.json`
  - `scripts/ar-trajectory-coverage-check.ts`
  - `scripts/ar-trajectory-refresh-jobs.ts`
  - `docs/ar-trajectory-remediation-runbook-2026-02-10.md`

2. `AR-P2-02` Vehicle-family envelope refinement v2
- Status: `in_progress`
- Owner: Backend/Data
- Scope: Improve per-family ascent envelope and uncertainty behavior.
- Current state:
  - Family matching now covers additional vehicle aliases (Atlas, Vulcan, Ariane, Soyuz, H3, Long March, Antares, PSLV/SSLV, New Glenn, SLS) through existing envelope profiles.
  - Landing-constrained products now use family baseline sigma defaults (instead of a fixed global default).
  - Tier-2 uncertainty now clamps to per-family sigma ranges.
  - Tier-2 altitude inference from target orbit now clamps against active family envelope bounds.
  - Family-specific replay policy checker now verifies representative case thresholds and is enforced in CI.
- Implemented in:
  - `supabase/functions/trajectory-products-generate/index.ts`
  - `docs/specs/ar-trajectory-family-replay-policy-v1.json`
  - `scripts/ar-trajectory-family-replay-check.ts`
  - `.github/workflows/ci.yml`

3. `AR-P2-03` Accuracy observability dashboard
- Status: `in_progress`
- Owner: Platform + Analytics
- Scope: Trend dashboard for lock stability, fallback rates, and trajectory precision coverage.
- Current state:
  - Admin summary now returns trajectory accuracy rollups (windowed lock attempt/acquisition, fallback rate, sigma-quality coverage, contract tier coverage, daily trend).
  - Admin Trajectory page now renders an "Accuracy observability" section with trend + distribution readouts.
  - Pipeline freshness response now includes precision stale counts and source freshness thresholds/counters expected by Trajectory Admin UI.
- Implemented in:
  - `app/api/admin/summary/route.ts`
  - `app/admin/ops/trajectory/page.tsx`
  - `app/admin/_lib/types.ts`

## P3 — Competitive KPI Proof

1. `AR-P3-01` KPI policy contract
- Status: `in_progress`
- Owner: Product + Analytics + Eng
- Scope: Versioned KPI thresholds for release readiness.
- Current state:
  - Versioned KPI policy contract added with lock usability, fallback resilience, precision coverage, replay quality, and comparative-regression thresholds.
  - New KPI checker script evaluates replay report + comparative deltas against policy and optionally evaluates DB telemetry KPIs.
  - Expiring exception contract + checker validation added for intentional temporary waivers.
- Implemented in:
  - `docs/specs/ar-trajectory-kpi-policy-v1.json`
  - `docs/specs/ar-trajectory-kpi-exceptions-v1.json`
  - `scripts/ar-trajectory-kpi-check.ts`
  - `package.json`

2. `AR-P3-02` Comparative benchmark artifact
- Status: `done`
- Owner: Analytics
- Scope: Release-over-release benchmark report and pass/fail trend.
- Current state:
  - Baseline replay benchmark snapshot committed for release-over-release diff checks.
  - KPI checker now emits comparative benchmark artifacts in both JSON and Markdown formats.
  - CI now runs KPI policy/comparative check (replay-based, DB-skipped) and uploads artifacts for each run.
  - KPI history artifact generation is wired and backed by a versioned history fixture.
- Implemented in:
  - `scripts/fixtures/ar-trajectory-replay-baseline-v1.json`
  - `scripts/fixtures/ar-trajectory-kpi-history-v1.json`
  - `scripts/ar-trajectory-kpi-check.ts`
  - `scripts/ar-trajectory-kpi-history.ts`
  - `.github/workflows/ci.yml`
