# AR Trajectory Gap Closure Tracker

Date: 2026-02-09  
Scope: P1-01, P2-01, P2-02 closure status from `docs/ar-trajectory-follow-on-ticket-pack-2026-02-07.md`.

Update: 2026-02-10  
Scope addendum: P0 guardrails + ops mismatch visibility.

## Status

### P1-01 — Vehicle-Family Envelope Refinement
- [x] Envelope provenance IDs written into `assumptions[]` for pad-only, landing-constrained, and tier-2 estimate branches.
- [x] Envelope provenance source recorded (`pad_only`, `landing_constraint`, `orbit_constraint`, `hazard_area`, `template_prior`, `heuristic`).
- [x] Envelope family tag recorded in `assumptions[]`.
- [x] Family-specific ascent envelope parameters (duration/altitude/sigma) separated from generic profile defaults.

### P2-01 — Vision Lock-On Mode
- [x] Worker-based tracker pipeline added (bright/motion centroid + alpha-beta filter).
- [x] +1s/+2s/+5s ghost predictions rendered in AR canvas when lock confidence is above threshold.
- [x] Production UX defaults to auto lock-on attempt; manual lock controls moved behind debug-only flag (`NEXT_PUBLIC_AR_LOCK_ON_MANUAL_DEBUG=1`).
- [x] Existing lock telemetry counters now persist through API (`lock_on_attempted`, `lock_on_acquired`, `time_to_lock_bucket`, `lock_loss_count`).
- [x] Lock-on telemetry now tags session mode (`lock_on_mode=auto|manual_debug`) to keep release metrics clean.
- [ ] Manual field validation pass across Android target devices.
- [x] Frame budget regression baseline and acceptance thresholds captured.
- [x] Field validation checklist + pass/fail telemetry sheet documented (`docs/ar-lock-on-android-field-validation-checklist-2026-02-09.md`).
- [x] Field validation telemetry report automation script added (`scripts/ar-lock-on-field-report.ts`, `npm run trajectory:lock-on:field-report`).

### P2-02 — Advanced Uncertainty Contract
- [x] Product samples include `uncertainty` object (alongside legacy `sigmaDeg` and `covariance` fields).
- [x] v2 API now normalizes and exposes `covariance` and `uncertainty` while preserving `sigmaDeg` backward compatibility.
- [x] Renderer behavior differentiated by covariance shape (not only scalar sigma corridor width).
- [x] Contract tests for uncertainty compatibility across legacy/new sample payloads.
- [x] Replay benchmark gate path documented and wired in CI (strict default).

### P0-02 — Precision-Claim Publish Guard
- [x] Shared publish-policy helper added to enforce pad-only fallback when precision claims fail source contract/freshness/lineage checks (`lib/ar/trajectoryPublishPolicy.ts`).
- [x] Public v2 trajectory API now applies publish-policy before returning tracks/milestones/product (`app/api/public/launches/[id]/trajectory/v2/route.ts`).
- [x] AR launch page now applies the same publish-policy path used by API responses (`app/launches/[id]/ar/page.tsx`).
- [x] Smoke tests added for policy pass/fail and pad-only downgrade behavior (`scripts/smoke-tests.ts`).

### P0-03 — Scheduler/Cron Mismatch Visibility
- [x] Monitoring job now checks `system_settings` enabled flags vs cron active state and raises mismatch alerts (`supabase/functions/monitoring-check/index.ts`).
- [x] Mismatch alerts now map back to job cards in Admin Ops (`app/admin/_lib/jobs.ts`).
- [x] Admin summary status now marks cron/enablement mismatches as degraded with explicit status detail (`app/api/admin/summary/route.ts`).
- [x] Admin Ops job status line now shows combined enabled/status detail text so mismatches are visible without drilldown (`app/admin/ops/page.tsx`).

### P1-02 — Calibration Friction Reduction
- [x] Manual and auto calibration paths now share the same strict aim/stability guardrail function in AR session logic (`components/ar/ArSession.tsx`).
- [x] Auto-calibration arming timer added so calibration can execute automatically after users hold a stable aligned pose (`components/ar/ArSession.tsx`).
- [x] Retry/reset flows now clear auto-calibration state to avoid stale attempts (`components/ar/ArSession.tsx`).
- [x] Wizard now surfaces auto-calibration readiness hint when conditions are met (`components/ar/ArSession.tsx`).
- [ ] Field validation pass for auto-calibration behavior across required Android/iOS profiles.

### AR-P2-01 — Authority-Backed Source Coverage Expansion
- [x] Orbit ingest now supports selecting multiple truth-tier source documents before fallback (`supabase/functions/trajectory-orbit-ingest/index.ts`).
- [x] Source-document default budget increased (default 3, max 4) to improve non-pad-only constraint capture (`supabase/functions/trajectory-orbit-ingest/index.ts`).
- [x] Default truth-domain allowlist expanded to additional official provider/agency domains (`supabase/functions/trajectory-orbit-ingest/index.ts`).
- [x] Ranking keywords now prioritize mission brief / flight profile / payload users guide / fact-sheet style documents (`supabase/functions/trajectory-orbit-ingest/index.ts`).
- [x] Coverage report now summarizes truth-tier versus derived-only orbit constraint coverage (`scripts/ar-trajectory-coverage.ts`).
- [x] Policy-based coverage checker now emits machine-readable pass/fail report artifacts for next-launch windows (`docs/specs/ar-trajectory-coverage-policy-v1.json`, `scripts/ar-trajectory-coverage-check.ts`).
- [x] Coverage remediation script now triggers trajectory source/product refresh jobs with report artifacts (`scripts/ar-trajectory-refresh-jobs.ts`, `docs/ar-trajectory-remediation-runbook-2026-02-10.md`).
- [ ] Field run and report: verify increased truth-tier orbit coverage across next-launch sample window.

### AR-P2-02 — Vehicle-Family Envelope Refinement v2
- [x] Envelope family matching expanded for additional launch vehicle aliases (Atlas/Vulcan/Ariane/Soyuz/H3/Long March/Antares/PSLV/SSLV/New Glenn/SLS) (`supabase/functions/trajectory-products-generate/index.ts`).
- [x] Landing-constrained trajectory generation now uses family-specific baseline sigma defaults (`supabase/functions/trajectory-products-generate/index.ts`).
- [x] Tier-2 corridor generation now clamps sigma to family-specific bounds (`supabase/functions/trajectory-products-generate/index.ts`).
- [x] Target-orbit altitude inference now clamps to active family envelope altitude bounds (`supabase/functions/trajectory-products-generate/index.ts`).
- [x] Family replay policy checker added for representative case thresholds and wired in CI (`docs/specs/ar-trajectory-family-replay-policy-v1.json`, `scripts/ar-trajectory-family-replay-check.ts`, `.github/workflows/ci.yml`).
- [ ] Replay + field validation pass across representative vehicle families to confirm no regression in drift/error.

### AR-P2-03 — Accuracy Observability Dashboard
- [x] Admin summary payload now includes trajectory accuracy telemetry rollups (lock attempt/acquisition rates, fallback rate, sigma/trajectory quality coverage, contract tier coverage, daily trend) (`app/api/admin/summary/route.ts`).
- [x] Admin trajectory UI now renders an "Accuracy observability" panel with KPI cards, fallback/time-to-lock distributions, and daily trend rows (`app/admin/ops/trajectory/page.tsx`).
- [x] Admin trajectory pipeline payload now includes precision stale + source freshness + ingest coverage structures expected by the UI (`app/api/admin/summary/route.ts`, `app/admin/_lib/types.ts`).
- [ ] Calibrate KPI thresholds/targets for release policy and compare trend deltas release-over-release.

### AR-P3-01 — KPI Policy Contract
- [x] Versioned KPI policy contract added for replay quality, lock stability/usability, fallback resilience, precision coverage, and comparative regression limits (`docs/specs/ar-trajectory-kpi-policy-v1.json`).
- [x] KPI policy checker script added with machine-readable output + pass/fail exit semantics (`scripts/ar-trajectory-kpi-check.ts`).
- [x] KPI exception policy file + expiry validation added so temporary waivers stay explicit and auditable (`docs/specs/ar-trajectory-kpi-exceptions-v1.json`, `scripts/ar-trajectory-kpi-check.ts`).
- [ ] Tune telemetry KPI thresholds from production signal once enough field sessions accumulate.

### AR-P3-02 — Comparative Benchmark Artifact
- [x] Baseline replay report snapshot added for release-over-release comparison (`scripts/fixtures/ar-trajectory-replay-baseline-v1.json`).
- [x] Comparative benchmark outputs now emitted as JSON and Markdown artifacts by KPI checker (`scripts/ar-trajectory-kpi-check.ts`).
- [x] CI now runs KPI/comparative check and uploads artifacts for each pipeline run (`.github/workflows/ci.yml`).
- [x] Release-over-release trend history artifact path added with seeded history fixture and CI output (`scripts/fixtures/ar-trajectory-kpi-history-v1.json`, `scripts/ar-trajectory-kpi-history.ts`, `.github/workflows/ci.yml`).
- [x] Policy exception flow wired into KPI checker (expiring exception rows, explicit applied-exception status in report) (`docs/specs/ar-trajectory-kpi-exceptions-v1.json`, `scripts/ar-trajectory-kpi-check.ts`).

## Verification Notes

- Default shell remains mismatched (`node v24.5.0`, `npm 11.9.0`), but verification was run under an isolated pinned runtime:
  - Node `20.19.6` / npm `10.8.2` from `/tmp/node-v20.19.6-darwin-arm64/bin`
  - `npm ci`
  - `npm run type-check`
  - `npm run lint` (passes with one pre-existing hook dependency warning in `components/LaunchFeed.tsx`)
  - `npm run test:smoke`
  - `npm run trajectory:replay-bench -- --output=.artifacts/ar-trajectory-replay-bench.json`
  - `npm run trajectory:replay-gate -- --report=.artifacts/ar-trajectory-replay-bench.json` (PASS)
  - `npm run trajectory:replay:family-check -- --report=.artifacts/ar-trajectory-replay-bench.json --output=.artifacts/ar-trajectory-family-replay-check.json --markdown=.artifacts/ar-trajectory-family-replay-check.md` (PASS)
  - `npm run trajectory:kpi:check -- --skip-db --exceptions=docs/specs/ar-trajectory-kpi-exceptions-v1.json --report=.artifacts/ar-trajectory-replay-bench.json --output=.artifacts/ar-trajectory-kpi-eval.json --compare-output=.artifacts/ar-trajectory-benchmark-compare.json --compare-markdown=.artifacts/ar-trajectory-benchmark-compare.md` (PASS)
  - `npm run trajectory:kpi:history -- --kpi=.artifacts/ar-trajectory-kpi-eval.json --compare=.artifacts/ar-trajectory-benchmark-compare.json --history-in=scripts/fixtures/ar-trajectory-kpi-history-v1.json --history-out=.artifacts/ar-trajectory-kpi-history.json --markdown=.artifacts/ar-trajectory-kpi-history.md --run-id=local-smoke --source=local` (PASS)
  - `npm run trajectory:coverage:check -- --skip-db --output=.artifacts/ar-trajectory-coverage-check.json --markdown=.artifacts/ar-trajectory-coverage-check.md` (PASS, skip-db mode for non-admin environments)
  - `npm run trajectory:coverage:check -- --warn-only --output=.artifacts/ar-trajectory-coverage-check-db.json --markdown=.artifacts/ar-trajectory-coverage-check-db.md` (WARN; latest default-window sample: truth-tier `0.0%`, no-directional `50.0%`, stale/missing products `62.5%`)
  - `npm run trajectory:refresh:jobs -- --dry-run --output=.artifacts/ar-trajectory-refresh-jobs-dryrun.json --markdown=.artifacts/ar-trajectory-refresh-jobs-dryrun.md` (PASS)
  - `npm run trajectory:coverage -- --limit=1` (current sample still shows derived-only target-orbit for sampled Starlink launch)
  - P2-03 admin telemetry rollup changes compile/lint/smoke clean under pinned toolchain.
- Docker parity check is now confirmed:
  - `docker run --rm node:20.19.6-alpine node -v` -> `v20.19.6`
  - `docker run --rm node:20.19.6-alpine npm -v` -> `10.8.2`
  - `docker run --rm -v "$PWD":/workspace -w /workspace node:20.19.6-alpine sh -lc "npm run doctor"` -> `toolchain: ok`
- Lock-on frame-budget + toolchain/Docker runbook: `docs/ar-lock-on-frame-budget-runbook-2026-02-09.md`.
- Android lock-on manual checklist and pass/fail sheet: `docs/ar-lock-on-android-field-validation-checklist-2026-02-09.md`.
