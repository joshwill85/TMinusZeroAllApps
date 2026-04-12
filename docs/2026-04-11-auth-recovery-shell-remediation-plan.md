# Auth Recovery Shell And Claim-First Premium Remediation Plan

Date: 2026-04-11

## Scope Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Implement the runtime enforcement slice from the audit that is immediately actionable without redesigning the entire premium acquisition architecture:

1. Unpaid authenticated users must be treated as `anon` for customer product behavior and routed into a recovery-only shell.
2. Guest and signed-in-`anon` browse/search/filter affordances should match.
3. New-user Premium acquisition must not persist an unpaid account before billing succeeds.

## In Scope

- Shared helper(s) that decide whether a signed-in user is recovery-only
- Web account shell changes for unpaid authenticated users
- Web guards on saved, integrations, and login-method routes
- Mobile profile shell changes for unpaid authenticated users
- Mobile guards on personal info, login methods, and integrations routes
- Browse/search/filter parity fixes where runtime still keys off `isAuthed` instead of `tier`
- Claim-first Premium acquisition for new users on web, iOS, and Android
- Guest Stripe checkout backed by `premium_claims`
- Guest App Store / Play purchase verification backed by `premium_claims`
- Server-side disablement of public pre-billing email account creation
- Server-side disablement of provider first-create via onboarding intents
- Claim-backed provider account creation for verified Premium claims

## Out Of Scope For This Slice

- Full redesign of Premium onboarding legal capture for guest checkout
- Store sandbox / Stripe sandbox flow redesign
- Admin reporting model changes

## Rollout Shape

1. Add recovery-only gating helpers and use existing entitlements as source of truth.
2. Convert unpaid authenticated account/profile entrypoints into a recovery shell.
3. Block direct unpaid access to non-recovery subroutes.
4. Remove obvious guest-vs-signed-in-`anon` browsing differences on feed/search/filter entrypoints.
5. Switch new-user Premium acquisition to paid-claim-first:
   - web guest checkout creates a claim, completes Stripe, then the user signs in or creates an account from the verified claim
   - mobile guest purchase or restore verifies into a claim, then the user signs in or creates an account from the verified claim
6. Disable the runtime onboarding-intent create path so no public route can mint an unpaid account before purchase verification.
7. Reintroduce provider first-create only for verified claims:
   - claim-backed Google create on web and mobile
   - claim-backed native Apple create on iOS
   - claim-backed controlled Apple web sign-in/create where configured

## Runtime Design For This Slice

- Existing-account upgrades stay account-first:
  - sign in
  - legal acceptance if required
  - checkout or native billing sync
- New-account Premium acquisition becomes claim-first:
  - start guest checkout or native guest purchase
  - verify purchase into `premium_claims`
  - sign in to attach, or create an account from the verified claim
- `premium_onboarding_intents` remain only for authenticated legal-acceptance flow management on existing-account upgrades.
- `premium_onboarding_allow_creates` is reused only as a short-lived database gate for verified-claim provider create.
- Web and mobile sign-in screens remain available for existing accounts and claim attachment, but not for first-time unpaid account creation.
- Provider first-create stays blocked on public entrypoints without a verified claim.

## Rollback Notes

- Web rollback point: restore authenticated-only `/api/billing/checkout` and restore guest premium-auth CTA wiring.
- Mobile rollback point: restore viewer-bound native billing sync requirement and pre-billing sign-up path.
- Backend rollback point: revert the Supabase `before_user_created` function change and restore the claim-blind provider-create block.

## Verification

- Web unpaid authenticated user lands in recovery shell on `/account`
- Web unpaid authenticated user cannot use `/account/saved`, `/account/integrations`, or `/account/login-methods`
- Mobile unpaid authenticated user lands in recovery shell on `/profile`
- Mobile unpaid authenticated user cannot use `/account/personal`, `/account/login-methods`, or `/account/integrations`
- Guest and signed-in-`anon` users both keep browse/search/filter access on feed surfaces
- Web guest can start Premium without creating an account first, receives a verified claim after checkout, and can only create an account from that verified claim
- Mobile guest can start or restore Premium without creating an account first, receives a verified claim after store verification, and can only create an account from that verified claim
- `/api/v1/premium-onboarding/email-account` no longer mints public unpaid accounts
- Provider first-login cannot create a new account from the public sign-in pages without a verified claim
- Verified claim flows can create or attach via Google and Apple provider auth where the platform supports controlled preflight before user creation
