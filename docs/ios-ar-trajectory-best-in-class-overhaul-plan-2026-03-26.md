# iOS AR Trajectory Best-in-Class Overhaul Plan

Date: 2026-03-26

## Platform Matrix

- Web: not included.
- iOS: included.
- Android: not included.
- Admin/internal impact: no.
- Shared API/backend impact: yes.
- Customer-facing: yes.

## Goals

- Make the native iOS AR trajectory runtime fast, truthful, smooth, and reliable.
- Remove forced landscape behavior and make orientation safe across iPhone and iPad.
- Make trajectory semantics stage-aware with honest milestone projection rules.
- Drive live AR UI from a real T- / T+ flight clock and remove prelaunch milestones at T0.

## Implementation Phases

### Phase 1 — Runtime hardening

- Remove automatic landscape lock on entry.
- Restore orientation safely on blur, close, push navigation, and background.
- Make session lifecycle focus-aware and background-aware.
- Treat location as a real prerequisite for live trajectory alignment.
- Stop restarting the AR session for zoom or live timeline updates.
- Remove false telemetry claims (`vision_native`, `intrinsics_frame`, optimistic exit permissions).

### Phase 2 — Shared trajectory truthfulness

- Extend track topology to support `core_up`, `upper_stage_up`, and `booster_down`.
- Preserve milestone `projectable` / `projectionReason` through the public contract.
- Add additive public fields for `guidanceSemantics` and `trackTopology`.
- Split modeled tracks at stage separation when current public data supports it.

### Phase 3 — Live AR experience

- Add a live T- / T+ controller on the mobile AR route.
- Make prelaunch milestones collapsible before launch and remove them entirely at T0.
- Render projectable milestones only.
- Distinguish past vs future path and active-flight position.
- Surface uncertainty honestly in the native renderer and route UI.

### Phase 4 — Apple-native alignment

- Keep ARKit world tracking as the default path.
- Use heading-quality governance rather than always forcing `gravityAndHeading`.
- Keep zoom via `configurableCaptureDeviceForPrimaryCamera` on iOS 16+.
- Leave geo-tracking and high-resolution capture behind explicit validation gates.

## Verification

- `node -v && npm -v`
- `npm run doctor`
- `npm run test:smoke`
- `npm run test:v1-contracts`
- `npm run type-check:mobile`
- `npm run type-check:ci`
- `npm run lint`

## Defaults Locked

- Current shared/public data stack only; no new licensed data sources.
- No automatic landscape lock.
- iPad remains supported, but without forced full-screen rotation behavior.
- Prelaunch milestones are removed entirely at T0.
