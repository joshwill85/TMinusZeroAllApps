## Mobile Auth And Tier Parity Plan

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Implement safe mobile sign-in and tier parity so `anon`, `free`, and `premium` behave consistently across web, iOS, and Android without forcing sign-in for public browsing.

## Scope

- Keep public browsing open for `anon`.
- Use the existing shared entitlement model as the product source of truth.
- Add a shared tier-experience manifest for tier cards and feature gating copy.
- Record auth provider/platform context after successful sign-in, callback, and password reset flows.
- Surface provider/platform metadata in the web admin users panel.

## Rollout Slices

### Slice 1: Shared tier manifest

- Add a domain-level manifest for:
  - tier card copy for `anon`, `free`, `premium`
  - feature-level minimum tier requirements
  - blocked-state copy and CTA target
- Reuse this manifest in mobile tier panels instead of screen-local strings.

### Slice 2: Auth context capture

- Add a typed `/api/v1/me/auth/context` route.
- Add additive database tables for:
  - per-user platform summary
  - append-only sign-in event history
- Record context from mobile password sign-in, mobile callback, mobile password reset, web password auth, and web auth callback.

### Slice 3: Mobile tier parity

- Keep browsing screens public.
- Standardize mobile cards so:
  - `anon` sees account value and sign-in CTA
  - `free` sees premium value and upgrade CTA
  - `premium` sees active-value card
- Use capability-first gating for saved items, preferences, calendar, and account surfaces.

### Slice 4: Admin visibility

- Extend `/api/admin/users` to include:
  - providers
  - primary provider
  - platform badges
  - avatar/name metadata
  - Apple private relay detection
  - pagination and filtering
- Extend `/admin/users` to render the new metadata.

## Safety Notes

- Do not introduce a second identity system.
- Keep all schema and route changes additive.
- Do not store provider tokens or device fingerprints in app-owned tables.
- Preserve cookie auth for web and bearer auth for mobile.

## Rollback Notes

- The shared tier manifest is UI-only and can be reverted independently.
- Auth context storage is additive and can fail closed without breaking sign-in.
- Admin metadata is derived from existing auth records and can be hidden without affecting customer flows.

## Verification

Run under the pinned toolchain:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

If the local shell is not on Node `20.19.6` and npm `10.8.2`, switch first or use Docker parity for verification.
