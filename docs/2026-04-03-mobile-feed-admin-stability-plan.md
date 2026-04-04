# 2026-04-03 Mobile Feed + Admin Stability Follow-Up

## Platform matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Surface type: customer-facing plus admin/internal debugging

## Problem statement

- Mobile launch schedule can render valid launch data initially, then collapse into an empty state after entitlement scope changes.
- Admin self-service tier testing can fail with an API error in environments that do not expose a Supabase service-role client to the web runtime.
- The failure modes combine badly for admins because the feed can begin in public mode, then switch to live mode after entitlements resolve.

## Root causes

1. The mobile feed does not preserve the last good default schedule while switching from public to live scope.
2. `public.admin_access_overrides` only grants self-read access in SQL; writes currently require service-role access from the API route.
3. The mobile admin toggle route hard-requires `SUPABASE_SERVICE_ROLE_KEY`, even though bearer/cookie session clients can be used safely with proper RLS.

## Implementation plan

1. Add additive SQL policies for admin self-service writes on:
   - `public.admin_access_overrides`
   - `public.admin_access_override_events`
2. Relax the `/api/v1/me/admin-access-override` server helper so it uses:
   - service-role client when available
   - otherwise the authenticated session-scoped Supabase client
3. Harden the mobile feed so the default schedule keeps the last non-empty launch list visible while:
   - public -> live entitlement transitions are resolving
   - live refresh returns empty or errors unexpectedly
4. Add regression checks for:
   - the new admin override write policies
   - the route fallback away from service-role-only behavior
   - the mobile feed retained-schedule fallback

## Rollout and rollback

- Rollout order:
  1. ship code changes
  2. apply the new Supabase migration
  3. deploy web/API runtime
  4. rebuild mobile app for device testing
- Rollback:
  - mobile feed fallback can be reverted independently
  - admin override behavior can be disabled by reverting the new migration and route fallback together

## Verification set

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:launch-refresh-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
