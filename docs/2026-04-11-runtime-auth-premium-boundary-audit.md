# Runtime Auth And Premium Boundary Audit

Date: 2026-04-11

## Scope

- Web: included
- iOS: included
- Android: included
- Admin/internal runtime surfaces: included
- Shared API/backend: included
- Scope mode: runtime only

## Audit Policy

- Customer membership must behave as `anon | premium`
- No user-creatable account path is allowed unless it is inside a paid-backed claim/restore flow or an explicitly accepted Premium onboarding path
- Expired former-premium users must be treated as `anon` for product behavior
- Expired former-premium signed-in access is allowed only for a narrow recovery shell:
  - re-subscribe / restore purchase
  - billing retry / management
  - support
  - privacy / data export
  - account deletion

## Scoring Note

The current codebase already labels some pre-billing account creation as "Premium onboarding." The stricter interpretation used in this report is the one requested in-thread: if a guest can persist a normal user record and stop before payment succeeds, that is still a practical `anon` account creation path and is scored as a finding because it explains the observed `anon` users.

## Executive Summary

- The backend entitlement contract is already binary. `apps/web/lib/server/entitlements.ts:372-391` resolves authenticated unpaid users to `tier: 'anon'`, and `packages/domain/src/viewer.ts:37-46` keeps the core tier model at `anon | premium`.
- Generic public email signup is not available through Supabase email auth. `supabase/config.toml:218-220` disables email signup, and `apps/web/lib/server/mobileAuth.ts:624-628` hard-blocks the legacy mobile password sign-up route.
- Google first-time provider creation is explicitly preflighted and hook-gated. `apps/web/lib/server/googleAuth.ts:276-299` checks Premium onboarding state before `signInWithIdToken`, and `supabase/migrations/20260410231500_premium_onboarding_and_legal_acceptance.sql:92-159` blocks unapproved first-time user creation for email, Google, and Apple.
- Two P0 issues remain:
  - guest-reachable Premium onboarding can still mint persisted unpaid users before billing on web and mobile
  - expired or otherwise unpaid authenticated users still get broad signed-in account/product shells instead of a recovery-only shell
- The most likely current sources of `anon` users are:
  - abandoned Premium onboarding account-creation flows on web and mobile
  - expired or canceled premium users that downgrade to `anon` but keep a valid auth session and normal signed-in navigation
  - older legacy unpaid accounts that can still sign in

## Core Conclusions

- Yes: when a subscription is no longer active, the entitlement layer already downgrades the customer to `anon`.
- No: runtime behavior is not yet "anon or premium only" because the UI/router layer still treats `isAuthed` as a third state and exposes normal signed-in shells to unpaid users.
- No: the repo does not yet prevent all practical unpaid account creation, because guest-started Premium onboarding can create a real account record before payment completes.

## Master Findings Table

| Severity | Surface | Route or endpoint | Path category | Current behavior | Expected behavior | Exploitability | Evidence | Recommended fix direction |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P0 | Web + iOS + Android + shared backend | `/auth/sign-up?intent=upgrade`, `/sign-up?intent=upgrade`, `POST /api/v1/premium-onboarding/intent`, `POST /api/v1/premium-onboarding/email-account` | Premium-onboarding account create | A guest-created onboarding intent is enough to create a real user account and sign in before billing succeeds. If the user abandons legal or checkout, the account remains authenticated but unpaid. | If the product rule is truly `anon | premium`, a guest must not persist a normal user record before verified payment/restore or a non-forgeable server-owned upgrade ticket. | High: direct URL plus public API calls | `apps/web/components/SignUpPanel.tsx:86-112`; `apps/web/components/AuthForm.tsx:104-119,177-201`; `apps/web/app/api/v1/premium-onboarding/intent/route.ts:8-17`; `apps/web/lib/server/premiumOnboarding.ts:293-319,374-430`; `apps/mobile/app/sign-up.tsx:58-123,155-187`; `apps/mobile/src/auth/supabaseAuth.ts:1012-1035` | Replace guest-created onboarding intents with a server-signed upgrade ticket issued only from a real Premium start action, or defer account creation until checkout/restore is confirmed. If account-first must remain, keep these users in an onboarding-only quarantine state rather than a normal authenticated shell. |
| P0 | Web | `/account` | Expired-account recovery shell | Any authenticated unpaid user gets the full account shell, including account summary, personal-info editing, email verification resend, marketing settings, and other normal signed-in sections. | Expired/unpaid users should be routed into a narrow recovery shell only. Normal signed-in account management must not be available. | High: any legacy unpaid or expired user can reproduce by signing in | `apps/web/app/account/page.tsx:192-330` | Add an entitlement-based recovery guard at the page layout level. Split recovery-safe modules from normal account-management modules and hard-redirect unpaid users to the recovery shell. |
| P0 | iOS + Android | `/profile`, `/account/personal`, `/account/login-methods` | Expired-account recovery shell | Mobile shows a broad signed-in account hub and lets unpaid authenticated users open personal-info editing and login-method management. | Expired/unpaid signed-in mobile users should only reach membership recovery, support, privacy/data, and deletion surfaces. | High: any expired or legacy unpaid signed-in user can reproduce | `apps/mobile/app/(tabs)/profile.tsx:77-205`; `apps/mobile/src/features/account/AccountPersonalScreen.tsx:152-230`; `apps/mobile/src/features/account/LoginMethodsScreen.tsx:183-260` | Add a mobile recovery-shell guard keyed on entitlements, not `accessToken` or `viewerId`. Hide or block personal info and login-method pages for unpaid users. |
| P0 | Web + iOS + Android | `/account/saved`, `/account/integrations`, mobile `/account/integrations` | Normal product/account surfaces outside recovery shell | Unpaid authenticated users can still navigate into premium-only account/product shells and get upsell panels instead of being constrained to a recovery shell. | Unpaid users should not reach these destinations at all; only recovery-safe destinations should remain reachable. | Medium to high: trivial once signed in | `apps/web/app/account/saved/page.tsx:323-345`; `apps/web/app/account/integrations/page.tsx:272-280`; `apps/mobile/app/account/integrations.tsx:343-379` | Move billing upsells for unpaid authenticated users into the dedicated recovery shell. Hard-redirect or hide saved/integrations routes for unpaid users. |
| P2 | Web + iOS + Android | Feed/search/filter entrypoints | Third-state capability/navigation leakage | Guests and signed-in unpaid users do not have the same browse/search/filter affordances. Mobile feed swaps search for "Sign in" when guest. Web feed loads dynamic filter options only for authenticated users and swaps mobile search entry to sign-in. | Guest and signed-in `anon` behavior should be identical outside the recovery shell. Browsing, search, filters, and calendar affordances should not depend on auth. | Medium: visible in normal browsing without special setup | `apps/mobile/app/(tabs)/feed.tsx:1868-1887`; `apps/web/components/LaunchFeed.tsx:330-357`; `apps/web/components/LaunchFeed.tsx:2197-2213`; `apps/web/components/WatchlistFollows.tsx:76-77` | Remove `isAuthed` as a browse-tier proxy. Drive search/filter/follow affordances from `tier` and shared guest capabilities instead. |
| P2 | Web + iOS + Android | Account/profile copy and badges | Runtime terminology leakage | Runtime UI still labels a third state with combinations such as `Signed in`, `Account`, `Public`, and copy like "This account currently uses public access." | If only `anon | premium` should exist, copy and badges must stop implying a separate signed-in-free tier except inside an approved recovery shell. | Low: copy-only, but it reinforces the wrong model | `apps/mobile/src/features/account/ProfileScreenUi.tsx:17-55,81-105`; `apps/mobile/app/(tabs)/profile.tsx:77-105`; `apps/mobile/app/account/integrations.tsx:345-353`; `apps/web/app/account/page.tsx:192-245` | Standardize customer-facing language around `Free` / `Premium` plus an explicit recovery-shell label where needed. Remove `Signed in` as a membership proxy. |

## Compliant Paths

- Supabase email signup is disabled, while provider creation remains hook-gated:
  - `supabase/config.toml:184-220,263-266`
  - `supabase/migrations/20260410231500_premium_onboarding_and_legal_acceptance.sql:92-159`
- Legacy mobile password sign-up is blocked at the API layer:
  - `apps/web/lib/server/mobileAuth.ts:624-628`
- Verified claim-backed account creation remains paid-backed:
  - `apps/web/app/api/v1/billing/claims/sign-up/route.ts:7-21`
  - `apps/web/lib/server/premiumClaims.ts:494-540`
- Claim attach requires an authenticated session:
  - `apps/web/app/api/v1/billing/claims/[claimToken]/attach/route.ts:8-15`
- Google web provider creation is explicitly preflighted before Supabase sign-in:
  - `apps/web/lib/server/googleAuth.ts:276-299`
- Web Stripe checkout is authenticated and legal-gated:
  - `apps/web/app/api/billing/checkout/route.ts:23-35`
- Mobile native billing requires a `viewerId` both for purchase start and restore/sync:
  - `apps/mobile/src/billing/useNativeBilling.ts:127-160`
  - `apps/mobile/src/billing/useNativeBilling.ts:179-229`
- Premium-only APIs generally reject unpaid authenticated users correctly:
  - `apps/web/app/api/me/calendar-feeds/route.ts:35-38,62-65`
  - `apps/web/app/api/me/rss-feeds/route.ts:34-37,61-64`
  - `apps/web/app/api/live/launches/route.ts:33-39`
  - `apps/web/lib/server/v1/mobileApi.ts:3018-3044`
- Runtime `admin.auth.admin.createUser(...)` usage is confined to two intended server-owned paths:
  - Premium onboarding email account create: `apps/web/lib/server/premiumOnboarding.ts:374-430`
  - Verified claim-backed create: `apps/web/lib/server/premiumClaims.ts:494-540`

## Runtime-Dependent Paths Still Needing Sandbox Validation

- Web Apple first-time account creation from the generic sign-in page:
  - The start path still uses direct `supabase.auth.signInWithOAuth({ provider: 'apple' })` instead of the explicit Google-style preflight wrapper.
  - Static proof suggests the `before_user_created` hook should still fail closed for unauthorized first-time create, but an Apple sandbox run is still needed to verify the real callback UX and confirm there is no unexpected fallback behavior.
  - Evidence: `apps/web/components/AuthForm.tsx:320-330`; `supabase/migrations/20260410231500_premium_onboarding_and_legal_acceptance.sql:92-159`
- Native App Store / Google Play purchase and restore loops:
  - Static proof is good: purchase and restore require `viewerId`, and billing sync passes the viewer-bound token/id.
  - A real store sandbox run is still needed to confirm final navigation and to verify there is no accidental claim/recovery escape hatch after store callbacks.
  - Evidence: `apps/mobile/src/billing/useNativeBilling.ts:127-160,179-255`

## Path Inventory

| Surface | Path | Category | Status | Notes |
| --- | --- | --- | --- | --- |
| Web | `/auth/sign-in` | Existing-account sign-in | Compliant | Existing-account email sign-in remains available. Upgrade intent can append a Premium handoff. `apps/web/app/auth/sign-in/page.tsx:29-41` |
| Web | `/auth/sign-up` without claim or upgrade intent | Invalid legacy public signup | Compliant | Standalone public signup is blocked in the UI. `apps/web/components/SignUpPanel.tsx:92-104` |
| Web | `/auth/sign-up?intent=upgrade` | Premium-onboarding account create | Finding P0 | Guest can reach it directly, bootstrap an onboarding intent, and create an unpaid account. |
| Web | `POST /api/v1/premium-onboarding/intent` | Premium-onboarding intent create/resume | Finding P0 | Guest session is accepted; the route does not require an authenticated viewer. `apps/web/app/api/v1/premium-onboarding/intent/route.ts:8-17` |
| Web | `POST /api/v1/premium-onboarding/email-account` | Premium-onboarding email account create | Finding P0 | Valid intent is enough to create and sign in a normal user before payment. `apps/web/app/api/v1/premium-onboarding/email-account/route.ts:7-14` |
| Web | `/api/auth/google/start` + `/api/auth/google/callback` | Provider first-login/create | Compliant | Google create is preflighted and hook-gated. `apps/web/lib/server/googleAuth.ts:276-299` |
| Web | Apple OAuth from `/auth/sign-in` | Provider first-login/create | Runtime-dependent | Relies on hook fail-close, but lacks Google-style explicit preflight/start flow. `apps/web/components/AuthForm.tsx:320-330` |
| Web | `POST /api/v1/billing/claims/sign-up` | Claim-backed account create | Compliant | Uses verified claim before create. `apps/web/app/api/v1/billing/claims/sign-up/route.ts:7-21` |
| Web | `POST /api/v1/billing/claims/[claimToken]/attach` | Claim attach | Compliant | Requires authenticated session and verified claim state. `apps/web/app/api/v1/billing/claims/[claimToken]/attach/route.ts:8-15` |
| Web | `POST /api/billing/checkout` | Checkout start | Compliant | Requires auth plus legal acceptance. `apps/web/app/api/billing/checkout/route.ts:23-35` |
| Web | `/account` | Expired-account recovery shell | Finding P0 | Broad signed-in shell for unpaid users. |
| Web | `/account/saved` | Normal product/account surface | Finding P0 | Unpaid users can reach saved-item shell and upsells. |
| Web | `/account/integrations` | Normal product/account surface | Finding P0 | Unpaid users can reach integrations shell and upsells. |
| Web | `/account/login-methods` | Expired-account recovery shell | Finding P0 | Unpaid users can manage provider identities. |
| Web | `/legal/privacy-choices` | Recovery-safe path | Compliant | Export/delete/privacy preferences are appropriately separated. |
| Mobile | `/sign-in` | Existing-account sign-in | Compliant | Existing-account email/Google/Apple sign-in remains available. `apps/mobile/app/sign-in.tsx:125-255` |
| Mobile | `/sign-up` without claim or upgrade intent | Invalid legacy public signup | Compliant | UI blocks generic create and points back to Premium or existing-account sign-in. `apps/mobile/app/sign-up.tsx:162-177` |
| Mobile | `/sign-up?intent=upgrade` | Premium-onboarding account create | Finding P0 | Guest can directly create an onboarding intent and mint an unpaid account. |
| Mobile | Premium onboarding intent create via guest client | Premium-onboarding intent create/resume | Finding P0 | Guest client can call the intent route directly. `apps/mobile/src/auth/supabaseAuth.ts:1012-1027` |
| Mobile | Apple / Google sign-in with upgrade intent | Provider first-login/create | Tied to P0 | Provider create is gated by onboarding intent, but the onboarding intent itself is guest-creatable. `apps/mobile/app/sign-in.tsx:77-101,167-255`; `apps/mobile/src/auth/supabaseAuth.ts:623-639` |
| Mobile | `POST /api/v1/mobile-auth/sign-up` | Invalid legacy public signup | Compliant | Hard-blocked. `apps/web/lib/server/mobileAuth.ts:624-628` |
| Mobile | Native purchase start / restore / sync | Checkout start / restore | Compliant + runtime-dependent | Viewer-bound tokens are required; sandbox run still needed for full E2E validation. `apps/mobile/src/billing/useNativeBilling.ts:127-160,179-255` |
| Mobile | `/profile` | Expired-account recovery shell | Finding P0 | Broad signed-in account shell remains reachable to unpaid users. |
| Mobile | `/account/personal` | Expired-account recovery shell | Finding P0 | Unpaid users can edit profile and marketing preferences. |
| Mobile | `/account/login-methods` | Expired-account recovery shell | Finding P0 | Unpaid users can link/unlink login methods. |
| Mobile | `/account/integrations` | Normal product/account surface | Finding P0 | Unpaid users can still browse a premium-only integrations shell. |
| Mobile | `/account/membership` | Recovery-safe path | Compliant | Membership and restore actions are the correct allowed shell. |
| Mobile | `/legal/privacy-choices` | Recovery-safe path | Compliant | Export/delete/privacy flows are correctly separated. |

## Observed Runtime Sources Of `anon` Users

These are the most likely runtime mechanisms producing current `anon` users:

1. Guest-started Premium onboarding creates a real user before billing completes.
   - Web: `apps/web/components/SignUpPanel.tsx:86-112`, `apps/web/lib/server/premiumOnboarding.ts:374-430`
   - Mobile: `apps/mobile/app/sign-up.tsx:58-123`, `apps/mobile/src/auth/supabaseAuth.ts:1012-1035`
2. Provider-based onboarding create also mints an unpaid user before billing, once allow-create has been granted by the onboarding intent.
   - Google web: `apps/web/lib/server/googleAuth.ts:276-299`
   - Apple mobile: `apps/mobile/src/auth/supabaseAuth.ts:623-639`
3. Expired or canceled premium users already downgrade to `tier: 'anon'`, but they keep a valid auth session and continue to see signed-in shells.
   - `apps/web/lib/server/entitlements.ts:372-391`
   - `apps/web/app/account/page.tsx:217-330`
   - `apps/mobile/app/(tabs)/profile.tsx:152-205`

## Fix Direction Summary

1. Decide whether "inside Premium onboarding" is still allowed to persist a normal user record before payment.
   - If no, the current onboarding email/provider create paths are the primary source of new `anon` users and must be redesigned.
2. Add a single shared `recovery-shell` guard across web and mobile.
   - Gate on entitlements, not on `viewerId` or raw auth state.
   - Allowed unpaid destinations should be membership recovery, support, privacy/data, and deletion only.
3. Remove `isAuthed` as a product-tier proxy.
   - Feed, search, filters, saved, integrations, and follow UI should use `tier` plus shared `anon` capabilities.
4. Normalize runtime copy.
   - Customer-facing membership language should resolve to `Free` or `Premium`, with a separate recovery-shell context where needed.

## Bottom Line

- The repo is not currently operating as a clean `anon | premium` runtime system.
- The tier contract is already binary.
- The remaining problems are:
  - unpaid account creation still happens through guest-reachable Premium onboarding
  - unpaid authenticated users still get a broad signed-in shell after downgrade or legacy sign-in
