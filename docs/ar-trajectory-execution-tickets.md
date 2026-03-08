# AR Trajectory — Execution Tickets (State-of-the-Art, Cross-Platform)

Generated: 2026-01-23
Updated: 2026-02-09 (lock-on worker beta + uncertainty/envelope profile + frame-budget runbook)
Scope: Web AR “Camera Guide” + trajectory data pipeline + reliability/accuracy work.  
Primary reference: `docs/specs/launch-ar-trajectory.md`
Audit references:
- `docs/ar-trajectory-audit-report-2026-01-24.md`
- `docs/ar-trajectory-model-upgrade-data-deep-dive.md`

Progress log:
- 2026-02-09: Added lock-on worker tracker scaffolding with +1/+2/+5s ghost predictions, wired lock-on telemetry persistence API fields, and added envelope provenance IDs + uncertainty pass-through for trajectory v2.
- 2026-02-09: Added family-specific envelope profile parameters, covariance-aware renderer behavior in AR/SkyCompass, uncertainty compatibility smoke checks, and lock-on frame-budget acceptance thresholds/runbook.
- 2026-02-09: Added Android lock-on manual field-validation checklist + pass/fail sheet and replay benchmark gate path in CI (strict default).
- 2026-02-09: Switched production lock-on UX to auto-attempt mode (manual controls are debug-only via `NEXT_PUBLIC_AR_LOCK_ON_MANUAL_DEBUG=1`) and added `lock_on_mode` telemetry tagging.

## Goals (explicit)

1. **Correctness first**: never draw physically implausible trajectories or misleading confidence.
2. **Android is first-class**: on supported Android devices, **WebXR immersive-ar should be the best experience** (more stable pose than compass-based yaw).
3. **iOS works well**: iOS Safari is expected to run in non-WebXR mode with best-effort sensors + honest uncertainty.
4. **Measurable iteration**: every change includes acceptance criteria + validation commands + telemetry signals.

## Non-goals (for these tickets)

- Native app (ARKit/ARCore SDK) work.
- Perfect mission-by-mission FlightClub-grade 6DOF guidance worldwide without constraints/telemetry.

## Definitions (shared language)

### Trajectory tiers (product side)

- **Tier 0 — `pad_only`**: pad marker + bearing/elevation from user position to pad at `T+0`.
- **Tier 1 — `landing_constrained`**: downrange corridor constrained by *landing metadata* (should constrain azimuth; must not imply the rocket “lands” in 180s).
- **Tier 2 — `estimate_corridor`**: best-effort corridor from **target orbit** and/or **hazards** and/or **templates** (wide uncertainty).
- **Tier 3 — observed lock-on (client)**: pixel-space tracking once rocket is visible (does not rely on compass yaw).

### Pose sources (client side)

- `webxr`: XR viewer pose (Android Chrome/ARCore where available).
- `deviceorientation`: compass/IMU pose (iOS/Android fallback).
- `sky_compass`: no camera/motion/heading; render the “Sky Compass” view.

## Milestones (phases)

- **Phase 0 (P0)**: UX smoothness + ops visibility + premium gating hardening.
- **Phase 1 (P1)**: core heading correctness (trust + declination) + camera FOV inference.
- **Phase 2 (P2)**: “use all available data” (constraints ranking, orbit numeric usage, hazard coverage, infographic feasibility).
- **Phase 3 (P3)**: advanced sensor fusion (toggle, **off by default**).
- **Phase 4 (P4)**: Tier-3 vision lock-on (pixel-space tracking).

---

## Target device/browser support (explicit)

### Tier A (must be great)

- **iOS Safari (WebKit)**: non-WebXR camera+location+DeviceOrientation; excellent permission UX + honest uncertainty.
- **Android Chrome**:
  - if WebXR `immersive-ar` supported: primary path is WebXR
  - else: non-WebXR fallback should still be usable

### Tier B (supported)

- **iOS Chrome / Firefox** (WebKit): same behavior as iOS Safari; validate permission flows.
- **Android Firefox**: non-WebXR fallback; validate sensor availability differences.

### Tier C (debug-only)

- Desktop browsers: Sky Compass / debug-only tooling; no camera-AR promises.

---

## Recommended execution order (high level)

- **P0**: T0 (contract), T11–T17 (UX/perf/ops/RLS), then finish any remaining items in T2.
- **P1**: T18–T20.
- **P2**: T8–T9, then T21–T24.
- **P3**: T25.
- **P4**: T10.

---

## Tickets (ordered backlog)

### T0 — Freeze the “Trajectory Product Contract” (stop drift)

**Priority**: P0  
**Why**: Multiple tiers exist; drift between docs / generator / client causes silent regressions.  
**Files**:
- `docs/specs/launch-ar-trajectory.md`
- `supabase/functions/trajectory-products-generate/index.ts`
- `components/ar/ArSession.tsx`

**Tasks**
- [x] Document the exact schema and invariants:
  - [x] `product.samples[]` monotonic time, duration, nominal `stepS`
  - [x] `quality` and `qualityLabel` mapping
  - [x] meaning of `sigmaDeg`
  - [x] how milestones/events are derived and how duration affects them
- [x] Add a short “client assumptions” section (what ArSession expects and what it does when missing).

**DoD**
- Spec and implementation agree on: tier meanings, duration expectations, and “honesty rules”.

**Validation**
- `npm run type-check`
- `npm run lint`

---

### T1 — Fix Tier-1 `landing_constrained` product correctness (do not draw a “landing arc”)

**Priority**: P0  
**Why**: Current Tier-1 product is physically misleading (altitude returns to ~0 and endpoint is the landing site at ~T+180).  
**Files**
- `supabase/functions/trajectory-products-generate/index.ts`

**Tasks**
- [x] Redefine Tier-1: landing data constrains **azimuth corridor**, not trajectory endpoint.
- [x] Ensure altitude profile is monotonic (or at least not returning to ground in the product horizon).
- [x] Ensure product duration supports timeline events (avoid hard 180s truncation).
- [x] Update `assumptions[]` to explicitly state the model limitation (e.g., “azimuth constrained by landing; vertical profile generic”).

**DoD**
- Tier-1 does not imply a rapid return to ground.
- Milestone chips do not disappear due to artificially short duration.

**Validation**
- `npm run test:smoke`
- `npm run type-check`

---

### T2 — Deterministic landing constraint selection (avoid “first row wins”)

**Priority**: P0  
**Why**: Multiple landing constraints can exist; `.find()` is non-deterministic and can pick the wrong landing type.  
**Files**
- `supabase/functions/trajectory-products-generate/index.ts`
- `supabase/functions/trajectory-constraints-ingest/index.ts` (reference ingestion behavior)

**Tasks**
- [x] Define selection rules (documented and encoded):
  - [x] Prefer rows with `landing_location.latitude/longitude`
  - [x] Prefer booster landing (when identifiable) over spacecraft recovery (when present)
  - [x] Prefer most recent `fetched_at` and higher `confidence` as tie-breakers
- [x] Implement explicit sorting and selection.

**DoD**
- Given the same constraint set, generator selects the same landing every run.
- Landing used is the intended type for downrange corridor.

**Validation**
- `npm run test:smoke`
- `npm run type-check`

---

### T3 — Eligibility parity: AR must open even with pad-only (tier 0)

**Priority**: P0  
**Why**: Spec promises “pad marker even if trajectory unavailable,” but eligibility currently requires `quality >= 1`.  
**Files**
- `lib/server/arEligibility.ts`
- `app/launches/[id]/ar/page.tsx`
- `app/api/public/launches/[id]/trajectory/route.ts`
- `docs/specs/launch-ar-trajectory.md`

**Tasks**
- [x] Decide the product/UX rule: “eligible launch” != “trajectory available”.
- [x] Allow AR entry for eligible launches even if only Tier-0 exists.
- [x] Ensure UI clearly says “Trajectory: pad only” (already present) and never implies more.

**DoD**
- The AR CTA is not blocked solely because a Tier-0 product is present.
- API returns pad-only product where appropriate and UI stays honest.

**Validation**
- `npm run test:smoke`
- `npm run type-check`

---

### T4 — Production job: LL2 landings → `launch_trajectory_constraints` (always-on)

**Priority**: P1  
**Why**: This is the highest-value input for Tier-1 accuracy; currently only a dev script exists.  
**Files**
- `supabase/functions/trajectory-constraints-ingest/index.ts` (new)
- `supabase/migrations/*_trajectory_constraints_ingest_job.sql` (new)
- `docs/schedules.md`

**Tasks**
- [x] Implement Edge job:
  - [x] find eligible launches (same rules as products)
  - [x] fetch LL2 landings for each
  - [x] upsert `constraint_type='landing'` with stable `source_id`
  - [x] record `ingestion_runs`
- [x] Add `system_settings` flags for enable/limits/lookahead/lookback.
- [x] Schedule via `pg_cron` using existing job gateway pattern.

**DoD**
- For the next eligible launches, `launch_trajectory_constraints` has landing rows when LL2 provides them.
- Product regeneration becomes stale-triggered when new landings arrive.

**Validation**
- `npm run type-check`
- Run job in dev/staging and confirm constraints appear for a known launch.

---

### T5 — Android-first WebXR UX (not buried in settings)

**Priority**: P1  
**Why**: On Android, WebXR can provide the best pose stability. If supported, it should be the default path.  
**Files**
- `components/ar/ArSession.tsx`
- `app/api/public/ar/telemetry/session/route.ts`
- `supabase/migrations/*_ar_camera_guide_sessions_*.sql` (new or extend)

**Tasks**
- [x] If `xrSupport === 'supported'`, show a primary CTA:
  - [x] “Start AR (WebXR)” + a short explanation
  - [x] Keep non-WebXR fallback reachable
- [x] Add telemetry fields:
  - [x] `pose_source` (`webxr|deviceorientation|deviceorientationabsolute|sky_compass`)
  - [x] `xr_supported` boolean
  - [x] `xr_used` boolean
  - [x] coarse `xr_error_bucket`

**DoD**
- Android Chrome (WebXR-supported) users can start WebXR without hunting in Settings.
- Telemetry can segment WebXR vs non-WebXR outcomes.

**Validation**
- `npm run type-check`
- Manual Android Chrome test (Pixel-class + Samsung-class device)

---

### T6 — Sensor best-practice: prefer absolute stream + unify calibration behavior

**Priority**: P1  
**Why**: Device sensors are variable; use best available stream and keep calibration consistent across modes.  
**Files**
- `components/ar/ArSession.tsx`

**Tasks**
- [x] Add `deviceorientationabsolute` listener path when supported; fallback to `deviceorientation`.
- [x] Ensure WebXR calibration uses the same sample-mean window approach as non-WebXR (avoid “single snapshot”).
- [x] Add a simple “pose source” indicator in debug UI when settings are open.

**DoD**
- Better stability on Android non-WebXR browsers and consistent calibration behavior.

**Validation**
- `npm run type-check`
- Manual tests: rotate screen, deny/grant motion, run calibration twice.

---

### T7 — Hazard→azimuth inference: corridor from geometry (not centroid)

**Priority**: P2  
**Why**: Centroid bearing is often wrong; hazards usually define a corridor boundary.  
**Files**
- `supabase/functions/trajectory-products-generate/index.ts`

**Tasks**
- [x] Sample polygon vertices (or boundary points) and compute bearing distribution from pad.
- [x] Derive a corridor (min/max or percentile bounds) and choose a representative azimuth.
- [x] Use hazard time windows to filter/deprioritize irrelevant hazards.

**DoD**
- Hazard-derived azimuth behaves sensibly across multi-zone hazards and is less brittle.

**Validation**
- `npm run test:smoke`
- Manual spot-check with a known NAVCEN hazard + matching launch.

---

### T8 — Use target-orbit numeric fields to parameterize Tier-2 vertical profile

**Priority**: P2  
**Why**: You already parse/store apogee/perigee/altitude; not using them leaves accuracy on the table.  
**Files**
- `supabase/functions/trajectory-products-generate/index.ts`
- `supabase/functions/trajectory-orbit-ingest/index.ts`

**Tasks**
- [x] Use `altitude_km/apogee/perigee` to set `altMaxM` (and possibly duration and/or sigma).
- [x] Record in `assumptions[]` which fields were used + their source/confidence.

**DoD**
- Tier-2 products vary based on real orbit parameters when available.

**Validation**
- `npm run test:smoke`

---

### T9 — Template library (learned priors) + generator integration

**Priority**: P2  
**Why**: Hard-coded azimuth defaults won’t scale; learned priors improve global coverage.  
**Files**
- `supabase/functions/trajectory-templates-generate/index.ts` (new)
- `supabase/migrations/0114_trajectory_templates_generate_job.sql`
- `supabase/functions/trajectory-products-generate/index.ts`

**Tasks**
- [x] Build template library keyed by `(site|rocket_family|mission_class)` with stats.
- [x] Nightly/weekly job recomputes templates from historical constraints.
- [x] Tier-2 fallback consults templates before heuristic defaults.

**DoD**
- Tier-2 “no constraints” cases become data-driven and improve over time.

**Validation**
- `npm run type-check`
- Query templates in DB and confirm they’re used in `assumptions[]`.

---

### T10 — Tier-3 vision lock-on (pixel-space tracking)

**Priority**: P4  
**Why**: This is the only robust path to “photo-useful” tracking on web, and can be best on Android.  
**Files**
- `components/ar/ArSession.tsx`
- `lib/ar/*` (new helper modules)

**Tasks**
- [x] Add a Worker-based detector/tracker (simple blob/motion + filtering).
- [x] Output +1/+2/+5s predicted pixel points; render ghost markers.
- [x] Add telemetry: lock acquired/lost counts (coarse) + time-to-lock bucket.

**DoD**
- Demonstrable improvement in keeping rocket in frame once visible.

**Validation**
- Manual launch replay / field test
- `npm run type-check`
- Frame-budget gate uses `docs/ar-lock-on-frame-budget-runbook-2026-02-09.md` thresholds and SQL snapshot query.
- Manual field sign-off uses `docs/ar-lock-on-android-field-validation-checklist-2026-02-09.md`.

---

### T11 — AR UI safe-area + outdoor ergonomics

**Priority**: P0  
**Why**: Fixed overlays currently ignore safe-area insets; controls can crowd the notch/home indicator and be hard to use outdoors.  
**Files**
- `components/ar/ArSession.tsx`
- `components/ar/ArBottomPanel.tsx`

**Tasks**
- [x] Add safe-area-aware padding to fixed top/bottom overlays (notch + home indicator).
- [x] Increase tap target sizes for primary actions (calibrate/settings/retry/WebXR).
- [x] Ensure text sizes remain readable in bright conditions (avoid overly small labels).

**DoD**
- On iPhone (notch + home indicator), HUD does not overlap system UI and primary controls are comfortable to tap.

**Validation**
- Manual iOS Safari test (portrait + landscape)
- `npm run type-check`

---

### T12 — Stop wasteful rendering (pause/throttle canvases)

**Priority**: P0  
**Why**: Canvas render loops run continuously even when hidden (Sky Compass mode) and when the tab is backgrounded; this harms smoothness and battery.  
**Files**
- `components/ar/ArSession.tsx`
- `components/ar/SkyCompass.tsx`

**Tasks**
- [x] Pause AR canvas rAF loop when:
  - [x] `showSkyCompass` is true (canvas hidden)
  - [x] `document.visibilityState !== 'visible'`
- [x] Throttle SkyCompass drawing:
  - [x] pause when `document.hidden`
  - [x] consider reduced FPS when idle (e.g., 15–30fps) without harming UX
- [x] Ensure resume is glitch-free (no stale refs, no runaway rAF).

**DoD**
- When AR canvas is hidden or tab is backgrounded, CPU usage drops significantly and animation resumes correctly.

**Validation**
- Manual: open AR → switch to SkyCompass → background tab → return
- `npm run type-check`

---

### T13 — Reduce React churn from sensors (keep render smooth)

**Priority**: P0  
**Why**: Frequent state updates from sensors can trigger needless re-renders and degrade smoothness.  
**Files**
- `components/ar/ArSession.tsx`

**Tasks**
- [x] Only update `poseSource` state when it actually changes (avoid per-event `setPoseSource`).
- [x] Gate the pose → React state interval:
  - [x] only push updates if deltas exceed thresholds (e.g., >0.5°) or at a lower cadence when stable
- [x] Add simple perf telemetry buckets (optional): “render loop running”, “canvas hidden”, “pose update rate bucket”.

**DoD**
- Stable sessions do not re-render excessively; animation stays smooth even on mid-tier devices.

**Validation**
- Manual profiling (React devtools / performance panel)
- `npm run type-check`

---

### T14 — Permission dead-ends + clearer “not ready” guidance

**Priority**: P0  
**Why**: Denied motion permissions (especially on iOS) can strand users; bottom hints can mislead while sensors are still initializing.  
**Files**
- `components/ar/ArSession.tsx`
- `components/ar/CameraGuideButton.tsx`

**Tasks**
- [x] Add an explicit “Enable Motion” CTA in-AR that triggers permission request (where possible).
- [x] When motion is denied, show platform-appropriate instructions (iOS Settings path).
- [x] Persist wizard dismissal (and optionally auto-dismiss after first successful calibration).
- [x] Replace generic hints with explicit sensor state when heading/pose is unavailable.

**DoD**
- Users always have a clear next step when motion/camera/location is blocked; no misleading “Turn left/right” while heading is unavailable.

**Validation**
- Manual tests on iOS Safari:
  - deny motion once, re-open AR
  - grant motion, calibrate, refresh
- `npm run type-check`

---

### T15 — Monitoring: add trajectory pipeline jobs to automated stale/failure alerts

**Priority**: P0  
**Why**: Trajectory jobs aren’t included in `monitoring-check`, so failures/staleness can be silent unless manually checked.  
**Files**
- `supabase/functions/monitoring-check/index.ts`

**Tasks**
- [x] Add job thresholds for:
  - [x] `trajectory_orbit_ingest`
  - [x] `trajectory_constraints_ingest`
  - [x] `trajectory_products_generate`
  - [x] `navcen_bnm_ingest` (if not already)
  - [x] `spacex_infographics_ingest` (if not already)
- [x] Ensure alerts resolve automatically when jobs recover.

**DoD**
- Monitoring produces stale/failed alerts for the full trajectory pipeline.

**Validation**
- Deploy to staging; confirm alerts behavior by simulating a missed schedule / failed run.

---

### T16 — Admin summary: show full trajectory pipeline health

**Priority**: P0  
**Why**: Admin summary omits `trajectory_constraints_ingest` and doesn’t make it obvious when constraints/products are out of date.  
**Files**
- `app/api/admin/summary/route.ts`

**Tasks**
- [x] Add `trajectory_constraints_ingest` row (schedule, enabled key, threshold, newData summary).
- [x] Add a “pipeline freshness” summary (optional):
  - [x] eligible IDs
  - [x] missing products count
  - [x] stale products count

**DoD**
- Admin summary shows orbit ingest + constraints ingest + product generation as a coherent pipeline.

**Validation**
- Manual admin summary check in staging
- `npm run type-check`

---

### T17 — Premium gating hardening: tighten DB RLS for trajectory products

**Priority**: P0  
**Why**: `launch_trajectory_products` currently has a public read policy; premium gating should be enforced at the DB layer.  
**Files**
- `supabase/migrations/0069_launch_trajectory_products.sql` (and/or a new follow-up migration)
- `supabase/migrations/*_trajectory_products_rls.sql` (new, preferred)
- `app/api/public/launches/[id]/trajectory/route.ts`
- `app/launches/[id]/ar/page.tsx`

**Tasks**
- [x] Replace “public read” policy with paid/admin-only policy (e.g., `public.is_paid_user() or public.is_admin()`).
- [x] Verify all runtime fetches are performed with an authenticated context or service role.
- [x] Add a regression note in docs: “DB enforces premium; API is defense-in-depth.”

**DoD**
- Anon Supabase clients cannot select `launch_trajectory_products`.
- Premium users can still load AR trajectory normally.

**Validation**
- In staging: attempt anon select (should fail); authed premium select (should succeed).

---

### T18 — Magnetic declination correction (magnetic → true north)

**Priority**: P1  
**Why**: Compass headings are referenced to magnetic north, but our bearings/azimuths are true-north; declination causes a systematic yaw bias.  
**Files**
- `components/ar/ArSession.tsx`
- `lib/ar/geo.ts` (or a new helper module)

**Tasks**
- [x] Implement a lightweight declination model (cached) keyed by coarse lat/lon.
- [x] Apply correction when using magnetometer-based headings (e.g., `webkitCompassHeading`).
- [x] Add telemetry buckets for declination magnitude and whether it was applied.

**DoD**
- Systematic yaw bias reduces in typical locations without requiring manual calibration every time.

**Validation**
- Manual test: compare pad alignment before/after in a known declination region
- `npm run type-check`

---

### T19 — Heading trust model + tilt-compensated heading fallback

**Priority**: P1  
**Why**: When `event.absolute` is false, `alpha` may be relative/drifty; without tilt-compensation, heading can be wrong at high pitch/roll.  
**Files**
- `components/ar/ArSession.tsx`

**Tasks**
- [x] If no `webkitCompassHeading` and `event.absolute !== true`, treat heading as “untrusted” until calibration and reflect that in UI hints.
- [x] Implement tilt-compensated heading from `alpha/beta/gamma` (screen-orientation aware) as the fallback for non-WebKit-compass cases.
- [x] Add telemetry buckets for “trusted vs untrusted heading”.

**DoD**
- Android non-WebXR and iOS non-compass cases drift less and fail more gracefully (honest UI).

**Validation**
- Manual: pitch device high/low and compare heading stability; verify UX in untrusted mode.
- `npm run type-check`

---

### T20 — Non-WebXR camera FOV inference (reduce scale error)

**Priority**: P1  
**Why**: Manual FOV presets/sliders help, but reading real track settings can reduce alignment error immediately.  
**Files**
- `components/ar/ArSession.tsx`

**Tasks**
- [x] Attempt to infer FOV from `MediaStreamTrack.getSettings()` (and/or `getCapabilities()`) where available.
- [x] Fall back to current lens presets + sliders.
- [x] Log coarse “FOV source” telemetry bucket (track-derived vs preset vs custom).

**DoD**
- Fewer sessions require manual FOV adjustment to look “about right”.

**Validation**
- Manual on Android Chrome + iOS Safari
- `npm run type-check`

---

### T21 — Constraint ranking improvements (recency + derived penalty + source tier)

**Priority**: P2  
**Why**: Current `target_orbit` selection is confidence-first; we should prefer fresh and non-derived constraints when available.  
**Files**
- `supabase/functions/trajectory-products-generate/index.ts`
- `supabase/functions/trajectory-orbit-ingest/index.ts`

**Tasks**
- [x] Update constraint selection to account for:
  - [x] `confidence`
  - [x] `fetched_at` recency
  - [x] `derived=true` penalty vs doc-sourced
  - [x] source tier (truth domains vs fallback)
- [x] Write assumptions clearly (why a constraint was selected).

**DoD**
- Tier-2 products consistently pick the best available orbit constraint and are refresh-triggered when newer constraints arrive.

**Validation**
- `npm run test:smoke`
- Spot-check: mixed constraints (doc + derived) selects doc.

---

### T22 — Hazard coverage expansion + time-window gating

**Priority**: P2  
**Why**: Current NAVCEN hazard matching is Cape-focused and hazard-derived orbit ignores time windows; expanding coverage improves Tier-2 accuracy and honesty.  
**Files**
- `supabase/functions/navcen-bnm-ingest/index.ts`
- `supabase/functions/trajectory-products-generate/index.ts`
- `supabase/functions/trajectory-orbit-ingest/index.ts`

**Tasks**
- [x] Use hazard validity windows to downrank or skip hazards that clearly don’t overlap NET.
- [x] Expand hazard matching beyond Cape if possible (or clearly document region limits).
- [x] Add telemetry/ops stats: hazards considered per launch, hazards matched, hazards used.

**DoD**
- Hazards influence products only when plausibly relevant; more launches can benefit from hazard-derived azimuth where available.

**Validation**
- Manual: known hazard + launch case
- `npm run test:smoke`

---

### T23 — Mission infographic feasibility spike (accuracy use or drop)

**Priority**: P2  
**Why**: Infographics are currently stored but unused for products; only use them if we can reliably extract structured signal.  
**Files**
- `supabase/functions/spacex-infographics-ingest/index.ts`
- `supabase/functions/trajectory-orbit-ingest/index.ts` (optional extension)
- `docs/specs/launch-ar-trajectory.md`

**Tasks**
- [x] Collect a representative sample set of SpaceX infographic images (mobile + desktop).
- [x] Attempt OCR + parsing for orbit/azimuth/inclination/altitude (measure precision/recall).
- [x] Decide go/no-go:
  - [ ] if signal is strong: define a new constraint type or enrich `target_orbit`
  - [x] if weak: keep as display-only and document explicitly

**DoD**
- Clear decision with evidence; no “mystery” unused data in the pipeline.

**Validation**
- Document results + sample outputs (redacted as needed)

---

### T24 — Trajectory model upgrade data sources roadmap (deep dive deliverable)

**Priority**: P2  
**Why**: Perfect mission-by-mission ascent requires new data sources; we need a clear roadmap of what’s feasible/legal and what improves Tier-2/Tier-3.  
**Files**
- `docs/specs/launch-ar-trajectory.md`
- `docs/ar-trajectory-execution-tickets.md`

**Tasks**
- [x] Inventory current usable inputs (landing, hazards, target_orbit docs, mission/rocket metadata).
- [x] Evaluate new sources:
  - [x] FlightClub: feasibility + ToS/legal + API/format (LL2 provides `flightclub_url` link only)
  - [x] provider press kits / regulatory filings beyond current domain allowlist
  - [x] NOTAM/NOTMAR sources (beyond NAVCEN) by region
- [x] Propose tiered approach: what unlocks Tier-2 improvements vs what enables true mission-specific ascent.

**DoD**
- A written “data roadmap” with go/no-go decisions and proposed ingestion/storage approach.
- Deliverable: `docs/ar-trajectory-model-upgrade-data-deep-dive.md`

---

### T25 — Advanced sensor fusion (toggle; OFF by default)

**Priority**: P3  
**Why**: Web sensors vary widely; fusing gyro + gravity + magnetometer can reduce drift/latency, but must be optional and guarded.  
**Files**
- `components/ar/ArSession.tsx`
- `lib/ar/*` (new fusion helper module(s))
- `app/api/public/ar/telemetry/session/route.ts`

**Tasks**
- [x] Add “Advanced sensor fusion” toggle in settings (persisted; default OFF).
- [x] Implement fusion filter (complementary/Madgwick-style) using:
  - [x] `devicemotion.rotationRate` (gyro)
  - [x] gravity vector (from accelerometer including gravity)
  - [x] magnetometer/heading when available
- [x] Add guardrails:
  - [x] auto-disable or downweight magnetometer when interference suspected
  - [x] fail-safe fallback to current OneEuro pipeline
- [x] Telemetry buckets:
  - [x] fusion enabled/disabled
  - [x] fallback reasons

**DoD**
- With fusion ON, heading feels more responsive and less drifty on supported devices; with fusion OFF (default), behavior remains unchanged.

**Validation**
- Manual A/B on Android Chrome (non-WebXR) and iOS Safari
- `npm run type-check`
