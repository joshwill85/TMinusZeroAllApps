# Premium Launch Calendar Implementation Plan

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Scope

- Add a dedicated Premium launch calendar screen on web and mobile.
- Keep launch-to-detail navigation intact from the calendar surface.
- Make single-launch add-to-calendar Premium-only and available from launch detail.
- Keep recurring tokenized calendar feed management web-only.

## Implementation Notes

- Reuse the existing launch feed contracts instead of adding a new calendar-specific API.
- Reuse existing web ICS endpoints and premium calendar-feed infrastructure.
- Align entitlement capabilities so the calendar screen and one-off add-to-calendar are Premium-gated consistently.
- Route the web footer calendar entry to `/calendar`.
- Route the mobile sticky dock calendar entry to `/calendar`.

## Verification

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
