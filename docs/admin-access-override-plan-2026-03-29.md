# Admin Access Override Plan

## Summary
- Platform matrix:
  - Web: included
  - iOS: included
  - Android: included
  - Admin/internal impact: yes
  - Shared API/backend impact: yes
  - Customer-facing: no
- Goal: let signed-in admins switch their own effective customer access between free and premium without changing real billing state or admin privileges.
- Non-goals:
  - no change to real subscriptions, purchase entitlements, or provider sync
  - no way for one admin to change another user's override
  - no change to true admin-only tools or data visibility

## Current State
- `profiles.role = 'admin'` is the source of truth for admin privileges.
- Shared entitlement resolution treats `admin` as premium access.
- Several server and worker paths still gate premium behavior with `isPaid || isAdmin`, which would make a free-mode override inconsistent unless audited.
- Profile role changes are already service-role only.

## Proposed Design
- Add a dedicated table for self-service admin overrides:
  - `public.admin_access_overrides`
  - columns:
    - `user_id uuid primary key references public.profiles(user_id) on delete cascade`
    - `effective_tier_override text null check (effective_tier_override in ('anon', 'premium'))`
    - `updated_by uuid not null references public.profiles(user_id)`
    - `updated_at timestamptz not null default now()`
- Add an append-only audit table:
  - `public.admin_access_override_events`
  - stores `user_id`, `updated_by`, `previous_override`, `next_override`, `created_at`
- Server writes stay service-role only.
- No direct client writes to the tables.

## API And Contract Changes
- Add a self-service route:
  - `GET /api/v1/me/admin-access-override`
  - `PUT /api/v1/me/admin-access-override`
- Route rules:
  - authenticated only
  - caller must currently be `admin`
  - route only reads/writes the caller's own row
  - non-admin callers receive `403 forbidden`
- Extend the shared entitlements contract with additive fields:
  - `billingIsPaid: boolean`
  - `effectiveTierSource: 'guest' | 'free' | 'subscription' | 'admin' | 'admin_override'`
  - `adminAccessOverride: 'anon' | 'premium' | null`
- Keep `tier` as the effective customer tier used by web/mobile.
- Keep `isAdmin` as the real privilege signal.

## Shared Logic Changes
- Shared entitlement resolution should:
  - compute real billing state separately from admin role
  - load the admin override for admins
  - derive effective tier from override first, then admin default, then subscription
- Add a shared helper for effective premium access and move premium gating to it or to capabilities.
- Keep true admin-only logic on `isAdmin` or `role === 'admin'`.

## UI Placement
- Mobile:
  - add `Admin Access Testing` panel under `Account overview` on the profile tab
  - segmented control or pill actions for `Free`, `Premium`, and `Use default`
  - helper copy: `Affects customer access across web, iPhone, and Android. Billing and admin tools stay unchanged.`
- Web:
  - add the same panel on `/account`, near membership/billing
  - same labels and semantics as mobile

## Verification
- Migration applies cleanly.
- Non-admins cannot read or write the override route.
- Admins can update only their own override.
- Web profile and mobile profile both reflect current override state.
- Premium-gated surfaces follow effective tier.
- Admin-only surfaces remain available regardless of override.
- Run:
  - `npm run doctor`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`

## Rollout Order
- Apply `supabase/migrations/20260329160000_admin_access_overrides.sql` to the hosted database before relying on the new profile controls.
- Because the linked project is currently behind on multiple unrelated local migrations, do not use `supabase db push` or `supabase migration up --linked` for this rollout.
- Safe live rollout:
  - apply only the SQL in `supabase/migrations/20260329160000_admin_access_overrides.sql`
  - record only version `20260329160000` as applied in `supabase_migrations.schema_migrations`
  - then verify `GET/PUT /api/v1/me/admin-access-override` with an admin account
- The server and worker code should tolerate the table being absent and fall back to default admin behavior until that schema change is applied.

## Rollback
- Disable the profile UI.
- Ignore the override rows in entitlement resolution.
- Leave the tables in place for audit history.
