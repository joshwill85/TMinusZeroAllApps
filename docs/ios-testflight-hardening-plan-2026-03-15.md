# iOS TestFlight Hardening Plan

Date: 2026-03-15

## Platform Matrix

- Web: included as dependency surface for shared `/api/v1`, app links, and billing readiness
- iOS: included
- Android: not included
- Admin/internal impact: limited to billing/app-link operational evidence
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Ship an iOS TestFlight beta that closes the current auth/session safety gaps, reaches full customer-flow parity for the mobile core, and uses CI/EAS-first verification to avoid repeated local simulator artifact churn.

## Slices

- Auth/session hardening: clear auth-scoped query state on sign-out and session replacement, require verified reset-link tokens, and honor sanitized return routing.
- Feed/saved/detail parity: add Following feed mode, native follow/save management, managed watchlists and presets, and per-launch alert affordances.
- Preferences and notifications: make account notification settings editable on mobile and wire SMS verification to the existing `/api/v1` routes.
- Release hardening: close iOS build/app-link/workflow gaps, parameterize APNs environment, and keep the iOS beta lane provider-scoped to Apple + Stripe.

## Verification

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:mobile-security-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run mobile:e2e:acceptance:ios` in CI/EAS or on a dedicated simulator host
