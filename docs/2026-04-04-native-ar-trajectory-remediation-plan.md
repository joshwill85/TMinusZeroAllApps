# Native AR Trajectory Remediation Plan

Date: 2026-04-04

## Platform Matrix

- Web: included as the existing camera-guide reference and for eligibility/admin parity.
- iOS: included as the primary implementation target for the current native AR route.
- Android: included where the same native route and post-camera HUD logic apply.
- Admin/internal impact: yes.
- Shared API/backend impact: yes.
- Customer-facing: yes.

## Scope

Address the seven audited AR issues:

1. Replace the blocking iOS alignment card with lightweight directional/status guidance.
2. Remove the redundant top-left launch summary card from native AR.
3. Make session status admin-gated and fully collapsible.
4. Improve the zoom-unavailable state so it reflects the actual runtime/capability reason.
5. Replace the current `Widescreen` control with a real immersive full-screen mode.
6. Make the lower information stack scrollable on smaller screens.
7. Align the admin eligibility inspector with the production AR eligibility window and make the window easier to reason about.

## Constraints

- Keep the shared trajectory contract unchanged.
- Do not widen scope into unrelated launch-detail or shared design-system refactors.
- Preserve web as the lighter camera-guide reference instead of forcing web/native UI parity.
- Keep admin/debug detail available for admins without leaking it into the default customer HUD.

## Phases

### Phase 1: HUD cleanup and safer guidance

- Remove the top-left launch summary card from native AR.
- Replace the large centered alignment blocker with a compact, non-blocking guidance chip/stack.
- Keep only route-level navigation plus essential in-canvas controls.
- Preserve permission recovery actions when alignment is actually blocked.

### Phase 2: Layout and immersion

- Convert the AR route body to a scrollable layout that still prioritizes the camera surface.
- Replace `Widescreen` with a true full-screen/immersive mode.
- In immersive mode, hide route chrome and system bars where supported, while keeping an explicit exit control.

### Phase 3: Session-status and zoom UX

- Gate the full session-status panel behind admin entitlements.
- Collapse admin session status by default.
- For non-admins, keep only minimal health/status messaging needed to recover from blocked states.
- Improve zoom messaging to distinguish unsupported runtime/device from temporarily unavailable zoom.

### Phase 4: Eligibility/admin parity

- Update the admin eligible-launch inspector to use the same helper/window logic as production AR gating.
- Surface expiry metadata in the admin response so the current window is inspectable.
- Keep the public production eligibility contract unchanged unless a follow-on change is explicitly requested.

## Rollout Order

1. Land mobile route/HUD changes first because they directly address the screenshot issues.
2. Land immersive mode and scrollability together to avoid partial layout regressions.
3. Land admin gating and zoom messaging once the new HUD shape is in place.
4. Land eligibility/admin parity last because it is isolated and easy to validate independently.

## Verification Set

Because this work touches `apps/mobile` plus server AR eligibility logic, target:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Current Verification Blocker

The active shell is not on the pinned repo toolchain:

- Node: required `20.19.6`, current shell `25.8.0`
- npm: required `10.8.2`, current shell `11.11.0`

Implementation can proceed, but final repo-standard verification remains blocked until the shell is switched to the pinned toolchain.
