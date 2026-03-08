# Web AR Launch Trajectory Overlay (Next 3 Flights)

Status: Draft (PRD + Technical Design)  
Owner: TBD  
Last updated: 2026-01-25

## 0) Executive summary

Build a web-only AR experience that lets a user:

1) open a supported launch on T‑Minus Now,  
2) grant camera + location + motion permissions,  
3) receive on-screen arrows to point their phone toward the launch pad, and  
4) see an on-camera overlay of the pad marker and the rocket’s predicted ascent trajectory (with uncertainty), plus a live “lock-on” mode during flight for photo-useful short-horizon prediction.

This feature is dynamically enabled for **only the next 3 launches**. A launch stays eligible until **3 hours after “flight complete”** (definition below). After that, the next upcoming launch becomes eligible so we always show this for up to 3 launches.

## Implementation status (live)

- [x] Phase 0: add pad lat/lon to public cache
- [x] Phase 0: server eligibility helper + public API (`/api/public/launches/ar-eligible`)
- [x] Phase 0: AR page skeleton with camera preview + basic pad-direction arrow
- [x] Phase 0: launch detail CTA gated by eligibility
- [x] Phase 1: trajectory product table + generator (pad-only Tier 0)
- [x] Phase 1: trajectory product API route (`/api/public/launches/[id]/trajectory`)
- [x] Phase 1: trajectory rendering in AR view (Tier 0 pad-only overlay)
- [x] Phase 1: calibration + FOV controls in AR view
- [x] Phase 1: visibility aids (crosshair + horizon line + high-contrast default)
- [x] Phase 2: constraint ingestion (LL2 landings as constraints, stored)
- [x] Phase 2: use constraints in trajectory generation (Tier 1 via landing corridor)
- [x] Phase 2: downrange fallback (azimuth templates when landing lat/lon missing)
- [x] Phase 2: hazard area / press kit parsing (file-based ingestion scripts)
- [x] Phase 3: vision lock-on tracking + ghost silhouettes (beta; Android manual field validation remains required)

### v1.1: “Camera Guide (Pre‑Launch)” UX completeness

- [x] Time model: `T-…` countdown + `T+…` clock
- [x] Bottom panel: scrubber + Live toggle (0 → duration)
- [x] Aim dot: current/scrubbed point in path
- [x] Uncertainty corridor: render `sigmaDeg` as a band (not just a line)
- [x] Fallback Sky Compass: if camera/motion denied, still show path + aim dot + scrubber
- [x] Lens/zoom presets: 0.5× / 1× / 2× / 3× set sane FOV defaults (keep manual sliders)
- [x] Past vs future styling: highlight current point and future path

### v1.2: hardening + reliability

- [x] Permission/sensor state audit (iOS Safari) + no dead-ends
- [x] “Retry sensors” button (no reload)
- [x] Sensor smoothing + snap-back protection (yaw/pitch clamp + low-pass)
- [x] Calibration persistence keyed per-device (incl. pitch level)
- [x] Prefetch: warm Camera Guide / trajectory on eligible launch
- [x] Offscreen aim indicator (edge arrow when aim dot is outside view)

### v1.3: data-driven iteration + coverage

- [x] Telemetry session logging (privacy-safe)
  - DB: `supabase/migrations/0071_ar_camera_guide_sessions.sql` adds `public.ar_camera_guide_sessions` (RLS: admin-read only; inserts via service-role).
  - API: `app/api/public/ar/telemetry/session/route.ts` upserts `start|update|end`, enforces a ~6KB body limit, and rate-limits globally via `try_increment_api_rate` (`provider=ar_telemetry_minute`).
  - Client: `lib/ar/telemetryClient.ts` + `components/ar/ArSession.tsx` start on mount and end via `pagehide`/unmount (`sendBeacon` when available).
  - Privacy: do **not** log location, bearings, raw sensor streams, IP, or full user-agent. Client sends only coarse buckets + session outcomes.
- [x] Corridor multiplier UI: `tight|normal|wide`
  - UI: `components/ar/ArBottomPanel.tsx`
  - Render: `components/ar/ArSession.tsx`, `components/ar/SkyCompass.tsx`
- Persist: saved alongside calibration in localStorage (`arCalibration:v5:*`, migrates legacy versions forward without carrying legacy pitch offsets) via `components/ar/ArSession.tsx`
- [x] Quality label semantics + defaults
  - UI: `components/ar/ArSession.tsx` shows a short explainer for `pad_only` / `landing_constrained` / `estimate_corridor`
  - Defaults: `pad_only → WIDE`, `estimate_corridor → NORMAL`, `landing_constrained → TIGHT` (only when there is no saved corridor preference)
- [x] Estimated event chips (Max‑Q/MECO/…)
  - Generation: `supabase/functions/trajectory-products-generate/index.ts` builds `product.events` from LL2 `timeline` when available, otherwise falls back to per-family estimates (marked as estimates in UI).
  - UI: `components/ar/ArBottomPanel.tsx` renders a horizontal chip row; tapping a chip scrubs to that time.
- [x] Tier‑2 pre-launch products when landing constraints are missing
  - Generator: `supabase/functions/trajectory-products-generate/index.ts` adds Tier‑2 `estimate_corridor` when there is no landing constraint.
  - Coverage: Cape/KSC + Vandenberg + Starbase (site inferred from pad lat/lon + name; Vandenberg uses pad-name hints like SLC-2/4/6).
  - Honesty: wide `sigmaDeg` + explicit “Estimate corridor” label in UI (`components/ar/ArSession.tsx`).
  - Data model unchanged: still per-launch products with ECEF samples; az/el stays computed on-device.
- [x] Generator regression guardrails (Tier‑2 sanity)
  - CI: `.github/workflows/ci.yml` runs `npm run test:smoke`

#### v1.3 telemetry contract (implementation notes)

- Endpoint: `POST /api/public/ar/telemetry/session`
- Body: `{ type: "start" | "update" | "end", payload: { sessionId, launchId, startedAt, … } }`
- Payload fields we currently accept (all optional beyond ids/timestamps; see `lib/ar/telemetryClient.ts`):
  - coarse client buckets: `clientEnv`, `clientProfile`, `screenBucket` (no full user-agent stored)
  - capabilities + heading pipeline: `cameraStatus`, `motionStatus`, `headingStatus`, `headingSource`, `declinationApplied`, `declinationSource`, `fusionEnabled`, `fusionUsed`, `fusionFallbackReason`
  - pose/XR + runtime: `poseSource`, `xrSupported`, `xrUsed`, `xrErrorBucket`, `renderLoopRunning`, `canvasHidden`, `poseUpdateRateBucket`, `arLoopActiveMs`, `skyCompassLoopActiveMs`, `loopRestartCount`
  - render outcome: `modeEntered`, `fallbackReason`, `retryCount`, `renderTier`, `droppedFrameBucket`
  - user behavior: `usedScrub`, `scrubSecondsTotal`, `eventTapCount`, `lensPreset`, `corridorMode`, `fovSource`
  - lock-on: `lockOnAttempted`, `lockOnAcquired`, `timeToLockBucket`, `lockLossCount`
  - calibration (bucketed): `yawOffsetBucket`, `pitchLevelBucket`, `hfovBucket`, `vfovBucket`
  - trajectory metadata: `tier`, `trajectoryVersion`, `durationS`, `stepS`, `avgSigmaDeg`, `confidenceTierSeen`, `contractTier`
- Server-side guards (see `app/api/public/ar/telemetry/session/route.ts`):
  - rejects payloads over ~6KB
  - rejects sessions older than ~24h and durations over ~6h
  - accepts only launches that are AR-eligible at request time
  - inserts via service role and keeps table admin-readable only (RLS)

#### Telemetry retention

- `supabase/migrations/0072_ar_camera_guide_sessions_hardening.sql` adds a daily pg_cron cleanup job:
  - job: `cleanup_ar_camera_guide_sessions`
  - retention: 90 days (`created_at`)

#### Example telemetry queries (admin)

```sql
-- AR vs SkyCompass share (completed sessions)
select mode_entered, count(*) as sessions
from public.ar_camera_guide_sessions
where ended_at is not null
  and created_at > now() - interval '14 days'
group by mode_entered
order by sessions desc;

-- Top fallback reasons (SkyCompass sessions only)
select fallback_reason, count(*) as sessions
from public.ar_camera_guide_sessions
where ended_at is not null
  and mode_entered = 'sky_compass'
  and created_at > now() - interval '14 days'
group by fallback_reason
order by sessions desc;

-- Retry effectiveness
select
  case when retry_count > 0 then 'retried' else 'no_retry' end as retry_bucket,
  mode_entered,
  count(*) as sessions
from public.ar_camera_guide_sessions
where ended_at is not null
  and created_at > now() - interval '14 days'
group by retry_bucket, mode_entered
order by retry_bucket, mode_entered;

-- Corridor choices by trajectory tier (quality)
select trajectory_quality, corridor_mode, count(*) as sessions
from public.ar_camera_guide_sessions
where ended_at is not null
  and created_at > now() - interval '14 days'
group by trajectory_quality, corridor_mode
order by trajectory_quality, corridor_mode;

-- WebXR adoption / pose sources
select pose_source, xr_supported, xr_used, xr_error_bucket, count(*) as sessions
from public.ar_camera_guide_sessions
where ended_at is not null
  and created_at > now() - interval '14 days'
group by pose_source, xr_supported, xr_used, xr_error_bucket
order by sessions desc;
```

## 1) Goals / non-goals

### Goals

- Web-only (no native app), works on modern iOS and Android browsers as well as possible.
- “Photo-useful” guidance:
  - Pre-launch: reliably guide a user to the pad direction and approximate ascent corridor.
  - In-flight: provide **high-accuracy** near-term prediction in the camera view (seconds ahead) to help keep the rocket in-frame.
- “Industry standard” UX:
  - Explicit confidence/uncertainty display; never imply perfect accuracy when inputs don’t support it.
  - Fast startup (≤ 2–3 seconds after permissions), stable rendering (60fps where possible), battery-aware.
- Data efficient: only compute/store heavy trajectory products for the **next 3 eligible launches**.

### Success metrics (v1 targets)

- AR open → first camera frame rendered: p50 < 2s, p95 < 5s (after permissions granted).
- “Find pad” success rate (self-reported): ≥ 80% on supported devices and outdoor conditions.
- In-flight lock-on (if enabled): time-to-lock p50 < 5s after rocket is visible; re-acquire p50 < 2s.
- User rating for usefulness: ≥ 4.0/5 (micro-survey).
- Crash-free AR sessions: ≥ 99% (by browser family).

### Non-goals (at least for v1)

- Replicating FlightClub’s mission-by-mission accuracy across every provider globally without external constraints/telemetry.
- Perfect absolute sky registration on all devices (web sensor accuracy varies widely).
- A full “3D AR anchor in world space” experience on iOS (WebXR/geo-anchoring support is limited in Safari/WebKit).

## 2) What users want (and how we’ll validate)

### Primary user jobs-to-be-done

1) “I’m at a viewing location. Tell me exactly where to aim my phone.”  
2) “I’m filming/photographing. Help me keep the rocket in frame as it rises and arcs downrange.”  
3) “I want to set up a tripod camera. Give me a time-indexed pointing plan (azimuth/elevation vs T+).”

### Likely must-have features (MVP → v1)

- One-tap “AR trajectory” entry from the launch detail page.
- Clear permission UX for:
  - camera
  - precise location
  - motion/orientation (iOS)
- Always-visible **arrow guidance**:
  - “Turn left/right” (yaw delta)
  - “Tilt up/down” (pitch delta)
  - show numeric deltas in degrees
- A **pad marker** overlay (even if trajectory product is unavailable).
- A **time scrub / T+ clock**:
  - “T‑00:30”, “T+00:45”, etc
  - highlight timeline milestones (Max‑Q, MECO, SECO, etc) when available.
- A confidence indicator:
  - sensor quality (GPS accuracy, heading stability)
  - model quality (template-only vs constraint-backed vs observed lock-on)
- A “low light” mode for night launches (dim UI, high contrast).

### “Awesome” differentiators (v1+)

- **Vision lock-on**: track the rocket in the camera feed (blob/motion detection + Kalman filter) and render short-horizon “ghost” silhouettes at +1s/+2s/+5s in pixel space.
- “Export pointing plan” (CSV): `tPlusSec, azDeg, elDeg` for tripod planning.
- Optional on-screen “horizon line” overlay.
- Save a “calibration offset” per device session (when the user confirms they are aimed at the pad).

### Acceptance criteria (MVP)

- If the launch is eligible (next 3 rules), the launch detail page shows an “AR trajectory” entry point.
- On entry:
  - permissions are requested progressively (camera → location → motion, with clear rationale copy)
  - if any permission is denied, the UI provides a clear fallback or “how to enable” instructions
- With pad coordinates available:
  - the UI renders pad arrow guidance and a pad marker
  - the user can tap “Calibrate” to apply a yaw offset for the current session
- The feature is not accessible for non-eligible launches (UI + API enforcement).

### How we’ll actually “find out” (fast user discovery plan)

- Add an in-AR micro-survey (2 questions, optional, 5 seconds):
  1) “What are you using this for?” (recording / photos / finding pad / curiosity)
  2) “Did the overlay help?” (1–5) + free-text
- Instrument events:
  - `ar_opened`, `ar_permissions_granted`, `ar_calibration_completed`, `ar_tracking_started`, `ar_tracking_lost`, `ar_closed`
  - record device + browser + reported sensor accuracy (coarse, no PII)
- Do 5–10 targeted user sessions with local launch spectators and astrophotographers (screen recording + feedback).

## 3) LL2 data audit (what we can use)

We reviewed the local LL2 v2.3 OpenAPI (`docs/ll2/openapi.json`) and current ingestion. Key point: **LL2 does not provide a mission trajectory waypoint list or orbital parameters like inclination/RAAN per launch**. It does provide pad coordinates, rocket configuration metadata, launch timelines, and (critically) landing metadata that can constrain downrange direction.

### High-value LL2 endpoints for this feature

- `GET /2.3.0/launches/?mode=detailed`
  - Use: pad, mission, rocket config, `timeline`, `flightclub_url` (link only).
  - Important fields:
    - `net`, `net_precision`, `window_start`, `window_end`
    - `pad.latitude`, `pad.longitude`, `pad.map_url`, `pad.location.timezone_name`
    - `rocket.configuration.{length,diameter,to_thrust,leo_capacity,gto_capacity,sso_capacity,...}`
    - `mission.orbit.{name,abbrev,celestial_body}` (category only)
    - `timeline[].relative_time` + `timeline[].type.abbrev` (milestones)
- `GET /2.3.0/landings/`
  - Use: **downrange constraint** and (sometimes) landing coordinates.
  - Important fields:
    - `downrange_distance`
    - `landing_location.{latitude,longitude}`
    - `type`, `success`, `attempt`
- `GET /2.3.0/pads/{id}/`
  - Use: authoritative pad lat/lon, map URLs, and fallback for pad metadata.
- `GET /2.3.0/launcher_configurations/{id}/`
  - Use: rocket metadata for visuals/scale and performance bounds (still not a per-flight guidance profile).

### Current repo ingestion status (what we already store)

- Launch core detail is ingested via `lib/ingestion/ll2.ts` and stored in `public.launches` and `public.launches_public_cache`.
- We already ingest and expose: `timeline`, `pad_map_url`, `mission_orbit` (string), many rocket config fields (length/diameter/capacities), `flightclub_url` (as a link).
- We currently do **not** store pad lat/lon in `launches_public_cache` (only in `launches`), and we do not ingest LL2 `landings` into first-class tables.

## 4) Accuracy strategy (web-only)

### Key constraint: phone sensors

Absolute AR alignment is limited by:

- **Heading/yaw** errors (magnetometer interference): can be 5–20° in worst cases.
- **GPS position** error: typically 3–20m outdoors, worse indoors.
- **Pitch/roll** is usually better than yaw.
- iOS WebKit limitations for absolute orientation and background sensor fusion.

Therefore, the strategy is:

1) Use sensors for coarse alignment and pad direction.  
2) Provide uncertainty visualization.  
3) For “zoomed in” use cases, rely on **vision lock-on** once the rocket is visible to achieve photo-useful short-horizon prediction.

### Error budget + uncertainty UI (don’t lie)

We should treat the overlay as a probabilistic estimate:

- **Sensor uncertainty** (device-specific, time-varying):
  - heading variance (short window)
  - reported GPS horizontal accuracy
- **Model uncertainty** (launch-specific):
  - tier 0/1/2 quality level
  - mission class ambiguity (LL2 orbit is categorical)

UI requirements:

- Always show a confidence indicator and/or a cone/band for the predicted path.
- Use explicit language:
  - “Predicted (wide)” for Tier 1
  - “Predicted (constraint-backed)” for Tier 2
  - “Tracking (live)” for Tier 3 lock-on

### Trajectory model tiers (server-generated, cached)

We generate a trajectory “product” per eligible launch, with explicit quality levels that the client uses for labeling and defaults:

- **Tier 0 — `pad_only`** (`quality=0`)
  - Always available if we have pad coords.
  - No ascent curve; just a pad marker at `T+0`.
- **Tier 1 — `landing_constrained`** (`quality=1`)
  - Uses **landing metadata as an azimuth (downrange) constraint**.
  - Does **not** imply the rocket “lands” within the product horizon; the altitude curve stays monotonic.
  - Product horizon (current implementation): `durationS=600`, `stepS=2` (301 samples).
- **Tier 2 — `estimate_corridor`** (`quality=2`)
  - Best-effort corridor using whatever we already ingest (e.g., target orbit + hazard geometry + templates + vehicle heuristics).
  - Always marked as an estimate (wide uncertainty).
  - Product horizon (current implementation): `durationS=600`, `stepS=2` (301 samples).
- **Tier 3 — observed lock-on (client)**
  - Not a server product. Once the rocket is detected in the camera feed, run a pixel-space tracker and predict +1/+2/+5 seconds.
  - This is the best path to “zoomed in” usefulness on web.

### Trajectory product format (what the client consumes)

The API returns a compact JSON payload per launch:

- `version`: `"traj_v1"`
- `quality`: `0|1|2` (server-generated tiers only)
- `generatedAt`: ISO timestamp of the DB row generation time
- `product`:
  - `qualityLabel`: `'pad_only' | 'landing_constrained' | 'estimate_corridor'`
  - `assumptions`: short list of strings (human-readable model notes)
  - `samples`: array of `{ tPlusSec, ecef: [x,y,z], sigmaDeg }`
    - **Units**: `ecef` values are meters in WGS84 ECEF coordinates
    - **Invariants**:
      - `tPlusSec` is non-negative and monotonic ascending
      - Tier‑1/Tier‑2: `tPlusSec` spans `0..600` inclusive with nominal `stepS=2`
      - Tier‑0: `samples` is either empty (if pad coords missing) or contains only `{ tPlusSec: 0, ... }`
    - `sigmaDeg`: 1σ angular half-width in degrees (client scales this by corridor mode and uses it for band rendering)
  - `events`: array of `{ key, tPlusSec, label, confidence }`
    - Always includes `{ key: 'LIFTOFF', tPlusSec: 0, label: 'Liftoff', confidence: 'high' }`
    - Adds LL2 `timeline` events (when present) inside the product horizon (`confidence: 'med'`)
    - Falls back to per-rocket-family estimates when timeline is missing (`confidence: 'low'`)

Client converts ECEF → ENU (relative to user lat/lon/alt) → az/el → camera projection, and renders the `sigmaDeg` corridor as a band.

#### Client assumptions (ArSession)

- Treat missing/empty `samples` as **pad-only** and do not render a trajectory line.
- Sort by `tPlusSec` defensively; do not assume server order.
- If `sigmaDeg` is missing on some samples, use a safe default width for the corridor.
- If `events` is missing/empty, hide milestone chips and rely on the scrubber.

## 5) Web AR technical approach

### Compatibility (practical)

- iOS (Safari/Chrome/Firefox are all WebKit):
  - camera: supported
  - location: supported
  - device orientation: requires user-gesture permission and may be low-quality for yaw
  - WebXR immersive-ar: generally unavailable
- Android (Chrome):
  - camera: supported
  - location: supported
  - device orientation: supported; Generic Sensor API often available
  - WebXR immersive-ar: may be available on supported devices (best pose quality)

### Rendering approach

Web-only AR = camera stream + overlays.

- Camera: `getUserMedia({ video: { facingMode: 'environment' } })`
- Render pipeline:
  - `<video>` as background (muted, playsInline)
  - `<canvas>` overlay for trajectory/polyline + markers
  - DOM HUD for arrows + telemetry + controls

### Pose/orientation approach

Prefer best-available in this order:

1) **WebXR immersive-ar** (Android Chrome where available) for stable pose; fall back otherwise.
2) Generic Sensor API (`AbsoluteOrientationSensor`) if available.
3) `DeviceOrientationEvent` (iOS requires explicit permission).

Always implement:

- Sensor quality scoring (e.g., heading variance over 1s; gps accuracy).
- A manual calibration flow that can apply a yaw offset:
  - user “aims at pad marker” → taps “Calibrate” → we persist a session yaw correction.
- A screen-orientation-aware pitch/roll mapping (portrait vs landscape) to avoid ~90° pitch errors on mobile.

### Camera projection / FOV calibration (required for “accurate overlay”)

Web browsers do not reliably provide full camera intrinsics. Implement:

- Best-effort FOV estimation:
  - derive from media track settings where available
  - fallback to device heuristics (common defaults)
- User calibration:
  - optional quick step to align a reference marker
  - persist per session (and optionally per device in `localStorage`)

### Visibility aids (implemented)

- Crosshair + horizon line overlay to help stabilize aim.
- High-contrast trajectory mode enabled by default (no toggle).
- Sensor quality readouts (heading stability + GPS accuracy).
- Calibration wizard (step-by-step prompts with “Set horizon” and “Calibrate”), auto-requests motion permission when possible.

### Arrow guidance logic

- Compute target direction for the selected “focus” (pad, liftoff point, or predicted rocket at T+X):
  - target azimuth/elevation from user position.
- Compare to current device look vector (from orientation + assumed camera intrinsics).
- Show:
  - left/right arrow for yaw delta (normalized to −180..+180)
  - up/down arrow for pitch delta (clamped), plus text guidance
  - text: `Δyaw=...°`, `Δpitch=...°`

### Vision lock-on (to achieve photo-useful accuracy)

This is the “make it awesome” step for zoomed-in use:

- On-device detection:
  - night launches: bright-spot detection + temporal filtering
  - day launches: motion + contrast edge heuristics
  - auto-acquire by default in production UX (no manual target lock-on required)
  - manual lock controls are debug-only and must stay hidden behind explicit debug flags
- Tracking:
  - Kalman filter in pixel space
  - render short-horizon predicted pixel positions (+1/+2/+5 seconds)
- This operates independent of compass heading and is therefore the best answer to real-world web sensor limitations.

### Performance & battery budgets

- Render loop:
  - use `requestAnimationFrame`
  - avoid React re-rendering per frame (draw overlays to canvas)
- Sensor sampling:
  - throttle orientation updates (e.g., 30–60Hz max)
  - low-pass filter noisy heading
- Heavy compute:
  - run detection/tracking in a WebWorker (or OffscreenCanvas where available)
- Network:
  - only fetch trajectory products for eligible launches
  - cache the trajectory payload in-memory for the session

### Privacy & security posture

- Never upload camera frames by default.
- Location is used only to compute pointing; analytics should store coarse, non-identifying telemetry (and be opt-in if we add it).
- Provide clear copy explaining why permissions are needed and how data is handled.

## 6) Feature gating: next 3 launches only (dynamic)

### Definitions

- “Eligible launches”: at any moment, the first 3 launches by `net` time that are not expired.
- “Expired”: a launch becomes expired **3 hours after flight complete**.
- “Flight complete” (practical definition for v1):
  - `completeAtMs = getLaunchMilestoneEndMs(launch, fallbackMs)` where:
    - `fallbackMs = 0` for launches with timeline data
    - for launches without timeline: `completeAtMs = netMs`
  - `expiresAtMs = completeAtMs + 3 * 60 * 60 * 1000`

This uses existing milestone parsing (`lib/utils/launchMilestones.ts`) and avoids needing a separate “actual liftoff” timestamp.

### Enforcement points

- UI: show the “AR trajectory” CTA only if `launch.id` is in the eligible set.
- API: only serve trajectory product for eligible launches (return 404/403 otherwise).
- Storage: only generate/update trajectory products for eligible launches.
- Premium gating note: `public.launch_trajectory_products` is **RLS-enforced** (paid/admin only). API checks (auth + tier) are defense-in-depth.

### Caching and correctness

- Eligibility should be computed server-side using server time to avoid client clock issues.
- Keep eligibility response cache TTL low (e.g., 30–60s) so the “next 3” set updates without manual intervention.
- If eligibility is implemented via a SQL view using `now()`, ensure the endpoint is `force-dynamic` and not statically cached by Next.js.

### Data selection algorithm (server-side)

1) Query launches ordered by `net ASC`, with enough horizon (e.g., next 50).
2) Filter out launches whose `expiresAtMs < nowMs`.
3) Take first 3 and return their `launch_id`s.

Implementation note: we currently include a 24h lookback window for `net` to keep just-launched flights eligible for the 3-hour expiry window, and we ignore timeline offsets for `hold` / `scrubbed` statuses.

Optionally implement as a Postgres view for simplicity:

- `public.launches_ar_eligible`:
  - selects from `launches_public_cache`
  - filters `net >= now() - interval '3 hours'` (or uses a computed expiry)
  - orders by `net asc`
  - `limit 3`

Note: view-based expiry will be approximate unless we also persist a computed `milestone_end_at` field.

## 7) Repo-tied implementation plan (phased)

### Phase 0 — Schema + gating plumbing (1–2 days)

- Add pad lat/lon to `launches_public_cache` so non-premium can render pad direction.
- Implement the “eligible set” lookup and enforce it in UI + API.
- Add a minimal AR page with:
  - camera background
  - pad arrow guidance
  - pad marker (no trajectory yet)

### Phase 1 — Trajectory product v1 (template-only) (3–7 days)

- Add a `launch_trajectory_products` table keyed by `launch_id`.
- Implement a server job to generate trajectory products only for eligible launches.
- Render predicted curve + uncertainty band.
- Add “export az/el CSV”.

### Phase 2 — Constraints ingestion (ongoing)

- Add optional constraint fetchers (hazard areas / press kit parsing) to improve Tier 2.
- Expand template library by vehicle/pad/mission class (optional; currently disabled to avoid guessed azimuths).

### Phase 3 — Vision lock-on (5–10 days)

- Implement client-side detection/tracking with WebWorker.
- Add “ghost silhouettes” and loss/reacquire UX.

## 8) Implementation checklist (mapped to this repo)

### Database (Supabase migrations)

- Add `pad_latitude`, `pad_longitude` to `public.launches_public_cache` (new migration in `supabase/migrations/`).
- Add table `public.launch_trajectory_products`:
  - `launch_id uuid primary key references public.launches(id) on delete cascade`
  - `version text not null`
  - `quality int not null`
  - `generated_at timestamptz not null default now()`
  - `product jsonb not null`
  - indexes: `generated_at desc`
- Optional: add `milestone_end_at timestamptz` to cache to support accurate expiry in SQL.

### Ingestion / jobs

- Update public cache builder to carry pad coords:
  - `lib/ingestion/publicCache.ts`
  - `supabase/functions/ingestion-cycle/index.ts` (if it also builds cache rows)
- Add LL2 landings ingestion for eligible launches:
  - new module `lib/ingestion/ll2Landings.ts` (or extend `lib/ingestion/ll2.ts`)
  - optional new tables if we want persistence (`public.ll2_landings`, `public.ll2_landing_locations`)
- Add a scheduled job (Supabase Edge Function or Vercel cron) to:
  - compute eligible launch IDs
  - generate/update `launch_trajectory_products` for those IDs
  - (Now available) `supabase/functions/trajectory-products-generate/index.ts` builds Tier 0+ products for eligible launches.
  - (Now available) `supabase/functions/trajectory-constraints-ingest/index.ts` ingests LL2 landing constraints.
  - (Now available) `supabase/functions/spacex-infographics-ingest/index.ts` ingests SpaceX launch page infographic URLs (mission profile visuals).

### Server helpers / types

- Extend `Launch` type with pad coordinates:
  - `lib/types/launch.ts` (`pad.latitude`, `pad.longitude`)
- Update transformers:
  - `lib/server/transformers.ts` to map new columns from cache/live rows
- Add eligibility helper:
  - new `lib/server/arEligibility.ts` exporting `fetchArEligibleLaunchIds(nowMs)`
  - reuse `lib/utils/launchMilestones.ts`

### API routes (Next.js)

- Add `GET app/api/public/launches/ar-eligible/route.ts`
  - returns eligible launch IDs and expiry metadata
- Add `GET app/api/public/launches/[id]/trajectory/route.ts`
  - returns trajectory product if eligible, else 404/403

### UI (Next.js App Router)

- Add AR entry point on launch detail:
  - `app/launches/[id]/page.tsx` (CTA shown only if eligible)
- Add AR page:
  - `app/launches/[id]/ar/page.tsx` (dynamic, permissions, loads trajectory product)
- Add components:
  - `components/ar/ArCamera.tsx` (camera + overlays)
  - `components/ar/ArHud.tsx` (arrows, telemetry, controls)
- Add math utilities:
  - `lib/ar/geo.ts` (WGS84/ECEF/ENU conversions, bearing/elevation)
  - `lib/ar/projection.ts` (camera projection, FOV calibration)
  - `lib/ar/sensors.ts` (orientation reading + quality scoring)

### Analytics + QA

- Add event logging (where we currently do analytics, or create a minimal `public.ar_events` table if we don’t have one yet).
- Add a QA checklist in `docs/QA.md` for:
  - iOS Safari permissions
  - Android Chrome permissions
  - heading calibration flow
  - performance/battery

## 9) Open questions (need decisions)

- Do we allow AR for non-US launches if/when we ingest them? (Current ingestion is US-focused via `location__ids`.)
- What’s the desired minimum “acceptable” accuracy for pre-launch mode (degrees at the sky)?
- Do we want this feature gated by auth/subscription, or purely by “next 3 launches”?
- Do we want to store any user calibration data (privacy implications)?
