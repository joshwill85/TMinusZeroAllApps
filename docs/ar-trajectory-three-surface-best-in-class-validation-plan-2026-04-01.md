# AR Trajectory Three-Surface Best-in-Class Validation Plan

Date: 2026-04-01

## Platform Matrix

- Web: included.
- iOS: included.
- Android: included.
- Admin/internal impact: no.
- Shared API/backend impact: yes.
- Customer-facing: yes.

## Goal

- Validate one shared AR trajectory truth across `Web`, `iOS`, and `Android`.
- Let each surface be best in class for its actual platform instead of forcing identical runtime behavior.
- Make native iOS and native Android premium AR products in their own right.
- Accept that browser quality differs by environment, and judge web excellence per browser rather than against a fake single-browser standard.

## Locked Product Rules

- Shared trajectory truth comes from the shared contract, not per-platform heuristics.
- Platform-native runtime behavior is allowed and expected:
  - `Web`: browser-specific experience, including Chrome-first advantages where available.
  - `iOS`: ARKit-first premium runtime.
  - `Android`: ARCore-first premium runtime with device-aware fallback.
- No surface may present false precision to preserve parity with another surface.
- If a platform cannot support trustworthy precision, it must degrade honestly to corridor or pad-only guidance.

## Existing Source-of-Truth Inputs

- Shared public trajectory contract: `packages/contracts/src/index.ts` (`TrajectoryPublicV2ResponseV1`)
- Web AR consumer: `apps/web/components/ar/ArSession.tsx`
- Native mobile AR route: `apps/mobile/app/launches/ar/[id].tsx`
- Native mobile runtime module: `apps/mobile/modules/tmz-ar-trajectory/*`
- Existing replay and KPI guardrails:
  - `docs/specs/ar-trajectory-family-replay-policy-v1.json`
  - `docs/specs/ar-trajectory-kpi-policy-v1.json`

## Validation Model

This plan treats AR validation as four separate gates:

1. Shared truth gate
2. Surface rendering gate
3. Runtime quality gate
4. Release evidence gate

The release cannot pass unless all four gates pass for the scoped family and device matrix.

## Canonical Mission Family Matrix

Initial release windows are intentionally conservative. They should only be narrowed after baseline evidence is captured from replay plus field runs.

| Family ID | Family | Typical Target Inclination | Expected Launch Azimuth Window | Notes |
| --- | --- | --- | --- | --- |
| `cape_iss_family` | Cape ISS / crew / CRS | `51.6 deg` | `44-46 deg` | Direct-launch geometry from Cape latitude implies about `45 deg` true bearing. |
| `cape_starlink_mid` | Cape Starlink mid-inclination shell | `53.0-53.2 deg` | `42-44 deg` | Covers current mid-inclination Starlink family. |
| `cape_starlink_low` | Cape Starlink lower-inclination shell | `42.0-43.0 deg` | `56-58 deg` | Distinct from ISS-family east-northeast cases. |
| `cape_leo_high_inc` | Cape higher-inclination LEO | `56.0-57.0 deg` | `38-40 deg` | Covers the high end of standard east-coast safe corridor launches. |
| `cape_gto_geo` | Cape GTO / GEO | orbit-specific | `80-110 deg` | Due east to southeast family; broad until better source coverage is proven. |
| `cape_unknown_eastbound` | Cape unknown but eastbound | unknown | `35-125 deg` | Never eligible for top-confidence precision if source is heuristic-only. |
| `vandy_polar_sso` | Vandenberg polar / SSO | orbit-specific | `175-205 deg` | Southbound control family to prove the matrix distinguishes Cape eastbound from Vandenberg southbound. |

## Observer Geometry Matrix

Required observer positions:

| Observer ID | Geometry | Purpose |
| --- | --- | --- |
| `W15` | `15 mi` west of pad | Reproduces the reported field geometry. |
| `SW15` | `15 mi` southwest of pad | Catches branch errors that hide from pure west positions. |
| `S15` | `15 mi` south of pad | Catches due-east vs northeast vs southeast separation. |
| `W30` | `30 mi` west of pad | Stress test for long-range observer-relative sky placement. |
| `N20` | `20 mi` north of pad | Control case for family symmetry and confidence labels. |
| `E15` | `15 mi` east of pad | Control case for horizon placement and fallback behavior. |

Required time samples per observer:

- `T-30`
- `T+10`
- `T+30`
- `T+60`
- `T+120`

## Shared Truth Gate

Every family fixture must pass all rules below before any platform runtime validation is allowed to claim success.

### Required fixture fields

- mission family ID
- pad coordinates
- `flight_azimuth_deg` when available
- `inclination_deg` when available
- chosen azimuth
- alternate azimuth candidate, if inclination-derived
- source type and authority tier
- confidence tier / badge
- quality state / guidance semantics
- track topology
- projected observer-relative points for each required observer/time sample

### Shared truth pass / fail rules

- If `flight_azimuth_deg` is present, selected azimuth must match within `+/- 1.0 deg`.
- If direction is inclination-derived, the selected azimuth must:
  - fall inside the expected family window
  - choose the correct branch versus the alternate candidate
  - land within `15 deg` of the family center unless the fixture is explicitly waived
- For all Cape eastbound families (`cape_iss_family`, `cape_starlink_mid`, `cape_starlink_low`, `cape_leo_high_inc`, `cape_gto_geo`), observer-relative early ascent from `W15`, `SW15`, `S15`, and `W30` must not diverge from pad bearing by more than `90 deg` at `T+10`, `T+30`, or `T+60`.
- If the trajectory package relies on heuristic-only direction for `cape_unknown_eastbound`, the package may not ship the top-confidence precision mode. Guidance must cap at corridor-grade or pad-only.
- Existing replay policy remains in force:
  - overall `p95 <= 3.5 deg`
  - overall `|drift| <= 2.0 deg`
  - overall `|slope| <= 1.8 deg/min`
  - worst-case `p95 <= 4.25 deg`
  - worst-case `|drift| <= 3.4 deg`

## Surface Rendering Gate

All surfaces must render the same shared trajectory package into the same broad sky sector for the same observer geometry, even if the runtime and UI are platform-specific.

### Cross-surface rendering rules

- For the same fixture, observer, and time sample, `Web`, `iOS`, and `Android` must place the active target in the same family-appropriate sky sector.
- Cross-surface divergence above `12 deg` at the same observer/time sample is a P1 investigation unless the runtime is explicitly in degraded mode.
- If one surface downgrades to corridor or pad-only due to runtime quality, that does not fail the rendering gate by itself. It only fails if the surface still claims precision while outside the allowed rendering variance.

## Web Excellence Gate

Web is judged per browser, not against a fake universal browser standard.

### Required browser matrix

- `android_chrome_flagship`
- `android_chrome_mid_tier`
- `ios_safari_current`
- `desktop_chrome_sanity`

Recommended but non-blocking:

- `android_samsung_internet`
- `desktop_safari_sanity`

### Web pass / fail rules

- Android Chrome may be the best web experience and is allowed to exceed Safari in precision, lock-on quality, and WebXR capability.
- iOS Safari does not fail merely because it cannot match Chrome WebXR behavior. It fails only if it over-claims precision or fails to degrade honestly.
- A browser must produce a usable view within `5s` after permissions and trajectory load:
  - live AR / camera guidance
  - corridor fallback
  - pad marker / SkyCompass fallback
- No browser may present precision turn guidance when heading is unavailable, motion permissions are blocked, or platform sensors are judged untrustworthy.
- Browser-specific fallbacks must preserve the shared truth gate. A fallback cannot draw a physically implausible early ascent just because the browser is limited.

## Native iOS Excellence Gate

iOS is a first-class premium AR product, not a mobile wrapper around web behavior.

### Required device matrix

- current Pro-class iPhone
- current non-Pro iPhone
- previous-generation iPhone still inside supported iOS window

### iOS pass / fail rules

- Session must reach a usable AR state within `5s` after permissions are granted and the trajectory package is loaded.
- Precision guidance is forbidden unless all are true:
  - `sessionRunning = true`
  - `trackingState = normal`
  - `locationFixState = ready`
  - `alignmentReady = true`
  - `headingStatus = ok` or `headingStatus = noisy`
- If geo-tracking is not localized, the runtime may still operate, but it must not claim the highest-confidence precision mode unless its own alignment policy explicitly allows it and the fixture evidence supports it.
- `activeTPlusSec` updates and zoom changes must not restart the AR session.
- In a `3 min` standing-run validation:
  - `relocalizationCount <= 1`
  - no unrecovered drift event is allowed
  - loss of trustworthy alignment must drop precision mode within `1s`
- Session interruption recovery target: return to usable guidance or honest degraded mode within `5s`.

## Native Android Excellence Gate

Android is also a first-class premium AR product and is not judged by iOS internals.

### Required device matrix

- current Pixel-class ARCore-capable device
- current Samsung flagship ARCore-capable device
- one supported mid-tier Android device

### Android pass / fail rules

- Session must reach usable guidance or explicit honest fallback within `5s` after permissions and trajectory load.
- Precision guidance is forbidden unless the Android runtime has both:
  - a trustworthy pose source for the current device
  - a ready alignment state that satisfies the Android session policy
- Unsupported devices must fail closed:
  - no fake precision
  - clear route-level fallback to launch detail or non-AR guidance
- OEM sensor variance may change runtime quality, but it may not change shared-truth family classification or selected azimuth.
- In a `3 min` standing-run validation:
  - no more than `1` unrecovered tracking reset
  - no precision mode while heading or pose quality is unknown/unavailable

## Telemetry and Evidence Gate

Every required family / observer / platform run must produce durable evidence.

### Evidence outputs

- fixture summary JSON
- selected azimuth and alternate-candidate summary
- observer-relative projected points
- screenshots or captured overlay frames
- session metadata:
  - platform
  - device class
  - browser/runtime type
  - tracking state
  - heading status
  - quality state
  - fallback reason
  - confidence badge
- replay and KPI reports
- persisted AR telemetry fields for release evidence:
  - `release_profile`
  - `time_to_usable_ms`
  - `location_fix_state`
  - `alignment_ready`

### Evidence storage

- Save release evidence under `docs/evidence/ar-trajectory/three-surface/<date>/`.
- Keep one summary markdown file plus machine-readable JSON artifacts.
- Build the gate-ready manifest with `npm run trajectory:surface-evidence`.
- Prefer persisted `release_profile` over sidecar labels when present.
- Structured capture runs may still set `arReleaseProfile=<profile>` on the route to stamp the exact release profile into telemetry when heuristic inference would be too ambiguous.

## Release Gate Structure

Release order:

1. Shared truth gate
2. Web excellence gate
3. Native iOS excellence gate
4. Native Android excellence gate
5. Evidence publication gate

Release is blocked if any of the following occur:

- wrong azimuth branch for a canonical family fixture
- Cape eastbound family renders behind the user in the required west/south observer cases
- heuristic-only package claims top-confidence precision
- web browser, iOS, or Android claims precision while its own runtime state is not trustworthy
- required evidence artifacts are missing

## Delivery Phases

### Phase 0 — Baseline and fixture lock

- Freeze the first canonical fixture set.
- Map each fixture to a family ID and expected azimuth window.
- Decide which fixtures are blocking and which are advisory.

### Phase 1 — Shared truth automation

- Implement deterministic family/observer replay fixtures.
- Emit selected azimuth, alternate branch, and observer-relative projections.
- Make the shared truth gate run in CI as warn-only first.

### Phase 2 — Web browser certification

- Add browser-specific validation runs and evidence capture.
- Promote the web gate from warn-only to blocking after one stable release cycle.

### Phase 3 — Native iOS certification

- Add iOS runtime evidence capture and session-quality thresholds.
- Promote iOS from advisory to blocking after baseline capture on the required device matrix.

### Phase 4 — Native Android certification

- Add Android runtime evidence capture and fallback certification.
- Promote Android from advisory to blocking after baseline capture on the required device matrix.

### Phase 5 — Full release integration

- Make the full gate blocking for trajectory generator, orbit-ingest, and AR-runtime changes.
- Publish evidence with each release candidate touching AR.

## Verification Set For Implementation Work

Run under the pinned toolchain when the implementation work lands:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Planned additive commands for this plan:

- `npm run trajectory:family-matrix`
- `npm run trajectory:observer-replay`
- `npm run trajectory:surface-evidence`
- `npm run ar:three-surface-gate`

## Rollback Notes

- Start all new gates in warn-only mode before making them blocking.
- Do not remove existing replay/KPI guards while this plan is rolling out.
- Keep all contract and telemetry changes additive.
- If a platform gate is unstable, block only that platform-specific gate while preserving the shared truth gate.

## Open Decisions

- Whether `iPad` is part of the premium iOS blocking matrix or advisory-only.
- Whether non-ARCore Android devices get camera guidance or route-level fallback only.
- Whether desktop browser sanity runs remain advisory forever or become blocking for regression coverage.
