# Phase 5 Billing Acceptance

Last updated: 2026-03-09

This runbook is the required evidence path for closing the remaining Phase 5 billing acceptance and rollback gates in `docs/three-platform-overhaul-plan.md`.

## Blocking Goal

Prove all of the following with real store/tester environments:

- entitlements reconcile correctly across Stripe, Apple, and Google
- web billing flows still work during and after migration
- provider-specific failures do not corrupt shared entitlement state

## Preconditions

- Repo-only continuity and failure-safety automation is green:
  - `npm run test:billing-regression`
  - `npm run acceptance:preflight -- --out-dir=.artifacts/three-platform-acceptance`
- `npm run check:billing-readiness` passes for the target environment
- `/admin/billing` loads and shows configured Apple/Google notification status
- a physical iOS device is signed into an App Store sandbox tester
- a physical Android device is signed into a Play tester account
- preview/development builds are installed on those devices

## Evidence To Capture

- screenshots or recordings of each purchase/restore/manage flow
- `/admin/billing` before and after each provider scenario
- webhook delivery proof for Stripe, Apple, and Google
- resulting `purchase_entitlements`, `purchase_events`, and `webhook_events` rows or equivalent admin screenshots
- mobile and web entitlement state after each scenario

## Stripe Continuity

1. Sign in on web with a free account.
2. Open the billing surface and confirm the user shows `provider=none`.
3. Start Stripe checkout from web.
4. Complete checkout and confirm:
   - web Premium access is active
   - `/api/v1/me/billing/summary` shows `provider=stripe`
   - `/api/v1/viewer/entitlements` shows paid access
   - `/admin/billing` shows Stripe purchase events and healthy webhook processing
5. Cancel renewal from web.
6. Confirm:
   - billing summary shows `cancelAtPeriodEnd=true`
   - entitlements remain active until the current period end
7. Resume if applicable and confirm state returns to active.

## iOS App Store

1. Sign in on a physical iOS device with a TMZ account.
2. Open the mobile billing surface and confirm current premium state before purchase UI launches.
3. Start the native App Store purchase for `premium_monthly`.
4. After purchase, confirm:
   - mobile Premium state updates
   - web billing summary shows `provider=apple_app_store`
   - web billing UI no longer offers Stripe management controls
   - web billing UI links to App Store management
   - `/admin/billing` shows provider-neutral entitlement plus purchase event
5. Relaunch the app and confirm premium state restores without a second purchase.
6. Run restore purchases and confirm no duplicate entitlement corruption occurs.
7. Manage or cancel externally in the App Store.
8. After Apple notification delivery, confirm:
   - entitlement state updates on web and mobile
   - `/admin/billing` shows the corresponding webhook and purchase event

## Android Google Play

1. Sign in on a physical Android device with a TMZ account.
2. Open the mobile billing surface and confirm current premium state before purchase UI launches.
3. Start the native Google Play purchase for `premium_monthly`.
4. After purchase, confirm:
   - mobile Premium state updates
   - web billing summary shows `provider=google_play`
   - web billing UI no longer offers Stripe management controls
   - web billing UI links to Google Play management
   - `/admin/billing` shows provider-neutral entitlement plus purchase event
5. Relaunch the app and confirm owned purchase sync restores premium state.
6. Run restore purchases and confirm no duplicate entitlement corruption occurs.
7. Manage or cancel externally in Google Play.
8. After RTDN delivery, confirm:
   - entitlement state updates on web and mobile
   - `/admin/billing` shows the corresponding webhook and purchase event

## Failure Safety Checks

Run these before closing the rollback gate:

1. Send or replay an invalid Apple notification payload.
   - expected: rejected, no entitlement mutation
2. Send or replay a Google Pub/Sub push with invalid OIDC auth.
   - expected: rejected, no entitlement mutation
3. Replay a previously processed valid provider event.
   - expected: logged as duplicate or ignored, no duplicate entitlement corruption
4. Temporarily disable Apple config and verify Stripe web billing still works.
5. Temporarily disable Google config and verify Stripe web billing still works.

## Repo-Owned Automation

These checks do not replace store-console and physical-device proof, but they should stay green before any manual acceptance run:

- `npm run acceptance:preflight -- --out-dir=.artifacts/three-platform-acceptance`
  - captures the current repo-owned billing regression artifact
  - captures a stable skipped-or-live billing evidence export artifact
  - records the exact pinned-toolchain command sequence used before device/store proof
- `npm run test:billing-regression`
  - verifies shared web billing route adapters still match the current Stripe route shapes
  - verifies shared billing normalization helpers still preserve current web expectations
  - verifies provider failure guards still exist before provider verification or entitlement mutation boundaries
  - verifies webhook replay and failure bookkeeping stays idempotent at the shared helper layer
- `npm run export:billing-evidence -- --skip-when-unavailable`
  - emits a stable JSON artifact even when no target user id or service-role config is present yet
  - becomes the handoff artifact for later live-store/manual proof runs

## Tracker Rules

Only check the Phase 5 acceptance boxes after:

- Stripe continuity flow is proven on the deployed environment
- iOS sandbox flow is proven on a physical device
- Android tester flow is proven on a physical device
- invalid/replayed provider events are shown not to corrupt entitlement state
- evidence is attached in the Progress Log or linked from it
