# 2026-04-09 Supabase Security Remediation Plan

## Scope

- Customer-facing impact: indirect
- Web: included indirectly
- iOS: included indirectly
- Android: included indirectly
- Admin/internal impact: yes
- Shared API/backend impact: yes

This plan covers the Supabase security findings around:

- `public.notification_push_destinations_v3`
- `public.notification_rules_v3`
- `public.premium_claims`
- `public.program_usaspending_audited_awards`

## Findings

### 1. Unified notification tables are exposed too broadly

`public.notification_push_destinations_v3` stores push credentials and device secrets, including Expo tokens and Web Push material. `public.notification_rules_v3` stores user notification targeting state. Both tables were created without RLS and without explicit privilege revokes during the v3 cutover.

Target posture:

- Enable RLS on both tables.
- Restrict direct table access to `service_role`.
- Route all unified notification table writes through explicit admin/service-role code paths.

### 2. Premium claims are server-owned but not schema-locked

`public.premium_claims` stores claim tokens, email, provider identifiers, and entitlement-linkage state. Current app code already treats it as server-owned.

Target posture:

- Enable RLS.
- Restrict direct table access to `service_role`.

### 3. Public USASpending audited awards view should not rely on definer semantics

`public.program_usaspending_audited_awards` is intentionally readable by public-facing server code, but the view should use invoker semantics so base-table RLS remains the source of truth.

Target posture:

- Set `security_invoker = true`.
- Keep current public-read behavior unless a later product decision moves this view behind server-only access.

## Implementation Order

### Phase 1: Code-path hardening

Before revoking table grants, remove session-scoped access dependencies for unified notification v3 writes:

- `apps/web/lib/server/v1/mobileApi.ts`
- notification-specific writes use an explicit admin-only helper
- watchlist sync remains best-effort so saved-items flows do not fail in local environments that lack service-role configuration

### Phase 2: Schema hardening

Apply an additive migration that:

- enables RLS on `notification_push_destinations_v3`
- enables RLS on `notification_rules_v3`
- enables RLS on `premium_claims`
- adds `service_role` policies for required operations
- sets `security_invoker = true` on `program_usaspending_audited_awards`

### Phase 3: Privilege revokes

After the app code no longer depends on session-scoped access for the private tables, revoke direct `public`, `anon`, and `authenticated` access for:

- `notification_push_destinations_v3`
- `notification_rules_v3`
- `premium_claims`

`program_usaspending_audited_awards` is intentionally excluded from the revoke phase in this pass.

## Rollback

Rollback order:

1. Revert privilege revokes if a production path still depends on direct SQL access.
2. Revert RLS/policy migration only if the issue cannot be resolved in application code.
3. Do not revert the `security_invoker` change unless a verified production regression requires it.

This order keeps the highest-risk data surfaces locked down whenever possible.

## Verification

Run under the pinned toolchain:

- `npm run doctor`
- `npm run type-check:ci`
- `npm run lint`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:mobile-security-guard`

Manual verification:

- guest premium claim creation and claim lookup
- attach claim to existing user
- premium sign-up from claim
- Stripe, Apple, and Google purchase verification flows
- mobile push register and remove
- push test enqueue
- alert rule create and delete
- watchlist rule create and delete
- admin billing summary
- admin USASpending review list and promote

Database verification:

- rerun the Supabase linter
- confirm the four reported findings are cleared
