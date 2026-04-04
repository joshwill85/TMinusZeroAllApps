## Summary

- Platform matrix: `Web: included`, `iOS: included`, `Android: included`, `Admin/internal impact: yes`, `Shared API/backend impact: yes`
- This is customer-facing plus admin/internal debugging.

## Scope

1. Keep the mobile default launch schedule visible during public-to-live/admin transitions and after anomalous empty live responses.
2. Make the admin self-service anon/premium override work through the authenticated session path without depending on server-side service-role availability.

## Verification

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:launch-refresh-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
