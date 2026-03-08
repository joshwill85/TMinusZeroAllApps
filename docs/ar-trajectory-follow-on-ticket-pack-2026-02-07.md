# AR Trajectory Follow-On Ticket Pack (From 2026-02-07 Gap Matrix)

Generated: 2026-02-07  
Source: `docs/ar-trajectory-mobile-web-industry-nasa-gap-matrix-2026-02-07.md`  
Scope: Convert prioritized gaps into execution-ready engineering tickets with exact file-level plans.

## Delivery Intent

This pack is implementation-ready. Each ticket includes:

1. Exact files to modify.
2. Decision-complete implementation steps.
3. API/schema/type impacts.
4. Test and validation criteria.
5. Rollout and risk controls.

## Dependency Order

1. `AR-P0-01` Render Loop Governance
2. `AR-P0-02` WMM Declination Service
3. `AR-P0-03` Browser Capability Profile Policy
4. `AR-P0-04` Source-Pedigree UI Labels
5. `AR-P1-01` Vehicle-Family Envelope Refinement
6. `AR-P1-02` Constraint Coverage + Freshness SLOs
7. `AR-P1-03` Offline Replay Accuracy Benchmarks
8. `AR-P2-01` Vision Lock-On Mode
9. `AR-P2-02` Advanced Uncertainty / Monte Carlo Contract (Aspirational)

## AR-P0-01 — Mode-Based Render Loop Governance

### Goal
Guarantee no unnecessary AR canvas rendering while in SkyCompass-only or hidden page states and provide telemetry proof.

### Files
- `components/ar/ArSession.tsx`
- `components/ar/SkyCompass.tsx`
- `lib/ar/telemetryClient.ts`
- `app/api/public/ar/telemetry/session/route.ts`

### Implementation Steps
1. In `ArSession`, add a single derived boolean `shouldRunArLoop` computed from:
- `showSkyCompass === false`
- `document.visibilityState === 'visible'`
- camera/render preconditions already used by draw state
2. Refactor loop lifecycle so `requestAnimationFrame` starts only when `shouldRunArLoop` transitions to true and always cancels on false.
3. Ensure `SkyCompass` remains the only active draw loop when `showSkyCompass === true`.
4. Add a monotonic `loop_epoch` counter to prevent stale closures from restarting old loops.
5. Extend telemetry payload with:
- `ar_loop_active_ms`
- `sky_compass_loop_active_ms`
- `loop_restart_count`
6. Enforce server-side numeric sanity bounds for those new fields in telemetry route.

### API / Type Changes
- Telemetry payload additions in client + route validator.
- No public launch API changes.

### Tests
1. Unit: add draw-loop lifecycle tests for transition matrix (AR↔SkyCompass, visible↔hidden).
2. Integration: simulate `visibilitychange` and verify only one loop active at a time.
3. Telemetry contract test: reject invalid/negative loop duration values.

### Acceptance Criteria
1. At any instant, max one active rendering loop.
2. Loop metrics are emitted on `end` event and persisted.
3. No blank-frame regressions on mode transitions.

### Rollout
1. Ship behind internal flag `ar_loop_governance_v1` default on in staging.
2. Promote to production after 48h telemetry confirms no increased fallback/error rate.

## AR-P0-02 — WMM-Based Declination Model

### Goal
Replace fixed magnetic-pole approximation with World Magnetic Model lookup to reduce systematic yaw bias.

### Files
- `lib/ar/geo.ts`
- `components/ar/ArSession.tsx`
- `components/ar/ArBottomPanel.tsx`
- `docs/ar-trajectory-qa-matrix.md`

### Implementation Steps
1. Add `getDeclinationDeg({ lat, lon, atDate })` in `lib/ar/geo.ts` using bundled WMM coefficients (model-year pinned).
2. Add coarse cache key in `ArSession`: `lat_bucket(0.5deg):lon_bucket(0.5deg):month_bucket`.
3. Apply correction only for non-WebXR compass sources.
4. Add quality guardrails:
- if model lookup fails, fallback to existing approximation
- emit `declination_source` telemetry bucket: `wmm|approx|none`
5. Add user-facing debug line (settings panel) with declination value and source.

### API / Type Changes
- Telemetry field: `declination_source`.
- No DB migration required.

### Tests
1. Unit tests for `getDeclinationDeg` on fixed coordinates with expected ranges.
2. Regression test for fallback behavior when WMM lookup unavailable.
3. Manual field test script updates in QA matrix.

### Acceptance Criteria
1. Declination is deterministic for same cache key.
2. Fallback path remains functional with no runtime crashes.
3. Heading residual error decreases in manual comparison runs.

### Rollout
1. Canary to Android Chrome + iOS Safari cohort via feature flag `ar_declination_wmm_v1`.
2. Full rollout when heading-noisy bucket does not regress.

## AR-P0-03 — Browser Capability Profile Policy

### Goal
Formalize and enforce browser/device support tiers with deterministic feature gating and QA targets.

### Files
- `components/ar/ArSession.tsx`
- `components/ar/CameraGuideButton.tsx`
- `lib/server/arEligibility.ts`
- `docs/ar-trajectory-qa-matrix.md`
- `docs/schedules.md`

### Implementation Steps
1. Define profile map in client:
- `android_chrome`: prefer WebXR when supported
- `android_samsung_internet`: WebXR attempt + stricter fallback messaging
- `ios_safari` / `ios_chrome`: fallback-first messaging
2. Add explicit UX copy variants per profile for motion permission and fallback rationale.
3. Persist profile bucket in telemetry and include in launch-day rehearsal checklist.
4. Add operational doc section with required must-pass matrix and release gate criteria.

### API / Type Changes
- No launch API changes.
- Telemetry enum extension for normalized `client_profile`.

### Tests
1. Unit tests for UA-to-profile mapping.
2. Snapshot tests for per-profile CTA copy states.
3. Manual matrix sign-off per QA doc.

### Acceptance Criteria
1. Every session maps to known profile bucket.
2. No ambiguous “unsupported” copy across iOS/Samsung/Android Chrome.
3. Release checklist requires profile pass evidence.

### Rollout
- Documentation and UI copy can ship immediately after staging validation.

## AR-P0-04 — Source-Pedigree Confidence Labels in UI

### Goal
Expose trajectory evidence quality to users beyond tier label alone.

### Files
- `components/ar/ArSession.tsx`
- `components/ar/ArBottomPanel.tsx`
- `app/api/public/launches/[id]/trajectory/v2/route.ts`
- `supabase/functions/trajectory-products-generate/index.ts`

### Implementation Steps
1. Standardize evidence metadata contract in product:
- `confidenceTier`
- `sourceSufficiency.sourceSummary`
- `lineageComplete`
2. In v2 API route, normalize these into stable UI-facing fields:
- `confidenceBadge`
- `evidenceLabel`
3. In AR panel, render one concise line:
- examples: `Constraint-backed (doc + landing)` / `Template estimate` / `Pad-only`
4. Block “high confidence” wording when `lineageComplete=false`.

### API / Type Changes
- Add optional response fields to `trajectory/v2` payload.
- Backward compatible.

### Tests
1. Route tests for normalized evidence labels.
2. UI tests for label rendering per quality case.
3. Generator test: forced incomplete lineage downgrades label.

### Acceptance Criteria
1. Users can distinguish estimate vs constrained trajectory at a glance.
2. No false high-confidence labels when contract fails.

### Rollout
- No migration; deploy with API+UI in same release.

## AR-P1-01 — Vehicle-Family Envelope Refinement

### Goal
Improve Tier-1/Tier-2 vertical and timing realism using vehicle-family priors.

### Files
- `supabase/functions/trajectory-products-generate/index.ts`
- `lib/types/launch.ts`
- `docs/specs/launch-ar-trajectory.md`

### Implementation Steps
1. Create envelope config table in generator keyed by normalized vehicle family.
2. Parameterize:
- ascent duration windows
- altitude envelope bounds
- sigma growth profile
3. Apply envelope when constraints are sparse; keep landing/orbit constraints dominant when present.
4. Write selected envelope id into `assumptions[]`.

### API / Type Changes
- Product `assumptions[]` enriched with `envelope_id`.
- No external API breaking change.

### Tests
1. Fixture tests for each major family bucket.
2. Guardrail test: no ground-return within active ascent horizon.
3. Snapshot test for assumptions provenance.

### Acceptance Criteria
1. Tier products vary meaningfully by family.
2. Physically implausible profiles are prevented by guardrails.

### Rollout
- Staging backfill of top eligible launches before production enable.

## AR-P1-02 — Constraint Coverage Expansion + Freshness SLOs

### Goal
Expand usable hazard/orbit constraints and enforce freshness budgets.

### Files
- `supabase/functions/trajectory-orbit-ingest/index.ts`
- `supabase/functions/trajectory-constraints-ingest/index.ts`
- `supabase/functions/navcen-bnm-ingest/index.ts`
- `supabase/functions/monitoring-check/index.ts`
- `docs/schedules.md`

### Implementation Steps
1. Add explicit per-source freshness targets in settings:
- orbit ingest max age
- landing ingest max age
- hazard ingest max age
2. Extend ingest stats payload with coverage counters by launch.
3. Update monitoring check to alert on source-specific freshness breaches.
4. Document default SLO thresholds and operator runbook.

### API / Type Changes
- System settings keys for freshness thresholds.
- Ingestion run stats enriched.

### Tests
1. Monitoring tests for stale-threshold alert creation.
2. Ingest unit tests for coverage counters.
3. Docs consistency check against job schedule.

### Acceptance Criteria
1. Alerts fire when any source exceeds age threshold.
2. Coverage counters visible for top eligible launches.

### Rollout
- Ship settings with conservative defaults, tighten after one week of telemetry.

## AR-P1-03 — Offline Replay Accuracy Benchmarks

### Goal
Measure az/el error distribution against known historical trajectories to quantify improvement.

### Files
- `scripts/ar-trajectory-coverage.ts`
- `scripts/` new: `ar-trajectory-replay-bench.ts`
- `docs/ar-trajectory-qa-matrix.md`
- `docs/ar-trajectory-mobile-web-industry-nasa-gap-matrix-2026-02-07.md`

### Implementation Steps
1. Add replay benchmark script that compares generated az/el series to reference samples.
2. Output percentile metrics: P50/P90/P95 angular error and drift over time.
3. Add CI job (non-blocking initially) to publish benchmark artifact.
4. Add benchmark section to QA matrix.

### API / Type Changes
- None.

### Tests
1. Deterministic fixture benchmark with fixed seed.
2. Script smoke test in CI.

### Acceptance Criteria
1. Benchmark produces stable metrics on repeated runs.
2. Changes to generator must report before/after accuracy deltas.

### Rollout
- Start as informational CI report, move to quality gate after baseline established.

## AR-P2-01 — Vision Lock-On Mode

### Goal
Add image-space rocket lock-on and short-horizon projection for in-flight guidance.

### Files
- `components/ar/ArSession.tsx`
- `lib/ar/` new: `visionTracker.ts`, `predictionFilter.ts`
- `app/api/public/ar/telemetry/session/route.ts`
- `docs/specs/launch-ar-trajectory.md`

### Implementation Steps
1. Add optional lock-on mode toggled in AR settings.
2. Use Worker pipeline for detection/tracking to avoid main-thread jank.
3. Produce +1s/+2s/+5s projected points with confidence decay.
4. Render ghost markers only when track confidence exceeds threshold.
5. Telemetry additions:
- `lock_on_attempted`
- `lock_on_acquired`
- `time_to_lock_bucket`
- `lock_loss_count`

### API / Type Changes
- Telemetry schema extension.
- No trajectory API breaking change.

### Tests
1. Tracker unit tests with synthetic motion sequences.
2. Frame-budget regression test under lock-on enabled.
3. Manual rehearsal checklist updates.

### Acceptance Criteria
1. Improved “keep in frame” behavior during visible ascent.
2. No major FPS regression when lock-on disabled.

### Rollout
- Beta flag `ar_lock_on_v1` on Android Chrome first.

## AR-P2-02 — Advanced Uncertainty Contract (Aspirational)

### Goal
Move from scalar sigma to richer uncertainty expression suitable for NASA-gap reduction.

### Files
- `supabase/functions/trajectory-products-generate/index.ts`
- `app/api/public/launches/[id]/trajectory/v2/route.ts`
- `components/ar/ArSession.tsx`
- `lib/types/launch.ts`

### Implementation Steps
1. Extend product samples to include optional covariance components and confidence provenance blocks.
2. Add API v2 normalization for uncertainty payload.
3. Update renderer to map uncertainty to corridor style and messaging.
4. Keep backward compatibility with existing `sigmaDeg`.

### API / Type Changes
- Add optional `uncertainty` object in product and v2 response.
- Backward compatible.

### Tests
1. Schema validation tests for mixed old/new payloads.
2. Rendering tests for covariance-aware corridor.
3. Performance test with extended payload size.

### Acceptance Criteria
1. Existing clients still function with `sigmaDeg` only.
2. New clients can render richer uncertainty without ambiguity.

### Rollout
- Two-step rollout: generator first, UI support second, then deprecate old-only assumptions.

## Release Packaging Recommendation

### Release A (Week 1)
1. `AR-P0-01`
2. `AR-P0-03`
3. `AR-P0-04`

### Release B (Week 2)
1. `AR-P0-02`
2. `AR-P1-02` monitoring/freshness subset

### Release C (Weeks 3-6)
1. `AR-P1-01`
2. `AR-P1-03`

### Release D (Quarter)
1. `AR-P2-01`
2. `AR-P2-02`

## Validation Commands (Pinned Toolchain Required)

Use pinned toolchain from `AGENTS.md` before final verification.

1. `npm run doctor`
2. `npm run type-check`
3. `npm run lint`
4. `npm run test:smoke`
5. `npm run trajectory:coverage -- --verbose`

## Open Assumptions Locked for Implementation

1. WebXR remains Android-primary; iOS remains fallback-first.
2. No breaking API changes in `trajectory/v2`; additive fields only.
3. Telemetry remains privacy-safe and bucketed, no raw location/sensor logs.
4. Feature flags are used for P0/P2 risky changes.
