# Phase 5 Billing Setup

Last updated: 2026-03-08

This doc tracks the non-repo provisioning needed to finish Phase 5 billing acceptance. Repo code now supports Stripe, App Store, and Google Play behind provider-neutral entitlements, but these console-side steps must exist before the acceptance gates can be checked.

## Scope

- Product: `premium_monthly`
- Web provider: Stripe
- iOS provider: App Store
- Android provider: Google Play
- Shared source of truth: `purchase_entitlements` and `purchase_events`

## Repo Readiness Check

Run this before store testing:

```bash
npm run check:billing-readiness
```

It validates:

- Stripe env/config
- Apple App Store env/config
- Google Play env/config
- committed Apple root cert assets
- optional Supabase reachability for provider-neutral billing tables

## Required Environment Variables

### Stripe

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_PRO_MONTHLY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### Apple App Store

- `APPLE_APP_STORE_ISSUER_ID`
- `APPLE_APP_STORE_KEY_ID`
- `APPLE_APP_STORE_PRIVATE_KEY`
- `APPLE_APP_STORE_BUNDLE_ID`
- `APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID`
- `APPLE_APP_STORE_APP_ID`

### Google Play

- `GOOGLE_PLAY_PACKAGE_NAME`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`
- `GOOGLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID`
- `GOOGLE_IAP_PREMIUM_MONTHLY_BASE_PLAN_ID`
- `GOOGLE_IAP_PREMIUM_MONTHLY_OFFER_TOKEN`
- `GOOGLE_PLAY_RTDN_PUSH_AUDIENCE`
- `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL`

### Shared / backend

- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Apple App Store Connect Setup

1. Confirm the app record and bundle id match `APPLE_APP_STORE_BUNDLE_ID`.
2. Create the `premium_monthly` auto-renewable subscription product and confirm the product id matches `APPLE_IAP_PREMIUM_MONTHLY_PRODUCT_ID`.
3. Create or confirm the App Store Server API key.
4. Store the issuer id, key id, and private key in env.
5. Capture the numeric app id and set `APPLE_APP_STORE_APP_ID`.
6. Add sandbox testers for the billing acceptance runbook.
7. Configure App Store Server Notifications V2 to point at:

```text
https://<site>/api/webhooks/apple-app-store
```

8. Verify the notification environment matches the intended test environment.

## Google Play Console Setup

1. Confirm the app package name matches `GOOGLE_PLAY_PACKAGE_NAME`.
2. Create or confirm the `premium_monthly` subscription.
3. Confirm the base plan id matches `GOOGLE_IAP_PREMIUM_MONTHLY_BASE_PLAN_ID`.
4. If using an offer, confirm the offer token matches `GOOGLE_IAP_PREMIUM_MONTHLY_OFFER_TOKEN`.
5. Create or confirm the Google service account with Android Publisher access.
6. Store the service account email and private key in env.
7. Add tester accounts for license testing.
8. Create a Pub/Sub topic and subscription for RTDN.
9. Configure authenticated push delivery to:

```text
https://<site>/api/webhooks/google-play
```

10. Set the push audience to the same value used by `GOOGLE_PLAY_RTDN_PUSH_AUDIENCE`.
11. Set `GOOGLE_PLAY_RTDN_PUSH_SERVICE_ACCOUNT_EMAIL` to the service account that signs the Pub/Sub push OIDC token.

## Webhook Expectations

- Stripe:
  - existing `/api/webhooks/stripe`
  - `npm run check:stripe-webhook`
- Apple:
  - `/api/webhooks/apple-app-store`
  - verified JWS notifications via Apple root certs in `apps/web/lib/server/apple-pki`
- Google:
  - `/api/webhooks/google-play`
  - authenticated Pub/Sub push verification plus Play Developer API lookup

## Admin Visibility

Use `/admin/billing` after provisioning to inspect:

- provider-neutral entitlements by provider
- Stripe continuity metrics
- per-provider webhook health
- recent purchase events
- recent webhook failures

## Before Moving the Tracker

Do not check the remaining Phase 5 acceptance gates until all of the below exist:

- store products and testers are provisioned
- webhooks are delivering to the deployed environment
- `/admin/billing` shows no unexplained provider errors
- the acceptance runbook in `docs/three-platform-phase5-billing-acceptance.md` has real evidence attached
