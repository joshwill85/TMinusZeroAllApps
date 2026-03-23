# App Store Connect Privacy Worksheet

Last updated: 2026-03-19

This is a repo-derived draft for the iOS app submission flow. It is not a substitute for the final App Store Connect questionnaire, but it captures the current mobile data flows that need to be reflected there.

## Scope

- Surface: `apps/mobile`
- Platform: `iOS`
- Derived from shipped code paths as of 2026-03-19
- Tracking: `No current evidence of third-party tracking for ad targeting or cross-app tracking`

## Current Mobile Data Flows To Reflect

### Contact Info

- `Email address`
  - Used for account sign-in, account recovery, verification, billing state association, and support.
  - Linked to user: `yes`
  - Used for tracking: `no`
- `Name`
  - Used for profile/account display when provided.
  - Linked to user: `yes`
  - Used for tracking: `no`

### Identifiers

- `User ID / account identifier`
  - Used for account/session resolution and entitlement lookup.
  - Linked to user: `yes`
  - Used for tracking: `no`
- `Push token / installation ID`
  - Used for device registration and push delivery.
  - Linked to user: `yes` when signed in
  - Used for tracking: `no`

### Purchases

- `Subscription status`
- `Provider transaction / subscription identifiers`
  - Used for premium entitlement sync and restore.
  - Linked to user: `yes`
  - Used for tracking: `no`

### User Content / Account Data

- `Watchlists`
- `Filter presets`
- `Alert rules`
- `Per-launch notification preferences`
  - Used for core account functionality.
  - Linked to user: `yes`
  - Used for tracking: `no`

### Usage Data

- `Product interaction`
  - Includes account feature usage tied to authenticated flows.
  - Linked to user: `yes` in authenticated flows
  - Used for tracking: `no`
- `AR session summary telemetry`
  - Includes permission state, runtime mode, duration, and quality buckets for premium AR sessions.
  - Linked to user: `yes`
  - Used for tracking: `no`

### Security / Fraud Prevention Data

- `Auth risk session metadata`
- `Auth attestation placeholder metadata`
- `Sign-in event metadata`
  - Used to protect account sign-in and investigate abuse.
  - Linked to user: `yes`
  - Used for tracking: `no`

## Data Explicitly Not Stored As First-Party Mobile Account Data

- Payment card numbers
- Precise device location for AR alignment
- Camera video or microphone audio
- Raw Apple or Google payment credentials

## Submission Notes To Keep Consistent

- Mobile now supports in-app account deletion from Profile.
- iOS Sign in with Apple stays hidden unless `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED` is explicitly enabled and real setup exists.
- Mobile does not expose Tip Jar or web billing CTAs.
- Existing App Store / Google Play subscribers are managed through the store, not through Stripe web links in the app.

## Final App Store Connect Check Before Submission

- Confirm every item above is reflected in Privacy Nutrition Labels.
- Confirm no additional SDK-collected data appears in App Store Connect beyond this worksheet.
- Re-check after any change to auth providers, push registration payloads, billing sync payloads, or AR telemetry fields.
