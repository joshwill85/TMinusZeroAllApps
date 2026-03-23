## Anon and Premium Cutover Plan

Date: 2026-03-20

Platform matrix
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing: yes

Target state
- Product access collapses to `anon` and `premium`.
- Signing in without Premium keeps account ownership, recovery, billing, and restore access, but product capabilities match `anon`.
- New self-serve free account creation is removed on web and native.
- New Premium customers purchase or restore first, then either attach the purchase to an existing account or create an account from the verified claim flow.

Implementation slices
1. Realign shared entitlement resolution so non-premium resolves to `anon`, anon browsing includes filters plus calendar browsing/one-off export, and non-premium refresh cadence matches anon.
2. Add additive premium-claim contracts, storage, routes, and claim-link helpers for guest web Stripe checkout plus guest native App Store / Google Play verification.
3. Remove public free sign-up and public OAuth entry points, but keep sign-in and password reset for existing accounts.
4. Update web upgrade/auth/account surfaces to route guests into Premium checkout first and preserve read-only saved/integration inventory for signed-in non-premium accounts.
5. Update native billing/auth/profile flows so guest purchase and restore work before account creation, then route users into sign-in or claim-based account creation.
6. Keep premium token delivery protected: stored feeds/widgets remain visible in account UIs, but token serving and premium notification delivery continue to require paid access.

Rollout / rollback notes
- `premium_claims` is additive; no existing billing or auth rows are deleted.
- Existing accounts remain valid for sign-in, password reset, export, delete, billing, and restore.
- The compatibility window keeps `tier: 'free'` in shared contracts, but the server stops emitting `free` in the cutover release.
- If claim-linking regresses, web and native can fall back to existing signed-in premium checkout/restore while keeping sign-up disabled.

Verification set
- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Open follow-ups
- Admin/support reporting still needs the final cleanup from `free/paid/admin` status labels to account-state plus product-tier labels.
- Marketing/editorial docs and FAQ copy that mention “free tier” should be cleaned in a follow-up content sweep after the product paths are stable.
