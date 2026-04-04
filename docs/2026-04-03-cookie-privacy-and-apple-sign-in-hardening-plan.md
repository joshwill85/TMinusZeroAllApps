# Cookie Privacy And Apple Sign In Hardening Plan

Date: 2026-04-03

Status: implementation is now in repo. Remaining work is release verification, Apple portal/App Review readiness, and real-device validation.

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included only where the shared native auth/privacy shell changes
- Admin/internal impact: no
- Shared API/backend impact: yes

## Goals

- Reduce cookie/privacy UX to the minimum that matches current repo behavior.
- Remove privacy controls that are not currently necessary for the shipped product.
- Keep support for the one privacy control that materially changes runtime behavior today: blocking third-party embeds.
- Bring Apple Sign In to a production-ready baseline for new sign-ins and account deletion flows.
- Ensure Apple-authenticated accounts can be revoked during deletion or fail clearly when revocation material is unavailable.

## Cookie / Privacy Slice

### Current repo truth

- No repo evidence of GA, GTM, PostHog, Mixpanel, Amplitude, Facebook Pixel, or ATT/IDFA style tracking.
- The web app uses essential first-party auth/session cookies plus product-state browser storage.
- The only user-facing privacy preference that materially changes runtime behavior today is third-party embed blocking for X, YouTube, and Vimeo.
- Global Privacy Control is detectable, but the current product does not actively sell/share personal data for advertising.
- Supported X, YouTube, and Vimeo embeds now use explicit click-to-load gating by default.

### Implementation target

- No sitewide cookie banner.
- No generic opt-out or sensitive-data toggles on web or mobile.
- Keep a single web privacy preference for third-party embed blocking.
- Keep account export, account deletion, and support entry points on privacy surfaces.
- Keep privacy-policy copy accurate to current behavior.

## Apple Sign In Slice

### Current repo truth

- Web Apple sign-in exists through Supabase OAuth.
- iOS Apple sign-in exists through native `expo-apple-authentication` + Supabase `signInWithIdToken`.
- Native flow now records display name and private-relay metadata in auth context.
- Apple revocation material is captured server-side on sign-in and enforced during account deletion.
- Native Apple credential state is monitored on bootstrap/foreground and revoked credentials clear local session state.
- Both live Apple sign-in paths now fail closed if revocation material cannot be persisted.

### Implementation target

- Capture and persist Apple revocation material on sign-in.
- Prefer refresh-token capture; fall back only where necessary.
- Record private-relay usage in auth context.
- Apply first-available Apple name data to the profile when present.
- Rework account deletion so it:
  - uses current billing state rather than legacy Stripe-only checks
  - revokes Apple Sign In tokens for Apple-authenticated users before deleting the account
  - fails with a clear actionable error if Apple revocation is required but unavailable

## Planned changes

1. Completed: add a service-only Apple auth token store in Supabase for revocation material and audit status.
2. Completed: add shared contracts + API route for Apple auth capture from web and native sign-in flows.
3. Completed: capture native Apple authorization codes on iOS, exchange server-side, and persist revocation material.
4. Completed: capture Apple provider tokens on the web callback when Supabase exposes them, and fail the flow if capture cannot be completed securely.
5. Completed: enrich Apple sign-in flows with private-relay detection and first-name/last-name hydration.
6. Completed: replace legacy Stripe-only deletion logic with a shared deletion helper that checks current billing summary and handles Apple revocation.
7. Completed: simplify privacy choices UI to only what is currently needed.
8. Completed: update the canonical compliance docs and customer-facing privacy/support copy to reflect the shipped behavior.
9. Completed: document the supported Apple/private-relay linking policy in `docs/2026-04-03-apple-sign-in-linking-and-rollout-plan.md`.
10. Completed: add signed-in `Login Methods` management on web and mobile, backed by shared auth-methods payloads and self-serve Apple link/unlink flows.
11. Completed: enable Supabase manual linking in project config and clear stored Apple revocation artifacts on unlink.
12. Remaining: run the live-device and release-environment verification set below.

## Rollout / rollback notes

- Rollout order:
  1. migration + server helper
  2. shared contracts/client
  3. mobile + web capture flows
  4. deletion flow
  5. privacy UI simplification
- Rollback:
  - disable the new Apple capture route and revert deletion helper
  - keep `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED=0` for release builds if verification fails

## Verification set

- Web:
  - privacy choices page only exposes controls that affect current behavior
  - guest embed-block cookie still blocks X/YouTube/Vimeo embeds
  - Apple web callback captures provider token material when available
- iOS:
  - first Apple sign-in succeeds
  - relay email is recorded when applicable
  - first-available name data hydrates profile
  - signed-in account can link Apple
  - unlink is allowed only when another recovery method exists
  - deletion of a fresh Apple-authenticated account revokes and deletes successfully
- Shared/backend:
  - store-billed deletion does not silently ignore active billing
  - Apple-authenticated deletion returns a clear error when revocation material is missing
  - Supabase same-email linking resolves verified non-private-email matches without heuristic account merges
