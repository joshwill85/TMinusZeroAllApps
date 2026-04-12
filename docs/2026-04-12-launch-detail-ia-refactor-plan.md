# 2026-04-12 Launch Detail IA Refactor Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: no for this slice

## Product direction

- Canonical launch-detail routes remain the shipping source of truth:
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/mobile/app/launches/[id].tsx`
- The `.tabs` launch-detail routes stay temporary compatibility surfaces during migration.
- This slice is a presentation and shared-view-model refactor only.
  Keep `LaunchDetailV1` and `/api/v1/launches/[id]` unchanged.

## Locked decisions

- Mission name is the single primary title. Fall back to launch name only when mission name is absent.
- Shared information architecture is:
  - `Overview`
  - `Timeline`
  - `Viewing`
  - `Vehicle`
  - `Coverage`
  - `Details`
- Sticky navigation should expose only:
  - `Overview`
  - `Timeline`
  - `Viewing`
  - `Vehicle`
  - `Coverage`
- `Details` stays below the main path and is not promoted into the primary sticky chip rail.
- Hero order is fixed:
  status pill, countdown, mission title, subtitle/meta, time row, primary actions, utility chips, next-event card.
- Primary hero actions are fixed:
  `Watch live`, `Get alerts` / `Follow`, and `Share`.
- AR moves out of the top slot and into `Viewing`.
- Vehicle history stays available, but collapses by default and is branded as `Vehicle history`.
- Weak empty states stay inside their owning sections and do not take prime screen space.

## Implementation

### Shared launch-detail model

- Add a shared `LaunchSectionId` model and section-order helpers in `packages/launch-detail-ui`.
- Add shared hero helpers for:
  - primary title resolution
  - subtitle/meta line
  - simplified primary status label
  - utility chips
  - next-event summary
- Use the shared hero helpers from both canonical shells.

### Web shell

- Remove the duplicate pre-hero title block.
- Promote mission title into the hero and keep the provider / vehicle / pad line directly below it.
- Add a local-time plus UTC row in the hero with an accessible UTC toggle.
- Keep the compact sticky header, but refocus it on mission name, status, countdown, and watch.
- Add a sticky section-chip rail under the header using the shared section ids.
- Keep one responsive page:
  - mobile web gets collapsing sticky chrome and a sticky bottom watch CTA
  - desktop keeps the same IA without the bottom CTA
- Reorder the main content into the shared section ownership model.

### Native shell

- Replace the hidden header / countdown floating bar shell with a real native header.
- Keep platform-native header behavior:
  - iOS: back on the left, follow/share on the right
  - Android: top app bar with back and actions
- Add an in-page launch section pill rail that jumps to grouped sections.
- Keep grouped screen depth native:
  - sheets for watch options, raw data, and pad map
  - disclosures for advisories, vehicle history, payload/program metadata, and deeper detail
- Reorder the grouped modules to match the shared IA.

### Compatibility routes

- Keep the web and mobile `.tabs` routes compiling by adapting them over the shared hero/section model.
- Do not promote those routes as canonical again during this slice.

## Verification

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Notes

- Live Activities / Dynamic Island / Android equivalents stay out of this page-shell slice.
- The 2026-04-05 launch-detail plan is superseded by this IA-first refactor plan.
