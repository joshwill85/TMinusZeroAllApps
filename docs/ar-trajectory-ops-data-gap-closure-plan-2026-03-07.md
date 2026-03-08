# AR Trajectory Ops-Data Gap Closure Plan

Date: 2026-03-07
Status: Draft execution plan
Scope: AR/public trajectory generation, source ingest, trajectory observability, and closely related launch-detail enrichment work already in progress in the local worktree.

## 1. Objective

Increase the number of eligible launches that have constraint-backed AR trajectory products, while keeping rollout risk low and avoiding regressions in existing AR publish policy, confidence labeling, and launch-detail surfaces.

This plan is intentionally staged. We should not jump straight to generator changes when the repo still has:

- active local worktree edits in trajectory-adjacent files
- a pinned toolchain mismatch in the current shell
- existing admin/coverage surfaces that can be extended first to make later changes safer

## 2. Current State

### 2.1 Trajectory inputs that already affect plotted guidance

The generator already uses these sources in meaningful ways:

- `landing` constraints from LL2 landings
  - directional prior and distance scaling
- `target_orbit` constraints from mission docs / parsed public orbit signals
  - `flight_azimuth_deg`
  - `inclination_deg`
  - `altitude_km`, `apogee_km`, `perigee_km` for coarse altitude shaping
- `hazard_area` constraints from FAA TFR and NAVCEN BNM pipelines
  - directional corridor inference with time-window gating
- historical templates
  - fallback prior when directional constraints are absent
- licensed partner feed seam
  - available as a manual import path, not the default operating mode

### 2.2 Operational data that does not currently change the AR path

- NWS / Open-Meteo weather is meaningful for JEP visibility scoring, not trajectory geometry.
- WS45 forecasts are surfaced to users, not fed into the trajectory product.
- FAA advisories are surfaced on the launch page and also partially transformed into `hazard_area` constraints, but the user-facing FAA advisory surface itself is not the generator input.
- mission infographic assets are still display-only

### 2.3 Known product-model gap

The repo still does not ingest a mission-specific waypoint list, pitch program, or simulator output. Current products remain corridor estimates, not FlightClub-grade per-mission trajectories.

### 2.4 In-progress local worktree changes we must preserve

The current worktree already contains related, uncommitted work:

- `supabase/functions/trajectory-constraints-ingest/index.ts`
  - now persists `ll2_launch_landings`
- `supabase/migrations/20260307110000_launch_external_resources_and_ll2_launch_landings.sql`
  - adds `launch_external_resources`
  - adds `ll2_launch_landings`
- `lib/server/launchDetailEnrichment.ts` (untracked)
  - reads the new landing/resource tables for launch-detail enrichment

This work is useful foundation, but it changes the execution order:

- we should avoid broad generator/schema refactors until this foundation is either integrated or intentionally left untouched
- we should prefer first slices that do not force rework in those files

### 2.5 Toolchain constraint

Current shell state is off-pin:

- Node `25.8.0`
- npm `11.11.0`

Required repo pins:

- Node `20.19.6`
- npm `10.8.2`

We should not treat validation under the current shell as authoritative.

## 3. Success Criteria

### 3.1 Data quality

- truth-tier orbit coverage rises materially for the next eligible launch set
- derived-only orbit usage falls
- launches with no directional constraint fall
- stale product rate falls

### 3.2 Product quality

- AR/public trajectory products preserve existing confidence and publish-policy behavior
- no downgrade in `buildTrajectoryContract` authority labeling
- no new false-precision cases where the UI implies more certainty than the source contract supports

### 3.3 Operational safety

- no destructive edits to current in-progress launch enrichment work
- no schema churn without a clear read/write consumer path
- every phase has an explicit verification gate

## 4. Guardrails

### 4.1 Rollout rules

- extend observability before changing model behavior
- prefer additive changes over replacing current generator branches
- keep new source types behind existing confidence/publish-policy mechanisms
- do not make weather drive nominal trajectory geometry from public forecasts alone

### 4.2 Data-policy rules

- hazard geometry + valid window is valuable enough for directional inference
- live AIS / recovery-vessel tracking is explicitly out of first-pass scope
- FlightClub or equivalent remains blocked on legal/product approval
- infographic OCR stays out of core trajectory logic until precision is proven

## 5. Phased Execution

## Phase 0: Reconcile Foundation and Baseline

Goal:
Make the repo safe to modify further.

Work:

- verify how the existing `ll2_launch_landings` and `launch_external_resources` work is intended to land
- confirm whether `lib/server/launchDetailEnrichment.ts` is meant to be wired in this branch or kept separate
- restore pinned-toolchain validation path before relying on lint/typecheck/smoke
- capture a fresh baseline from:
  - `npm run trajectory:coverage`
  - `npm run trajectory:coverage:check`
  - `npm run trajectory:kpi:check`

Exit criteria:

- no ambiguity about whether the local enrichment/schema work is in-scope for this effort
- a current baseline artifact exists for trajectory coverage and KPI status

## Phase 1: Expand Trajectory Observability

Goal:
Make every eligible launch explainable before changing generator behavior.

Why first:

- low blast radius
- directly supports later rollout decisions
- avoids conflicts with the local schema/enrichment work

Recommended implementation:

- extend `app/api/admin/trajectory/inspect/[id]/route.ts`
- optionally extend `app/admin/ops/trajectory/page.tsx`
- expose per-launch gap signals such as:
  - truth-tier orbit present
  - derived-only orbit present
  - flight-azimuth numeric present
  - inclination-only orbit present
  - landing coordinates present
  - hazard geometry present
  - hazard window near NET
  - directional source actually used by the product
  - likely downgrade reason when quality is `pad_only` or `estimate_corridor`

Acceptance:

- admin can inspect the next eligible launches and immediately see why a launch is precision/guided/search/pad-only
- coverage output and inspector agree on the main gap classification

## Phase 2: Increase Truth-Tier Orbit Coverage

Goal:
Improve the best available directional source before changing fallback behavior.

Work:

- broaden provider-specific truth-domain allowlists where warranted
- improve URL/title ranking for mission brief, fact sheet, flight profile, payload guide, and mission update pages
- add parser patterns for provider-specific orbit phrasing
- ensure doc-sourced numerics outrank derived fallback rows

Primary files:

- `supabase/functions/trajectory-orbit-ingest/index.ts`
- `lib/trajectory/publicOrbitSignals.ts`
- coverage scripts in `scripts/`

Acceptance:

- eligible launches with doc-backed `target_orbit` constraints increase
- derived-only orbit rate falls without increasing bad matches

## Phase 3: Expand Hazard Coverage Carefully

Goal:
Improve directional coverage where docs do not provide explicit azimuth/inclination.

Work:

- broaden beyond current FAA/NAVCEN coverage to additional hazard bulletin formats with:
  - geometry
  - valid window
  - provenance
- keep matching conservative
- preserve existing NET window gating
- consider admin/manual insert fallback for missed high-value launches

Primary files:

- `supabase/functions/navcen-bnm-ingest/index.ts`
- `supabase/functions/faa-trajectory-hazard-ingest/index.ts`
- possibly new ingest functions for additional bulletin formats

Acceptance:

- hazard-backed directional coverage rises for launches lacking truth-tier orbit docs
- false-positive hazard matches remain rare

## Phase 4: Replace Heuristics with Learned Templates

Goal:
Reduce heuristic-only trajectories using data the repo already accumulates.

Work:

- introduce a data-backed template table/job
- derive per `(site or pad, vehicle_family, orbit_class)` priors
- use `target_orbit` as the strongest template input
- use hazards to validate/tighten
- use landing only as weak validation

Acceptance:

- common launch families stop falling back to hard-coded azimuth guesses

## Phase 5: Use Weather and Ops Data for Confidence, Not Nominal Path

Goal:
Make weather operationally meaningful to AR without pretending it can solve trajectory geometry.

Work:

- widen uncertainty or lower publish confidence when weather/ops conditions reduce practical observability
- keep nominal path driven by trajectory constraints, not cloud models
- if added, integrate through:
  - uncertainty envelope scaling
  - confidence reasons
  - publish policy / safe mode

Acceptance:

- weather-sensitive launches can be communicated as lower-confidence without distorting the path itself

## Phase 6: Licensed Mission-Specific Feed

Goal:
Add a true step-change accuracy path only after the rest of the system can absorb it safely.

Work:

- keep using the existing partner-feed seam
- only pursue FlightClub or equivalent after legal/product approval
- treat this as an authority-tier enhancement, not a bypass around source contracts

Acceptance:

- one approved partner/source can flow through the existing contract + authority model cleanly

## 6. Verification Gates

Once pinned toolchain is available, use:

- `npm run doctor`
- `npm run test:smoke`
- `npm run trajectory:coverage`
- `npm run trajectory:coverage:check`
- `npm run trajectory:kpi:check`

When touching generator behavior, also review:

- admin trajectory inspector for the next eligible launches
- trajectory contract output for authority tier, confidence tier, missing fields, and blocking reasons

## 7. First Implementation Slice

Recommended first slice:

- Phase 1 only
- extend trajectory observability in admin inspection/reporting
- do not change generator behavior yet
- do not modify the in-progress `launch_external_resources` / `ll2_launch_landings` work unless needed for compilation or explicit integration

Why this is the right first slice:

- smallest blast radius
- immediately useful for decision-making
- gives us before/after visibility for later data-ingest changes
- avoids stepping on the current uncommitted enrichment/schema work

## 8. Explicit Deferrals

Not part of the first pass:

- live AIS / vessel tracking
- sea-state / current-model driven trajectory shaping
- infographic OCR in the generator
- provider-wide FlightClub-grade path reconstruction without a licensed source

