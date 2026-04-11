# Premium Onboarding And Free-Tier Unification Plan

Last updated: 2026-04-10

## Scope Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing or admin/internal: both

## Why This Slice Exists

- The current repo still has multiple incompatible auth and billing assumptions:
  - web Stripe checkout can still start without an authenticated viewer
  - native billing can still mint guest purchase claims when no viewer is present
  - admin/reporting does not normalize login source consistently
  - web guest behavior is weaker than signed-in unpaid behavior even though the product model is now effectively `Free` and `Premium`
  - latent Google auth support exists, but the surfaced login-method and sign-in UI is inconsistent across surfaces
- The product target for this slice is one premium onboarding sequence and two effective customer states:
  - `Guest / Free`
  - `Premium`

## Locked Decisions

- Use one shared premium onboarding sequence across surfaces:
  - choose Premium
  - authenticate or create account
  - accept Terms and Privacy
  - start billing
  - confirm entitlement
- Keep account-first purchases mandatory on every surface.
- Public email signup remains disabled.
- Existing-account sign-in remains available with email, Google, and Apple.
- Legacy claim flows stay only as migration-safe recovery for already-issued claims.
- Internally keep the `anon` enum in this change for compatibility, but display unpaid status as `Free` or `Guest / Free`.
- Web notifications remain retired; parity means guest and signed-in-free affordance alignment, not browser push restoration.

## Implementation Passes

### Pass 1: Shared Auth And Reporting Foundation

- Add one shared provider/source normalization helper and use it from:
  - admin users API
  - auth methods payload
  - callback/auth-context reporting surfaces that need deterministic provider labels
- Expand auth methods contracts from the fixed email-plus-Apple assumption to the deterministic set:
  - `email_password`
  - `google`
  - `apple`
- Add admin `authSource` reporting with normalized values in this fixed order:
  - `email_only`
  - `google_only`
  - `apple_only`
  - `email_google`
  - `email_apple`
  - `google_apple`
  - `email_google_apple`
  - `unknown`
- Relabel unpaid admin status from `Anon` to `Free`.
- Move repo-managed Supabase auth config toward the target posture:
  - public email signup disabled
  - Apple enabled
  - Google enabled in config
  - `before_user_created` hook path reserved for premium-onboarding-only create gating

### Pass 2: Surface Cutover To Account-First Premium

- Web:
  - require an authenticated viewer before creating a Stripe checkout session
  - stop autostarting guest checkout
  - route guest premium intents into sign-in first
  - keep claim-token recovery available only for already-issued claims
- iOS and Android:
  - require an authenticated viewer before starting StoreKit or Play billing
  - stop creating new guest purchase claims on the primary path
  - keep restore logic viewer-bound
  - surface Google in mobile sign-in alongside Apple and email where supported
- Login methods:
  - expose Google anywhere the repo already has latent support and the current platform can manage it safely
  - keep Apple surfaced on iOS and on web where configured

### Pass 3: Free-Tier Unification And Legacy Cleanup

- Align guest and signed-in-free capability affordances on web:
  - launch browsing
  - filters
  - calendar
  - current unpaid single-launch follow / basic alert affordances
- Preserve current mobile guest push behavior and copy-forward on the same device after sign-in.
- Remove product navigation and helper paths that generate fresh claim-token auth URLs for normal flows.
- Keep legacy claim routes available only for migration recovery and already-issued claims.

## Public Contracts And API Changes

- Expand `authMethodsSchemaV1` to include `google` and remove the old fixed-length-two assumption.
- Add normalized `authSource` to the admin users response.
- Reserve additive premium onboarding contracts for:
  - create or resume premium onboarding intent
  - record legal acceptance
  - preflight provider-based first-time account creation
- Change billing-init behavior so:
  - web checkout is authenticated-only
  - native billing sync no longer creates new guest claim records when `viewerId` is missing

## Data And Backend Work

- Add a shared auth-source normalization helper in `packages/domain`.
- Add premium-onboarding persistence for short-lived allow-create records and legal acceptance records.
- Add a Supabase `before_user_created` gate backed by premium onboarding allow-create state.
- Keep all schema and auth changes additive during rollout.

## Surface-Specific Notes

### Web

- Web remains the only Stripe checkout surface.
- Web does not regain browser notifications.
- Web guest behavior should match signed-in unpaid behavior for the current free alert/follow affordances.

### iOS

- Apple sign-in remains the native-first premium onboarding path on iPhone.
- Premium purchase must use a viewer-bound StoreKit token rather than a guest claim.

### Android

- Google sign-in remains the primary native social auth path.
- Premium purchase must use a viewer-bound Play billing token rather than a guest claim.

## Blast Radius

- `apps/web/components/AuthForm.tsx`
- `apps/web/components/UpgradePageContent.tsx`
- `apps/web/app/api/billing/checkout/route.ts`
- `apps/web/app/account/login-methods/page.tsx`
- `apps/web/app/admin/users/page.tsx`
- `apps/web/app/api/admin/users/route.ts`
- `apps/web/lib/server/authMethods.ts`
- `apps/web/lib/api/queries.ts`
- `apps/web/components/LaunchFeed.tsx`
- `apps/web/components/WatchlistFollows.tsx`
- `apps/mobile/app/sign-in.tsx`
- `apps/mobile/src/auth/supabaseAuth.ts`
- `apps/mobile/src/features/account/LoginMethodsScreen.tsx`
- `apps/mobile/src/features/account/AccountMembershipScreen.tsx`
- `apps/mobile/src/components/MobileDockingBay.tsx`
- `apps/mobile/src/billing/useNativeBilling.ts`
- `packages/contracts/src/index.ts`
- `packages/domain/src/*`
- `supabase/config.toml`
- additive `supabase/migrations/*`

## Rollout Order

1. Docs and shared contracts/helpers.
2. Admin/reporting normalization.
3. Account-first checkout and native billing gates.
4. Surface auth exposure updates.
5. Guest/free parity updates.
6. Compatibility soak.
7. Legacy flow cleanup after evidence holds.

## Rollback Notes

- Revert surface cutover first if account-first purchase gating causes auth dead ends.
- Keep legacy claim routes in place during the soak window so already-issued claims remain recoverable.
- Keep `/api/v1` changes additive so older clients can still read auth methods and entitlements safely.

## Verification Set

- Required toolchain validation:
  - `node -v && npm -v`
  - `npm run doctor`
  - `npm ci`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
- Acceptance coverage:
  - web premium flow requires auth before checkout
  - iOS premium flow requires auth before StoreKit
  - Android premium flow requires auth before Play billing
  - email-only, Google-only, Apple-only, and mixed-provider existing accounts still sign in and upgrade cleanly
  - mobile guest retains current free push behavior
  - web guest and signed-in-free affordances align for unpaid follow/alert behavior
  - admin source column shows normalized combinations and unpaid users display as `Free`

## Open Follow-Ups

- Finish the controlled provider-auth create flow for Google and Apple first-time account creation using provider-issued tokens plus server-side preflight.
- Enforce `before_user_created` against premium onboarding allow-create state once every surface is issuing the allow-create preflight reliably.
- Remove remaining legacy primary-path claim UX after compatibility soak confirms no regressions.
