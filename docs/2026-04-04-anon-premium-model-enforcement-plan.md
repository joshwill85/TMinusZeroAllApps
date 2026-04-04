# 2026-04-04 Anon/Premium Model Enforcement Plan

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Request type: customer-facing plus admin/internal shared-foundation cleanup

## Goal

Eliminate the unsupported customer-facing "signed in but not premium" state from the repo, make `anon | premium` the only customer membership model across web, iOS, and Android, and separate account/auth state from membership state so claim, recovery, restore, and admin flows do not silently reintroduce a third tier.

## Why This Plan Exists

The repo already has a split implementation:

- Shared domain viewer types only define `anon | premium`.
- Server entitlements still emit `effectiveTierSource: 'free'` for authenticated unpaid accounts.
- Web and mobile customer UI still render labels such as `Free`, `Free account`, `Free membership`, `Signed in`, `Signed in without Premium`, and `non-Premium`.
- Several docs, fixtures, and regression scripts still assume a third state exists.
- Some current APIs already hard-gate non-premium access with `402`, so parts of the customer UI are describing a state that the backend no longer consistently supports.

This needs a phased fix because auth/account management, premium claim attach, purchase restore, login-method linking, and admin override flows still depend on authenticated sessions and cannot be broken by a terminology cleanup.

## Target End State

At completion:

1. Customer-facing membership language exposes only two access states:
   - `Anon` or `Public`
   - `Premium`
2. Account/auth state is handled separately from membership state.
3. No customer-facing component, contract, test fixture, acceptance doc, admin label, or FAQ presents `free`, `non-premium`, or `signed in without Premium` as a supported product tier.
4. Shared entitlements, mobile payloads, and web payloads do not require a third customer tier to function.
5. Legacy unpaid authenticated accounts, if they still exist during migration, are treated as a compatibility concern for auth/account operations only, not as a customer membership state.

## Guardrails

- Do not do a destructive auth or billing migration in the first implementation slice.
- Do not silently break premium claim attach, account recovery, account deletion, login-method management, purchase restore, or admin self-service override.
- Do not remove `/api/v1` compatibility in one step if a mobile or web consumer still depends on it.
- Do not widen scope into unrelated billing, push, AR, or design refactors.
- Keep all changes incremental and independently testable.
- Prefer repo-wide consistency over surface-by-surface improvisation.

## Repo-Backed Problem Areas

### Shared source of truth

- `packages/domain/src/viewer.ts`
- `packages/domain/src/viewerExperience.ts`
- `packages/contracts/src/index.ts`
- `apps/web/lib/server/entitlements.ts`
- `apps/web/app/api/me/subscription/route.ts`
- `apps/web/lib/server/billingCore.ts`
- `apps/web/lib/server/v1/mobileApi.ts`

### Web customer surfaces

- `apps/web/components/BillingPanel.tsx`
- `apps/web/app/account/page.tsx`
- `apps/web/app/account/saved/page.tsx`
- `apps/web/app/account/integrations/page.tsx`
- `apps/web/components/LaunchFeed.tsx`
- `apps/web/components/AuthForm.tsx`
- `apps/web/components/SignUpPanel.tsx`
- `apps/web/components/UpgradePageContent.tsx`
- `apps/web/components/SocialReferrerDisclaimer.tsx`
- `apps/web/lib/content/faq/registry.ts`

### Mobile customer surfaces

- `apps/mobile/src/features/account/ProfileScreenUi.tsx`
- `apps/mobile/src/components/ViewerTierCard.tsx`
- `apps/mobile/app/(tabs)/profile.tsx`
- `apps/mobile/app/(tabs)/saved.tsx`
- `apps/mobile/app/(tabs)/preferences.tsx`
- `apps/mobile/app/sign-in.tsx`
- `apps/mobile/app/sign-up.tsx`
- `apps/mobile/app/account/integrations.tsx`
- `apps/mobile/src/components/MobileDockingBay.tsx`

### Admin, docs, and regression assets

- `apps/web/app/admin/users/page.tsx`
- `docs/three-platform-overhaul-plan.md`
- `docs/frontpage-premium-ux-checklist.md`
- `docs/high-io-remediation.md`
- `docs/three-platform-phase5-billing-acceptance.md`
- `docs/PRD.md`
- `docs/premium-phases-implementation-plan.md`
- `scripts/shared-domain-smoke.mts`
- `scripts/gating-alignment-guard.mts`
- `scripts/web-regression-smoke.mts`
- `scripts/web-regression-smoke.ts`
- `scripts/v1-contracts-smoke.mts`
- `scripts/mobile-query-guard.mts`

## Working Rules

### Rule 1: Membership and auth must be separate axes

- Membership answers: `What customer access tier is this viewer in?`
- Auth answers: `Does this viewer currently have an authenticated account/session?`
- Billing answers: `Does this account have an active entitlement or purchase record?`

Only the membership axis is allowed to drive public customer tier labels.

### Rule 2: Customer copy may mention account actions, but not a third plan

Allowed examples:

- `Sign in to manage purchases`
- `Sign in to claim Premium`
- `Premium required`
- `Public browsing`

Disallowed examples:

- `Free membership`
- `Free account`
- `Signed in without Premium`
- `signed-in non-Premium`
- `free users` when the intent is really `anon/public`

### Rule 3: Compatibility-only auth states must not leak into product language

If a legacy unpaid authenticated account must still be supported for a time, it should be treated as:

- an auth/account compatibility state
- not a customer membership tier
- not a badge, plan, status chip, or FAQ category

## Decision Gates

These must be resolved before the riskiest behavior changes land.

### Decision Gate A: Legacy unpaid account behavior

Recommended default:

- Keep legacy unpaid accounts valid for narrow compatibility operations only:
  - sign in
  - password reset
  - account recovery
  - account deletion
  - login-method linking
  - premium claim attach
  - purchase restore
- Do not present them as a supported customer membership state.

Harder follow-on option:

- Disallow normal customer sign-in unless the account is premium or in an approved claim/restore flow.

The recommended default is safer because it avoids breaking real users while still removing the unsupported tier from product semantics.

### Decision Gate B: Read-only saved and integration inventory

Current repo state is mixed:

- Some docs and UI still describe read-only unpaid access to saved/integration inventory.
- Current saved and integration APIs already return `402` for non-premium in multiple places.

Recommended default:

- Treat current API behavior as authoritative.
- Remove read-only customer promises from copy and screens unless there is a deliberate decision to reintroduce compatibility endpoints.

### Decision Gate C: Contract removal timing

Recommended default:

- First remove customer UI dependence on `effectiveTierSource: 'free'`.
- Then update contracts, payload builders, tests, and fixtures.
- Only after repo consumers are migrated should the `free` compatibility value be removed entirely.

## Phases

## Phase 0 - Policy Lock and Inventory Freeze

Goal:

- Lock the anon/premium model in writing before code changes start.

Changes:

1. Approve this plan as the source of truth for the cleanup.
2. Write one explicit customer-state matrix:
   - `Public/Anon`
   - `Premium`
   - compatibility-only authenticated unpaid account handling, if temporarily retained
3. Freeze any new customer-facing copy that introduces `free`, `non-premium`, or `signed in` as a tier.
4. Tag each finding from the audit into one of four buckets:
   - shared source-of-truth
   - customer UI/copy
   - behavioral/API compatibility
   - docs/tests/admin

Acceptance:

- One approved state model exists and implementation is scoped against it.

Rollback:

- None needed; this phase is planning-only.

## Phase 1 - Shared Source-of-Truth Realignment

Goal:

- Remove the third customer tier from shared interpretation logic and prevent it from being reintroduced by helpers.

Changes:

1. Update shared domain helpers so they cannot render a special authed-anon tier card or title.
2. Replace or deprecate `effectiveTierSource: 'free'` in shared contracts and server entitlement builders.
3. Keep `tier` limited to `anon | premium`.
4. If auth/account state still needs to be exposed, keep it separate from membership:
   - session payloads
   - account-only flags
   - claim/restore flow state
5. Audit all server-side payload builders and adapters that currently serialize or derive `free`.

Primary write areas:

- `packages/domain/src/viewerExperience.ts`
- `packages/contracts/src/index.ts`
- `apps/web/lib/server/entitlements.ts`
- `apps/web/lib/server/billingCore.ts`
- `apps/web/lib/server/v1/mobileApi.ts`
- `apps/web/app/api/me/subscription/route.ts`

Acceptance:

- Shared code no longer treats authenticated unpaid access as a first-class customer tier.
- No shared helper can render `Signed in without Premium`.
- Contract and payload builders are internally consistent.

Rollback:

- If needed, keep parsers tolerant of legacy values for one compatibility window while stopping new producers from emitting them.

## Phase 2 - Customer UI and Copy Cleanup

Goal:

- Remove unsupported tier language from customer-facing web and mobile surfaces.

Changes:

1. Replace membership labels:
   - `Free`, `Free account`, `Free membership`, `Signed in`, `Signed in without Premium`
   - with `Public`, `Anon`, `Premium`, or explicit account-action copy
2. Separate account messaging from membership messaging:
   - `Sign in to manage purchases`
   - `Sign in to claim Premium`
   - `Sign in required`
   - not `you are a free member`
3. Remove stale read-only saved/integration wording if the APIs already reject non-premium.
4. Update upsell, sign-in, sign-up, account, feed, preferences, saved, and integrations surfaces to use the same vocabulary.

Primary write areas:

- Web:
  - `apps/web/components/BillingPanel.tsx`
  - `apps/web/app/account/page.tsx`
  - `apps/web/app/account/saved/page.tsx`
  - `apps/web/app/account/integrations/page.tsx`
  - `apps/web/components/LaunchFeed.tsx`
  - `apps/web/components/AuthForm.tsx`
  - `apps/web/components/SignUpPanel.tsx`
  - `apps/web/components/UpgradePageContent.tsx`
  - `apps/web/components/SocialReferrerDisclaimer.tsx`
- Mobile:
  - `apps/mobile/src/features/account/ProfileScreenUi.tsx`
  - `apps/mobile/src/components/ViewerTierCard.tsx`
  - `apps/mobile/app/(tabs)/profile.tsx`
  - `apps/mobile/app/(tabs)/saved.tsx`
  - `apps/mobile/app/(tabs)/preferences.tsx`
  - `apps/mobile/app/sign-in.tsx`
  - `apps/mobile/app/sign-up.tsx`
  - `apps/mobile/app/account/integrations.tsx`
  - `apps/mobile/src/components/MobileDockingBay.tsx`

Acceptance:

- Customer surfaces expose only `Public/Anon` and `Premium` as membership states.
- Account-required messaging remains clear.
- No customer-facing screen implies an unsupported third plan.

Rollback:

- Copy-only changes are low-risk and can be reverted by surface if needed.

## Phase 3 - Behavioral Alignment and Route Gating

Goal:

- Make actual route behavior match the final customer model.

Changes:

1. Inventory all auth-only customer routes and classify them:
   - public
   - account-only compatibility
   - premium-only
   - admin-only
2. Remove UI paths that assume unpaid authenticated users can access saved or integrations if APIs already forbid it.
3. Decide whether any compatibility-only authenticated unpaid flows remain visible at all on customer surfaces.
4. If compatibility-only flows remain, make them explicit and narrow:
   - claim attach
   - restore
   - recovery
   - login methods
   - account deletion
5. Make sure premium-only APIs, UI affordances, and navigation all agree.

Primary write areas:

- `apps/web/app/api/me/*`
- `apps/web/lib/server/v1/mobileApi.ts`
- web account surfaces
- mobile account surfaces

Acceptance:

- No customer screen promises access that the backend rejects.
- Compatibility-only unpaid-account behavior is explicit, narrow, and documented.
- Premium-only routes and UI are aligned.

Rollback:

- Preserve narrow auth/account compatibility entry points even if broader behavior changes need to be reverted.

## Phase 4 - Admin, Documentation, and Regression Asset Cleanup

Goal:

- Remove stale terminology and third-tier assumptions from internal surfaces and repo-owned verification assets.

Changes:

1. Update admin labels so admin sees separate axes for:
   - auth/account
   - membership tier
   - billing state
   rather than `Signed in` or `free account`
2. Update FAQ, PRD, acceptance docs, and platform plans to reflect the anon/premium model.
3. Update local fixtures and smoke scripts so they no longer assert or serialize `free`.
4. Add a repo guard that fails if customer-facing code reintroduces forbidden terms.

Primary write areas:

- `apps/web/app/admin/users/page.tsx`
- `docs/frontpage-premium-ux-checklist.md`
- `docs/high-io-remediation.md`
- `docs/three-platform-phase5-billing-acceptance.md`
- `docs/PRD.md`
- `docs/premium-phases-implementation-plan.md`
- `docs/three-platform-overhaul-plan.md`
- `scripts/shared-domain-smoke.mts`
- `scripts/gating-alignment-guard.mts`
- `scripts/web-regression-smoke.mts`
- `scripts/web-regression-smoke.ts`
- `scripts/v1-contracts-smoke.mts`
- `scripts/mobile-query-guard.mts`

Acceptance:

- Repo-owned docs and tests no longer describe a third customer tier.
- Admin surfaces use precise internal language instead of customer-plan language.

Rollback:

- Docs and script updates are independently reversible without touching product code.

## Phase 5 - Final Contract and Compatibility Cleanup

Goal:

- Remove the last transitional compatibility shims once repo consumers are clean.

Changes:

1. Remove remaining `free` serialization from shared contracts and fixtures.
2. Delete compatibility branches added only to tolerate the old model.
3. Add regression tests that assert:
   - shared viewer tier stays `anon | premium`
   - customer copy does not render forbidden labels
   - saved/integration/account surfaces do not depend on an unpaid signed-in tier
4. Update the master three-platform plan and release notes to record the cutover.

Acceptance:

- Repo-wide search is clean for unsupported customer-tier terminology outside historical notes that are intentionally preserved.
- Contract tests, type checks, and lint pass under the pinned toolchain.

Rollback:

- If an external dependency unexpectedly still needs compatibility, reintroduce parsing tolerance only, not customer-facing tier language.

## Recommended Implementation Order

Use this order to minimize blast radius:

1. Planning and vocabulary lock
2. Shared domain and contract producers
3. Customer UI copy and state rendering
4. Behavioral route alignment
5. Admin/docs/scripts/test cleanup
6. Final compatibility removal

This order ensures the repo stops presenting the wrong model before the riskiest auth or route-behavior changes land.

## Verification Set

Run all checks with the pinned toolchain only.

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Recommended targeted verification in addition to the repo-required set:

1. Web manual smoke:
   - public home/feed
   - sign-in
   - upgrade/claim
   - account
   - saved
   - integrations
2. Mobile manual smoke:
   - profile
   - preferences
   - saved
   - integrations
   - sign-in
   - sign-up / claim attach flow
3. Admin manual smoke:
   - user list labels
   - admin override labels
4. Repo grep guard before final merge:
   - `Signed in without Premium`
   - `Free membership`
   - `Free account`
   - `signed-in non-Premium`
   - `effectiveTierSource: 'free'`

## Rollout Notes

- Land this work in small slices, not a single repo-wide blast.
- Prefer shipping shared/source-of-truth and customer copy cleanup before any strict auth gating.
- If a compatibility-only unpaid authenticated flow is still required, label it as account-only in code and docs and keep it off customer membership surfaces.
- Keep admin anon override explicitly internal and do not let it shape customer terminology.

## Rollback Notes

- The highest-risk rollback boundary is between Phase 2 and Phase 3.
- Copy and contract-producer cleanup can usually stay even if stricter behavioral alignment needs to pause.
- Do not roll back into customer-facing `free` language just to recover a narrow auth/account operation; restore the narrow operation directly instead.

## Done Criteria

This plan is complete when all of the following are true:

1. Customer-facing tier language is only `Anon/Public` or `Premium`.
2. Shared contracts and payloads no longer require a `free` customer state.
3. Web and mobile account surfaces do not present a third membership tier.
4. Admin, docs, and regression assets reflect the same model.
5. Legacy unpaid authenticated sessions, if they still exist at all, are clearly treated as compatibility-only auth/account paths rather than a product tier.
