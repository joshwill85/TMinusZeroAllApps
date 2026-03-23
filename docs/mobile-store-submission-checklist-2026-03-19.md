# Mobile Store Submission Checklist

Date: 2026-03-19

## Platform Matrix

- Web: dependency surface only for legal pages, support URLs, and shared `/api/v1` behavior
- iOS: included
- Android: included where the same mobile policy hardening applies
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Repo-Backed Readiness

- [x] Mobile Tip Jar entry removed from the native app shell.
- [x] Mobile Stripe web-billing CTA removed; web-billed subscriptions are read-only on mobile.
- [x] Native mobile delete-account flow added to the Profile surface with typed `DELETE` confirmation.
- [x] Delete flow warns store subscribers to cancel in the App Store / Google Play if they do not want renewal to continue.
- [x] Sign in with Apple is hidden by default behind `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED`.
- [x] Privacy notice updated to describe current mobile billing, push, telemetry, and auth-risk behavior.

## Submission Tasks Still Required Outside The Repo

### App Store Connect

- [ ] Confirm the iOS build metadata, age rating, screenshots, and feature descriptions match the shipped app.
- [ ] Set the support URL to a live customer-facing support surface.
- [ ] Keep the privacy policy URL pointed at `/legal/privacy`.
- [ ] Add App Review notes that explain:
  - where the native delete-account flow lives (`Profile` -> `Delete account`)
  - how to test Premium purchase / restore
  - any hardware or account prerequisites for features under review
- [ ] Provide demo credentials if review cannot complete with guest mode alone.

### Privacy Answers / Nutrition Labels

- [ ] Re-answer App Store Connect privacy questions from the shipped mobile build, not from older web-only assumptions.
- [ ] Confirm whether the iOS build declares collection of:
  - contact info (email, phone if SMS is enabled)
  - identifiers (account id, installation id, push token)
  - purchases (subscription status and transaction identifiers)
  - diagnostics / product interaction data
- [ ] Confirm data-linked vs not-linked answers against the current backend data model and retention rules.

### Billing / Commerce

- [ ] Verify the iOS build exposes only App Store billing actions for mobile-managed subscriptions.
- [ ] Verify the Android build exposes only Google Play billing actions for mobile-managed subscriptions.
- [ ] Verify no customer-facing mobile surface still links to Tip Jar or Stripe billing on web.
- [ ] Confirm store management URLs behave correctly on physical devices.

### Account Deletion

- [ ] Test deletion on physical iOS and Android devices.
- [ ] Verify deletion succeeds for:
  - a free account
  - a web-billed account with Stripe cancel-at-period-end
  - an App Store billed account after user review of the store warning
  - a Google Play billed account after user review of the store warning
- [ ] Verify the device is signed out and push registration is removed after deletion.

### Sign in With Apple

- [ ] Leave `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED` unset or `false` until all of the below are complete:
  - App Store Connect Sign in with Apple setup
  - Supabase/provider credentials configured for production
  - server-side storage for Apple revocation material
  - deletion-time Apple revocation attempt implemented and tested
  - revoked-credential handling implemented and tested

## Store Review Notes Template

Use this as the starting point for iOS review notes:

```text
Account deletion is available in-app at Profile > Delete account. The flow requires typing DELETE before the final confirmation.

Premium purchases and restore flows are native. App Store subscribers can manage billing through Apple from the Profile billing section. The app does not expose external web billing or Tip Jar flows.

If review needs a test account, use: <demo email / password>.
```
