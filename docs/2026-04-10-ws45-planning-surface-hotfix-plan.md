# 2026-04-10 WS45 Planning Surface Hotfix Plan

## Scope

- Surface the current WS45 planning products for upcoming Eastern Range launches when the mission-specific WS45 forecast is absent.
- Keep the mission forecast attachment rules unchanged.
- Add explicit partial-extract labeling so partial planning parses are not presented as fully attached mission briefs.

Platform matrix:

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Surface type: customer-facing launch detail weather

## Problem

Current launch detail weather reads the mission-specific WS45 forecast with a strict `publish_eligible + matched` gate. For the April 11, 2026 Florida launch, that mission forecast is absent because the WS45 launch-support page is only exposing an FAQ PDF right now.

The environment does have:

- fresh WS45 live-board snapshots
- fresh WS45 planning forecast rows

But the planning read path currently also requires `publish_eligible = true`, and the latest planning rows are partial parses, so they are suppressed entirely.

## Hotfix

1. Keep the existing mission-specific WS45 forecast gate unchanged.
2. Relax the planning-product read path from `publish_eligible = true` to:
   - `parse_status != failed`
   - valid window present
   - existing launch-window selection logic still applies
3. Prefer publishable planning rows first, then fall back to partial rows.
4. Label partial rows as limited extracts in both:
   - the web launch weather panels
   - the shared weather card payload used by web/mobile live tabs

## Risks

- Partial planning parses may have weak summaries. The UI must indicate that clearly.
- This does not manufacture a mission-specific forecast when WS45 has not published one.
- This should not change entitlement gating or mission-forecast publish rules.

## Verification

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run lint`

Targeted runtime verification:

- confirm the April 11, 2026 Florida launch selects a current WS45 planning row
- confirm partial rows render with limited-extract labeling
- confirm no change to mission-specific WS45 fetch behavior
