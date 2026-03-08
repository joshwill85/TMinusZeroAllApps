# AR Trajectory — Full Audit Report (UI, Accuracy, Data Pipeline)

Date: 2026-01-24  
Scope: Web AR “Camera Guide” + trajectory products/constraints pipeline + premium enforcement + device/browser support.  
Primary references:
- `docs/specs/launch-ar-trajectory.md`
- `docs/ar-trajectory-execution-tickets.md`
- `docs/ar-trajectory-qa-matrix.md`

## Executive summary (what matters most)

### P0 (must fix first)

1) **Premium data leak via DB RLS**
- `public.launch_trajectory_products` has RLS enabled but an explicit **public read** policy (`using (true)`). Any anon Supabase client can read premium trajectory products directly, bypassing app/API gates.
- Fix: remove public policy and replace with `public.is_paid_user() OR public.is_admin()` read policy (same pattern as other premium tables).

2) **Unnecessary work causing jank + battery drain**
- AR canvas `requestAnimationFrame` loop runs even when the AR canvas is hidden (SkyCompass shown), and SkyCompass also runs its own full-screen render loop → double render loops.
- Sensor events and periodic pose state updates drive frequent React re-renders, including expensive work (e.g., date formatting), degrading smoothness on mobile.

3) **Heading correctness is the limiting factor on iOS + non-WebXR**
- We compare **true-north** bearings/azimuths (from lat/lon math) against **magnetic** compass headings. Without correcting for magnetic declination, yaw can be biased by ~5–20° depending on location.
- We also need a “heading trust” model and a tilt-compensated fallback for non-WebKit compass cases.

### P1–P2 (next)
- **FOV inference** from camera track settings (when available) reduces the most common “scale feels off” complaint.
- **Use more data for Tier 2**: better ranking of `target_orbit` constraints, time-window gating for hazards, and a go/no-go on extracting signal from SpaceX mission infographics.
- **Ops visibility**: trajectory jobs must be monitored (alerts) and visible in admin summary; today they’re easy to miss when stale/failing.

### P3+ (planned)
- **P3**: Advanced sensor fusion toggle (OFF by default) with guardrails + telemetry.
- **P4**: Tier-3 vision lock-on tracking (pixel-space); the only robust path to “photo-useful” guidance on web.

## System overview (current architecture)

### Client (AR view)
- UI entry: `components/ar/CameraGuideButton.tsx` prefetches trajectory and requests iOS motion permission.
- Main AR: `components/ar/ArSession.tsx`
  - Camera background: `getUserMedia` (non-WebXR).
  - Pose sources:
    - WebXR `immersive-ar` on supported Android devices.
    - DeviceOrientation/DeviceMotion fallback for iOS/other Android.
    - SkyCompass fallback view (no camera/motion).
  - Projects server-provided ECEF samples into user-local ENU → az/el → camera FOV.
- Fallback compass view: `components/ar/SkyCompass.tsx`

### Server (trajectory data)
- Storage:
  - Products: `public.launch_trajectory_products` (`supabase/migrations/0069_launch_trajectory_products.sql`)
  - Constraints: `public.launch_trajectory_constraints` (`supabase/migrations/0070_launch_trajectory_constraints.sql`)
  - Source docs: `public.trajectory_source_documents` (used by orbit ingest)
- Scheduled jobs (Supabase cron → Edge Functions):
  - Landing constraints: `supabase/functions/trajectory-constraints-ingest/index.ts`
  - Orbit/press-kit ingest: `supabase/functions/trajectory-orbit-ingest/index.ts`
  - Hazard ingest: `supabase/functions/navcen-bnm-ingest/index.ts`
  - SpaceX infographic ingest: `supabase/functions/spacex-infographics-ingest/index.ts`
  - Product generation: `supabase/functions/trajectory-products-generate/index.ts`
- Eligibility: only the “top N eligible” launches receive constraints/products (currently N=3 by design).

## Detailed findings

### 1) UI/UX (clean + outdoor usable)

**What’s good**
- The experience has an explicit fallback (SkyCompass) and calibration controls.
- It includes a time scrubber and uncertainty visualization (sigma corridor), which is the right “don’t lie” approach.

**P0 issues**
- **Safe area**: Fixed overlays use `top-4`/`bottom-4` and can overlap iPhone notch/home indicator.
- **Permission dead-ends**: iOS motion permission is tricky; we need clearer, explicit recovery CTAs inside AR (“Enable Motion”, “Open Settings” guidance).
- **Tap target ergonomics**: outdoors, gloves, or bright sun → primary controls need larger targets and higher-contrast labels.

**Recommended P0 changes**
- Add safe-area aware padding for top/bottom HUD.
- Add explicit “Enable Motion” CTA and stateful messaging for “sensors initializing” vs “denied”.
- Gate expensive visual effects (e.g., blur) behind `reducedEffects` and/or platform heuristics.

### 2) Smoothness/performance (super smooth to use)

**P0 issues**
- **Double render loops**:
  - `ArSession` canvas rAF loop runs even while hidden (SkyCompass).
  - `SkyCompass` runs an always-on rAF loop even though it could draw on change or at low FPS.
- **React churn from sensors**:
  - `setPoseSource(...)` is triggered per orientation event.
  - Pose state sync runs every ~90ms, re-rendering the full AR view.
- **Per-frame overhead**:
  - `getContext('2d')` is called each frame.
  - Canvas sizing reads `window.innerWidth/innerHeight` every frame and ignores devicePixelRatio (also causes iOS Safari “wobble” when browser chrome changes).

**Recommended P0 changes**
- Pause/cancel AR rAF when the canvas is hidden or tab is backgrounded.
- Throttle SkyCompass to 10–15fps (or draw-on-change) and pause on `document.hidden`.
- Cache 2D contexts and resize only on resize/visualViewport changes (DPR-scaled).
- Reduce sensor-driven state updates and memoize expensive UI formatting.

### 3) Accuracy (as accurate as web allows)

#### 3.1 Magnetic declination (what it is and why it matters)
- **Magnetic declination** is the angle between **magnetic north** (what a compass points to) and **true north** (geographic north used by bearings/azimuth math).
- It varies by location and slowly changes over time.
- Without declination correction, compass-based yaw can be systematically biased, causing the pad/trajectory overlay to be “consistently off” by a noticeable amount.

#### 3.2 Heading trust model + tilt compensation
- Not all `DeviceOrientationEvent` headings are equal:
  - iOS `webkitCompassHeading` is typically magnetometer-derived and “absolute”, but can be noisy in interference.
  - `event.alpha` without `event.absolute===true` can be relative/drifty.
- We should explicitly model:
  - heading source (`webkit` vs `absolute` vs `relative`)
  - heading trust (`trusted` vs `untrusted`) and reflect it in UI/telemetry
- We should add a tilt-compensated heading fallback for non-WebKit cases so yaw doesn’t degrade badly when the phone is pitched.

#### 3.3 Camera FOV
- AR alignment is highly sensitive to camera FOV; manual presets are good, but we should infer FOV from `MediaStreamTrack.getSettings()` / `getCapabilities()` where available.

### 4) Data pipeline completeness (“use all the data we can”)

**What we already ingest**
- Landing constraints (LL2 landings) → `constraint_type='landing'`.
- Orbit numeric constraints (press kit / mission docs) → `constraint_type='target_orbit'` (inclination and/or flight azimuth when parsable).
- Hazard polygons (NAVCEN BNM) → `constraint_type='hazard_area'` (currently region-limited).
- SpaceX infographic URLs → `constraint_type='mission_infographic'` (display-oriented today).

**Gaps / limitations**
- Hazard ingestion is not globally comprehensive (currently a NAVCEN feed with Cape-focused matching).
- Orbit doc discovery and allowlist is conservative; many providers won’t yield docs.
- Orbit parsing is text-only; important numeric tables/images may not parse.
- Observability gaps:
  - `monitoring-check` doesn’t alert on trajectory jobs.
  - Admin summary omits `trajectory_constraints_ingest`.
- External fetches lack explicit timeouts/size caps, risking “stuck” jobs.

## Roadmap (P0–P4)

Use `docs/ar-trajectory-execution-tickets.md` as the source backlog. Highlights:

- **P0**: UI safe-area/ergonomics, pause/throttle rendering, reduce React churn, permission UX, monitoring coverage, admin summary completeness, and premium RLS hardening.
- **P1**: magnetic declination, heading trust + tilt-comp fallback, camera FOV inference.
- **P2**: improved constraint ranking, hazard time-window gating + coverage expansion, infographic OCR feasibility, and a trajectory model upgrade data roadmap.
- **P3**: advanced sensor fusion toggle (OFF by default).
- **P4**: Tier-3 vision lock-on (pixel tracking).

## Immediate next actions (recommendation)

1) Implement **P0 premium RLS fix** for `launch_trajectory_products` (and review caching headers on the premium API route).
2) Implement **P0 rendering loop pausing** and **sensor→React churn reduction** (largest UX win per engineering hour).
3) Implement **P1 magnetic declination correction** + heading trust buckets (measurable accuracy win).
4) Add monitoring + admin summary coverage for the trajectory pipeline.

