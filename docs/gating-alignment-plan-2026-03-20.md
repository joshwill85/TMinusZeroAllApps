# Gating Alignment Plan

Date: 2026-03-20

Platform matrix:
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

Customer-facing scope:
- Open one-off calendar adds to all users across web and native surfaces.
- Keep native membership presentation as `anon` or `premium`.
- Keep launch-day email on web only and reject bearer-auth mobile mutations for those fields.

Implementation notes:
- Shared entitlement capability for `canUseOneOffCalendar` is now universal.
- Web guest fallbacks and one-off ICS delivery are aligned with that open-to-all policy.
- Native profile, preferences, saved, and calendar surfaces normalize the shared tier to `anon|premium` before rendering mobile account state.
- Native notification preferences no longer carry launch-day-email draft fields, and the shared `/api/v1/me/notification-preferences` update path returns `400 unsupported_on_mobile` when bearer-auth clients try to mutate them.

Verification set:
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:launch-refresh-guard`
- `npm run test:gating-alignment-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
