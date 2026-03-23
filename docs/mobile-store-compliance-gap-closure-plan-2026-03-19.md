# Mobile Store Compliance Gap Closure Plan

Last updated: 2026-03-19

This doc tracks the repo work needed to close the current mobile App Store / Play Store compliance gaps without widening scope into unrelated product changes.

## Scope

- Customer-facing: `yes`
- Web: `included` for shared legal/privacy copy and shared delete-account/billing support surfaces
- iOS: `included`
- Android: `included`
- Admin/internal impact: `no`
- Shared API/backend impact: `yes`

## Goals

- Add a clearly discoverable in-app mobile account deletion flow.
- Remove risky mobile external-commerce surfaces.
- Keep native store billing on native and keep browser-first billing on web only.
- Hide Sign in with Apple until explicit production config exists.
- Align privacy/legal copy and submission notes with actual shipped mobile behavior.

## Repo Touch Points

- `apps/mobile/app/(tabs)/profile.tsx`
- `apps/mobile/src/api/queries.ts`
- `apps/mobile/src/components/MobileDockingBay.tsx`
- `apps/mobile/src/auth/supabaseAuth.ts`
- `apps/mobile/src/providers/MobilePushProvider.tsx`
- `apps/web/lib/server/v1/mobileApi.ts`
- `apps/web/app/legal/privacy/page.tsx`

## Implementation Plan

### 1. Mobile account deletion

- Add a native delete-account entry in Profile.
- Require typed `DELETE` confirmation before the destructive action is enabled.
- On success:
  - clear local auth state
  - clear auth-scoped query state
  - clear stored mobile push client state
  - return the app to guest state
- Mobile copy must distinguish:
  - first-party data deleted from our systems
  - payment-provider records that may remain
  - App Store / Google Play subscriptions that must be canceled in the store

### 2. Mobile billing policy hardening

- Remove Tip Jar from mobile navigation/surfaces.
- Remove mobile direct CTA that opens Stripe web billing.
- Keep native purchase and restore flows for App Store / Google Play.
- If the viewer has an App Store or Google Play subscription, show a delete warning with a store-management action plus a continue-delete path.
- If Stripe auto-cancel-on-delete fails, surface a support-directed error instead of a browser-billing redirect.

### 3. Shared delete path review

- Keep the existing `/api/v1/me/account/delete` contract.
- Reuse current Stripe cancel-at-period-end behavior for legacy Stripe-backed subscriptions.
- Audit whether auth-user deletion already cascades through user-owned tables before adding manual cleanup.

### 4. Sign in with Apple placeholder

- Gate Apple OAuth availability behind explicit client-visible config.
- Keep the Apple OAuth launch path behind a provider-specific boundary so token capture/revocation can plug in later without reshaping callers.
- Do not expose a disabled Apple button in production builds.

### 5. Privacy and submission alignment

- Update the privacy notice to reflect:
  - Apple and Google sign-in when offered
  - App Store / Google Play / Stripe billing roles
  - Expo/native push device registration
  - mobile auth risk and sign-in event storage
  - AR telemetry summaries
  - in-app mobile deletion availability
- Add an App Store Connect privacy-answer worksheet derived from shipped data flows.

## Rollout Order

1. Docs plan and privacy worksheet
2. Mobile delete flow and mobile policy CTA removal
3. Apple auth gating placeholder
4. Legal/privacy copy update
5. Verification under pinned Node/npm toolchain

## Rollback Notes

- Mobile UI changes are isolated to Profile/auth/dock surfaces and can be reverted without contract changes.
- Apple auth gating is additive and only hides the provider unless explicit config is turned on.
- Delete-account route remains the same API surface; any backend change must stay request/response compatible.

## Verification Set

Run under Node `20.19.6` and npm `10.8.2`:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

If the environment supports it, also run relevant mobile E2E around Profile/account deletion entry points.

## Deferred Until Real Apple Credentials Exist

- Capturing and persisting Apple authorization material needed for deletion-time revocation
- Server-side Apple token revocation on delete
- Revoked-credential handling after Apple account changes
