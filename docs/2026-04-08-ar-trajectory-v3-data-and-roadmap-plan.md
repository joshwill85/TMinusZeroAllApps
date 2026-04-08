# 2026-04-08 AR Trajectory V3 Data And Roadmap Plan

Last updated: 2026-04-08

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

## Source Inputs

- Reviewed external product/spec inputs:
  - `ar_trajectory_best_in_class_blueprint.docx`
  - `ar_trajectory_blueprint_v2_repo_aligned.docx`
- Repo source-of-truth inputs:
  - `docs/2026-04-07-ar-trajectory-current-system-spec.md`
  - `docs/ar-trajectory-three-surface-best-in-class-validation-plan-2026-04-01.md`
  - `docs/ar-trajectory-execution-backlog-2026-02-10.md`
  - `docs/specs/ar-trajectory-kpi-policy-v1.json`
  - `docs/specs/ar-trajectory-family-replay-policy-v1.json`
  - `docs/specs/ar-trajectory-coverage-policy-v1.json`

## Executive Direction

The correct migration is not "rebuild AR from scratch." The correct migration is:

1. raise source authority and operational reliability
2. fix telemetry and field evidence completeness
3. dual-write a richer `v3` mission package under the current contracts
4. simplify the phone product around finding and tracking the rocket honestly
5. add bounded actualization only after truth and evidence are strong enough

The first blueprint is strong as product thesis. The repo-aligned second blueprint is the better execution base. This plan keeps the thesis, keeps the repo architecture, and removes the remaining ambiguity around policy authority, uncertainty semantics, and rollout order.

## Current State Snapshot

- Future launches in `launches_public_cache`: `362`
- Future launches with `rocket_family`: `0 / 362`
- Rows in `launch_trajectory_products`: `85`
- Future launches with trajectory products: `15`
- Quality distribution:
  - `estimate_corridor`: `72`
  - `landing_constrained`: `2`
  - `pad_only`: `11`
- AR telemetry rows in `ar_camera_guide_sessions`: `102`
- Recent telemetry profile distribution:
  - `ios_webkit`: `43`
  - `null`: `59`
- Recent telemetry mode distribution:
  - `ar`: `48`
  - `sky_compass`: `22`
  - `null`: `32`
- Recent telemetry pose-mode distribution:
  - `sensor_fused`: `13`
  - `null`: `89`
- Android native module reality today:
  - `supportsWorldTracking`: available on supported ARCore devices
  - `supportsHeadingAlignment`: `false`
  - `supportsGeoTracking`: `false`

## What This Means

- The limiting factor is still truth acquisition and source coverage, not AR rendering polish.
- Family/template selection is materially underpowered because future-launch family segmentation is effectively absent.
- Telemetry is too sparse and too null-heavy to justify broad runtime sophistication without first improving observability.
- Platform strategy must stay asymmetric:
  - `iOS native`: flagship premium runtime
  - `iPhone web`: polished WebKit camera-overlay experience
  - `Android Chrome`: progressive browser AR where healthy
  - `Android native`: first-class surface, but not yet geospatial-parity product

## Locked Decisions

- Do not do a clean-slate rewrite.
- Keep `/api/v1` additive. No breaking public AR contract changes without explicit approval and a compatibility plan.
- Keep `TrajectoryPublicV2ResponseV1` and current server routes stable while `v3` dual-write is introduced.
- Treat `docs/specs/ar-trajectory-kpi-policy-v1.json`, `docs/specs/ar-trajectory-family-replay-policy-v1.json`, and `docs/specs/ar-trajectory-coverage-policy-v1.json` as the canonical release gate set until they are explicitly revised.
- Do not create a second competing pass/fail authority in prose-only docs.
- Keep uncertainty terminology statistically honest:
  - `1-sigma` remains statistical
  - conservative user-facing safety bounds must be named separately, such as `safe_envelope`
  - do not require `95%` of samples inside a field labeled `1-sigma`
- Allow a single mission-specific top-authority source to unlock precision when provenance is explicit and confidence rules are met. A second corroborating directional source is preferred, but it is not universally required.
- Treat FAA/NAVCEN hazard geometry as corroboration and operations context, not as the ascent-truth source.
- Treat actualization as bounded bias correction, not live trajectory inference.
- No new ingest is allowed to move forward unless it passes an explicit ingest admission gate:
  - `1.` Is the target data actually available from the source in a usable form?
  - `2.` If available, can it be joined to T-Minus Zero launch identity with stable keys or deterministic matching?
  - `3.` If joinable, do our real launches actually have the needed values at useful coverage levels?
- On-device CV, lock-on, or visual evidence must never rewrite:
  - branch topology
  - milestone timing
  - recovery classification
  - mission identity

## Non-Goals For This Plan

- No FlightClub-grade mission-specific path promises without licensed or operator-provided structured truth.
- No assumption that public FAA surfaces can act as a consumer live-state feed.
- No iPhone web design that assumes non-WebKit browser-engine behavior.
- No heavy OCR-first investment before official mission-doc coverage and parser operations are strong.
- No forced same-UI parity across web, iOS, and Android.

## Phase 0 - Lock Policy Authority And Terminology

Duration: `1 week`  
Owners: `Product`, `Backend/Data`, `Frontend AR`, `Platform/Ops`, `QA`

### Goal

Turn the reviewed blueprint direction into one repo-owned release authority and one additive rollout plan.

### Work

- Keep the existing policy files as canonical until revised in-repo:
  - `docs/specs/ar-trajectory-kpi-policy-v1.json`
  - `docs/specs/ar-trajectory-family-replay-policy-v1.json`
  - `docs/specs/ar-trajectory-coverage-policy-v1.json`
- If new thresholds or families are adopted from the reviewed blueprint, change the policy JSON files directly rather than creating doc-only thresholds.
- Standardize uncertainty vocabulary for all future implementation work:
  - statistical sigma envelope
  - user-facing safe envelope
  - quality state
  - confidence tier
- Standardize authority vocabulary:
  - mission-specific top authority
  - corroborative directional source
  - heuristic fallback
  - publish-eligible precision
- Define rollout flags up front:
  - `AR_TRAJECTORY_V3_DUAL_WRITE`
  - `AR_TRAJECTORY_V3_READ_PATH`
  - `AR_TRAJECTORY_V3_UI`
  - `AR_TRAJECTORY_BIAS_CORRECTION`
  - `AR_TRAJECTORY_PARTNER_LIVE`

### Primary Files

- `docs/2026-04-07-ar-trajectory-current-system-spec.md`
- `docs/ar-trajectory-three-surface-best-in-class-validation-plan-2026-04-01.md`
- `docs/ar-trajectory-execution-backlog-2026-02-10.md`
- `docs/specs/ar-trajectory-kpi-policy-v1.json`
- `docs/specs/ar-trajectory-family-replay-policy-v1.json`
- `docs/specs/ar-trajectory-coverage-policy-v1.json`

### Exit Gate

- One repo-owned release gate set exists.
- One approved uncertainty vocabulary exists.
- One approved authority hierarchy exists.
- No duplicate KPI or replay authority remains in planning docs.

## Phase 1 - Telemetry Completeness And Field Evidence

Duration: `2 weeks`  
Owners: `Frontend AR`, `Mobile`, `Platform/Ops`, `QA`

### Goal

Make runtime evidence trustworthy enough to guide product decisions and later actualization work.

### Work

- Eliminate `null` telemetry for the minimum required runtime fields:
  - `clientProfile`
  - `release_profile`
  - `modeEntered`
  - `poseMode`
  - `visionBackend`
  - `time_to_usable_ms`
  - `location_fix_state`
  - `alignment_ready`
  - runtime capability fields exposed by native modules
- Ensure native telemetry uses the same shared contract with complete capability and session-state population.
- Finish required Android field-validation evidence instead of leaving the platform represented only by code-path assumptions.
- Surface completeness and stale-evidence state in admin/ops so the launch window can be judged from the repo’s own evidence.
- Require attached session IDs for every required field run in the validation matrix.

### Primary Files

- `apps/web/app/api/admin/summary/route.ts`
- `apps/web/app/admin/ops/trajectory/page.tsx`
- `apps/web/lib/server/arTelemetrySession.ts`
- `apps/web/lib/ar/telemetryClient.ts`
- `apps/mobile/app/launches/ar/[id].tsx`
- `packages/domain/src/arTelemetryEvidence.ts`
- `scripts/ar-surface-evidence-build.ts`
- `scripts/ar-lock-on-field-report.ts`
- `apps/mobile/modules/tmz-ar-trajectory/ios/TmzArTrajectoryView.swift`
- `apps/mobile/modules/tmz-ar-trajectory/android/src/main/java/expo/modules/tmzartrajectory/TmzArTrajectoryView.kt`

### Exit Gate

- Required telemetry field completeness is `>= 95%` for validation sessions.
- Android required device/browser matrix has evidence attached for every row.
- No required runtime family is represented by `unknown` or `null` in release evidence.
- Admin trajectory views expose evidence freshness and missing-field rates directly.

## Phase 2 - Source Authority, Parser Ops, And Family Segmentation

Duration: `3-4 weeks`  
Owners: `Backend/Data`, `Platform/Ops`

### Goal

Raise truth quality and publishable precision coverage by improving mission-source acquisition, parse operations, and vehicle/family segmentation.

### Work

- Require an ingest admission review before building or expanding any new source adapter.
- For every proposed ingest, answer these questions in writing before implementation:
  - availability: is the field or artifact we want really present from the source, or are we assuming it exists?
  - joinability: can we connect that source to our launch records with stable identifiers, URLs, times, pads, or other deterministic matching rules?
  - usable coverage: across our actual launch mix, do enough launches have the values we need to justify the ingest?
- Treat any `no` answer above as a stop condition for that ingest unless there is explicit approval for a narrow spike.
- Prefer low-cost audits before new ingest work:
  - source sample audit
  - join-key audit
  - eligible-launch coverage audit
- Store the result of each ingest admission review in the repo so future source work does not restart the same investigation.
- Use `docs/templates/ar-trajectory-ingest-admission-review-template.md` for every new review.
- Record the current decision in `docs/2026-04-08-ar-trajectory-ingest-admission-registry.md` before implementation starts.
- Keep `docs/specs/ar-trajectory-ingest-admission-registry-v1.json` aligned with the Markdown registry so the decision set is machine-checkable.
- Prioritize official mission pages, mission PDFs, flight-profile documents, payload user guides, fact sheets, and provider/agency references over generic derived heuristics.
- Keep FAA/NAVCEN hazard geometry as corroboration and schedule/operations context only.
- Add parser operational controls for each source adapter:
  - last success time
  - parser version
  - fixture coverage count
  - stale age
  - error category
  - launch-window severity
- Commit deterministic parser fixtures for provider HTML/PDF structure so adapter changes are reviewable and regression-tested.
- Add TTL-bound manual overrides with explicit precedence, operator attribution, reason, and expiry.
- Fill `rocket_family` for future launches using `ll2_rocket_config_id`, normalized vehicle aliases, and mission-orbit fallback where needed.
- Separate truth signals by field instead of overloading one coarse constraint blob:
  - direction authority
  - milestone authority
  - recovery authority
  - visibility authority

### Proposed Additive Data Model

- `mission_profile_signals`
  - one row per launch and signal family
  - stores normalized source-derived directional, milestone, recovery, and visibility evidence
- `source_adapter_runs`
  - one row per adapter execution
  - stores parser health, freshness, and failure metadata
- `manual_overrides`
  - one row per temporary operator override
  - stores owner, reason, expiry, and precedence
- `vehicle_family_map`
  - stable normalized family mapping keyed to `ll2_rocket_config_id` and alias set

### Primary Files

- `docs/2026-04-08-ar-trajectory-v3-data-and-roadmap-plan.md`
- `docs/templates/ar-trajectory-ingest-admission-review-template.md`
- `docs/2026-04-08-ar-trajectory-ingest-admission-registry.md`
- `docs/specs/ar-trajectory-ingest-admission-registry-v1.json`
- `supabase/functions/trajectory-orbit-ingest/index.ts`
- `supabase/functions/trajectory-constraints-ingest/index.ts`
- `supabase/functions/navcen-bnm-ingest/index.ts`
- `supabase/functions/faa-tfr-ingest/index.ts`
- `supabase/functions/faa-notam-detail-ingest/index.ts`
- `supabase/functions/faa-launch-match/index.ts`
- `supabase/functions/_shared/faa.ts`
- `supabase/functions/ll2-future-launch-sync/index.ts`
- `supabase/functions/_shared/ll2Ingest.ts`
- `scripts/ar-trajectory-coverage.ts`
- `scripts/ar-trajectory-coverage-check.ts`
- `scripts/ar-trajectory-refresh-jobs.ts`
- `docs/ar-trajectory-execution-backlog-2026-02-10.md`
- `apps/web/app/api/admin/summary/route.ts`
- `apps/web/app/admin/ops/trajectory/page.tsx`

### Exit Gate

- Every new ingest in scope has a written availability, joinability, and usable-coverage decision.
- Eligible-window truth-tier directional coverage reaches `>= 70%`.
- No-directional launches in the eligible window fall to `<= 20%`.
- Missing or stale products in the eligible window fall to `<= 10%`.
- `rocket_family` is complete for the eligible future-launch window.
- Parser trailing `30d` health is `>= 98%`.

## Phase 3 - Additive V3 Mission Package And Dual-Write

Duration: `4-6 weeks`  
Owners: `Backend/Data`, `Shared Contracts`, `Web`

### Goal

Introduce a richer `v3` truth package without breaking the current web or mobile readers.

### Work

- Dual-write a `mission_package_v3` and a compact `mission_live_state_v1` from the existing generation cycle.
- Keep `launch_trajectory_products` and current read paths live until parity, rollout, and rollback drills are complete.
- Build adapters that keep emitting:
  - internal server shapes already used by web
  - `TrajectoryPublicV2ResponseV1`
  - current `/api/v1` trajectory response shape
- Keep current publish policy behavior stable for legacy consumers:
  - `pad_only`
  - `estimate_corridor`
  - current confidence-tier semantics
- Add richer `v3` components behind adapters:
  - mission identity and family
  - branch topology
  - milestones with authority lineage
  - recovery semantics
  - visibility products
  - uncertainty surfaces
  - provenance and source coverage
  - actualization eligibility policy

### Primary Files

- `supabase/functions/trajectory-products-generate/index.ts`
- `supabase/functions/trajectory-templates-generate/index.ts`
- `packages/contracts/src/index.ts`
- `packages/domain/src/trajectory/contract.ts`
- `packages/domain/src/trajectory/fieldAuthority.ts`
- `packages/domain/src/trajectory/evidence.ts`
- `packages/domain/src/trajectory/milestones.ts`
- `apps/web/lib/server/arTrajectory.ts`
- `apps/web/lib/server/trajectoryContract.ts`
- `apps/web/app/api/public/launches/[id]/trajectory/v2/route.ts`
- `apps/web/app/api/v1/launches/[id]/trajectory/route.ts`

### Exit Gate

- `v3` dual-write runs behind a flag with no legacy read-path regression.
- Golden fixtures show adapter parity for current public and internal consumers.
- Rollback to legacy read path can be completed in `< 5 min`.
- Publish-policy fallbacks remain stable while `v3` is shadowed.

## Phase 4 - Product Delivery: Sky Finder First

Duration: `4-6 weeks`  
Owners: `Frontend AR`, `Mobile`, `Design/Product`, `QA`

### Goal

Ship a cleaner handheld product that optimizes for "find the rocket now" instead of exposing every mission detail in the aiming view.

### Work

- Split customer-facing AR into two layers:
  - `Sky finder`: active branch, T+ bead, pad marker, horizon cue, confidence chip
  - `Mission ribbon`: topology, milestones, recovery semantics, scrubbing, provenance
- Keep web, iOS, and Android behavior aligned at the truth and terminology level, not at the pixel or runtime level.
- Add visibility-oriented helpers that materially improve real use:
  - first-visible T+
  - terrain/horizon masking
  - occluded intervals
  - WMM-backed heading sanity cues
- Keep degradation honest:
  - precision only when runtime quality and truth authority permit it
  - corridor or pad guidance otherwise
- Extend admin/ops readouts to show why a package is not precision-eligible.

### Primary Files

- `apps/web/components/ar/ArSession.tsx`
- `apps/web/components/ar/ArBottomPanel.tsx`
- `apps/web/components/ar/SkyCompass.tsx`
- `apps/web/app/launches/[id]/ar/page.tsx`
- `apps/web/app/launches/[id]/page.tsx`
- `apps/web/lib/ar/runtimeSelector.ts`
- `apps/web/lib/ar/sessionStatus.ts`
- `apps/web/lib/ar/performanceGovernor.ts`
- `apps/mobile/app/launches/[id].tsx`
- `apps/mobile/app/launches/ar/[id].tsx`
- `apps/mobile/src/api/queries.ts`
- `apps/mobile/modules/tmz-ar-trajectory/ios/TmzArTrajectoryView.swift`
- `apps/mobile/modules/tmz-ar-trajectory/android/src/main/java/expo/modules/tmzartrajectory/TmzArTrajectoryView.kt`
- `apps/web/app/api/admin/summary/route.ts`
- `apps/web/app/admin/ops/trajectory/page.tsx`

### Exit Gate

- Phone AR defaults to the simpler sky-finder flow on all customer surfaces.
- p95 cold open is `<= 5s` on web and `<= 4s` on native.
- Warm open is `<= 2.8s` on web and `<= 2.0s` on native.
- Precision eligibility messaging is visible and truthful on all customer surfaces.

## Phase 5 - Bounded Actualization

Duration: `3-4 weeks`  
Owners: `Frontend AR`, `Mobile`, `Backend`, `QA/Analytics`

### Goal

Improve tracking quality through conservative bias correction, not uncontrolled live inference.

### Work

- Introduce explicit actualization modes:
  - `predicted`
  - `bias_corrected`
  - `partner_live`
- Allow yaw/pitch bias correction only inside declared envelopes.
- Persist actualization evidence:
  - bias deltas
  - stability timer
  - correction origin
  - downgrade reason
- Require widening to happen faster than narrowing.
- Forbid actualization from changing mission truth structures:
  - no branch rewrites
  - no milestone rewrites
  - no recovery-target rewrites
- Keep manual tap-to-lock viable as an operator- and user-facing assist, but do not let debug-only controls become the release path.

### Primary Files

- `apps/web/lib/ar/alignmentFeedback.ts`
- `apps/web/lib/ar/predictionFilter.ts`
- `apps/web/lib/ar/visionTrackerCore.ts`
- `apps/web/lib/ar/visionTracker.worker.ts`
- `apps/web/app/api/public/ar/telemetry/session/route.ts`
- `apps/web/app/api/v1/ar/telemetry/session/route.ts`
- `apps/web/lib/server/arTelemetrySession.ts`
- `packages/contracts/src/index.ts`
- `apps/mobile/app/launches/ar/[id].tsx`
- `apps/mobile/modules/tmz-ar-trajectory/ios/TmzArTrajectoryView.swift`
- `apps/mobile/modules/tmz-ar-trajectory/android/src/main/java/expo/modules/tmzartrajectory/TmzArTrajectoryView.kt`
- `scripts/ar-trajectory-replay-bench.ts`
- `scripts/ar-trajectory-replay-gate.ts`
- `scripts/ar-lock-on-field-report.ts`

### Exit Gate

- Pilot-family median tracking error improves by `>= 20%`.
- Worst-case p95 regression stays `<= 0.5 deg`.
- Downgrade-to-safe behavior is faster than correction-to-precision behavior.
- No topology or milestone regressions appear in replay or field evidence.

## Phase 6 - Optional Partner-Live Track

Duration: `optional`  
Owners: `Backend/Data`, `Product`, `Legal`, `Platform`

### Goal

Support licensed or operator-provided live mission state without contaminating the core predicted stack.

### Work

- Keep partner-live as a separate truth mode, not an implicit replacement for prediction or actualization.
- Preserve lineage so customers and operators can always tell whether a view is:
  - predicted
  - bias-corrected
  - partner-live
- Require contractual or operator approval before this mode is treated as production truth.

### Primary Files

- `apps/web/lib/trajectory/partnerFeedAdapter.ts`
- `scripts/trajectory-partner-feed-import.ts`
- `packages/contracts/src/index.ts`

### Exit Gate

- Partner-live mode is explicitly labeled end-to-end.
- Partner-live can be disabled without breaking predicted or bias-corrected modes.

## Rollout Order

1. Land this plan and lock policy authority.
2. Fix telemetry completeness and field evidence.
3. Raise source authority and family segmentation.
4. Introduce `v3` dual-write under existing contracts.
5. Ship the simplified sky-finder product.
6. Add bounded actualization on a narrow family pilot.
7. Consider partner-live only after the core stack is stable.

## Rollback Notes

- Policy-file updates are independent of runtime rollout and can be reverted cleanly.
- `v3` must remain shadow-write and flag-gated until adapter parity is proven.
- UI rollout must not require immediate migration to `v3`; the legacy path remains the fallback until read-path cutover is deliberate.
- Actualization must ship behind a separate flag from `v3` dual-write.
- Partner-live must remain separately disableable at all times.

## Verification

Required when implementation work starts and the shell matches the pinned toolchain:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:smoke`
- `npm run type-check:ci`
- `npm run type-check:mobile` when mobile code changes
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile` when mobile code changes
- `npm run trajectory:coverage:check`
- `npm run trajectory:replay-bench`
- `npm run trajectory:replay-gate`
- `npm run trajectory:replay:family-check`
- `npm run trajectory:kpi:check`
- `npm run trajectory:surface-evidence`
- `npm run trajectory:lock-on:field-report`

## Immediate First Slice

- Phase 0 policy authority cleanup
- Phase 1 telemetry null-elimination
- Phase 2 `rocket_family` completion and parser-health instrumentation
- Phase 3 `v3` dual-write schema sketch with adapter parity fixtures
