# Three-Platform Billing, Discounts, and Admin Exposure Plan

Date: 2026-04-01

## Platform Matrix
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Request type: customer-facing premium entitlements plus admin/internal support tooling

## Scope
- Keep premium entitlement sharing account-based across web, iOS, and Android.
- Make provider-neutral entitlement state the admin source of truth.
- Add a canonical internal discount campaign model that can project provider-specific offers into billing catalogs.
- Keep Stripe artifact creation inside TMZ admin in phase 1.
- Keep Apple and Google discount artifacts import/attach-only in phase 1.

## Planned Changes
### Backend and Schema
- Add `discount_campaigns`, `discount_campaign_targets`, and `discount_campaign_provider_artifacts`.
- Keep the existing `purchase_entitlements`, `purchase_provider_customers`, and `premium_claims` flow unchanged for purchase verification and cross-platform premium sharing.
- Add a shared server helper that:
  - loads campaign/admin snapshots
  - filters campaigns by platform and viewer eligibility
  - projects active provider artifacts into billing catalog offers

### Shared Contracts and APIs
- Extend the billing catalog contract additively with `offers[]` on each product.
- Keep existing top-level fields such as `providerProductId`, `stripePriceId`, `googleBasePlanId`, and `googleOfferToken` for compatibility.
- Keep `/api/v1/billing/catalog` public and global-only.
- Make `/api/v1/me/billing/catalog` account-aware so user-targeted campaigns can be projected there.

### Admin
- Keep `/admin/coupons` as the single discounts surface.
- Add a new admin route for campaign CRUD and provider artifact import/attach.
- Update `/admin/users` to expose provider-neutral billing state instead of relying only on legacy Stripe subscriptions.
- Expand `/admin/billing` with claim/recovery and discount campaign health summaries.

### Native and Web Consumption
- Web continues to use Stripe billing with optional projected Stripe promotion code metadata.
- Android reads projected Google offer tokens and prefers them over the legacy single-offer env fallback.
- iOS receives imported App Store offer metadata in the catalog. Phase 1 does not add direct provider-side offer execution beyond current native purchase flows.

## Rollout Order
1. Schema and shared helper.
2. Admin campaign API and discounts UI.
3. Provider-neutral admin paid-state and billing visibility updates.
4. Additive billing catalog contract and server projection.
5. Mobile billing consumption update for projected Google offer selection.
6. Validation under the pinned Node/npm toolchain.

## Rollback Notes
- The migration is additive; existing purchase and entitlement flows remain intact.
- Catalog changes are additive and preserve existing top-level fields.
- If campaign projection has issues, the system can fall back to the current base product catalog with no offers by disabling campaign data or leaving campaigns/artifacts inactive.

## Verification Set
- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Unresolved Items
- iOS promotional-offer execution remains intentionally conservative in phase 1; imported metadata is exposed now, but provider-side execution can be expanded later if the installed `expo-iap` surface is confirmed and tested.
- Apple/Google artifact creation stays in App Store Connect and Play Console for now; TMZ admin is the canonical tracker, not the write surface.
