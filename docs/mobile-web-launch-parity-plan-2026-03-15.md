# Mobile Web Launch Parity Plan

Date: 2026-03-15

## Platform Matrix

- Web: source-of-truth only, behavior unchanged
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Bring native launch cards and the native launch detail page into close structural parity with the web mobile experience, using the web implementations as the exact specification for fields, sections, and actions.

## Source Of Truth

- Web launch card: `apps/web/components/LaunchCard.tsx`
- Web launch detail page: `apps/web/app/launches/[id]/page.tsx`
- Shared mobile detail contract: `packages/contracts/src/index.ts`
- Mobile detail API mapper: `apps/web/lib/server/v1/mobileApi.ts`

## Current Gaps

### Launch cards

- Native cards are still missing most of the web action layer: follow/save/alerts/share/calendar/AR and the richer time-state system.
- Native cards still flatten multiple web fields into a small number of text rows.
- Native feed composition still differs from web feed chrome around the cards.

### Launch detail

- Native detail is currently generic scaffolding built from a few `SectionCard` blocks.
- The mobile detail contract only exposes a thin subset of the fields the web detail page uses.
- Full field-for-field parity is not achievable as a native-only UI pass without broadening the shared detail payload.

## Contract Gaps To Close

At minimum the mobile detail contract needs to grow beyond:

- `mission`
- `padName`
- `padLocation`
- `windowStart`
- `windowEnd`
- `weatherSummary`
- `launchStatusDescription`
- `rocketName`
- `related`
- enrichment counts

The native detail page needs the web detail information model for:

- hero chips and action cluster
- richer launch facts
- rocket/provider/pad blocks
- weather and advisory modules
- stages and recovery data
- mission resources and timeline content
- news and update log content
- mission stats and booster history

## Rollout Order

### Phase 1: Card parity

- Continue the native `WebParityLaunchCard` rewrite using the existing feed item payload.
- Match the web card hierarchy more closely before adding more feed-level chrome.
- Keep this phase mobile-only.

### Phase 2: Shared detail contract expansion

- Expand `launchDetailSchemaV1`.
- Expand `launchDetailPayload` generation in `apps/web/lib/server/v1/mobileApi.ts`.
- Reuse existing server-side detail enrichment sources where possible instead of inventing mobile-only shapes.
- Keep the changes additive so existing consumers remain compatible.

### Phase 3: Native detail page rewrite

- Replace the current generic detail screen with a sectioned panel system modeled on the web detail page.
- Port the hero first, then launch info, then operational modules, then history/stats modules.
- Prefer hiding a module when data is absent over substituting placeholder copy that diverges from web.

## Rollback Notes

- Phase 1 can be reverted independently because it is native-only.
- Phase 2 must remain additive to make rollback low-risk.
- Phase 3 should consume the new contract opportunistically so partially released modules can fail closed without breaking the page.

## Verification

Run under the pinned toolchain:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:mobile`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run type-check:ci`
- targeted simulator validation on iOS

## Implementation Notes

- Do not create a separate native information architecture for launches.
- If a web field exists and the mobile payload can carry it, render it in native rather than replacing it with custom copy.
- If a web section cannot be ported in the current slice, leave it out cleanly and track it as an explicit remaining gap.
