# 2026-04-10 Security Remediation Staging Handoff

## Scope

- Customer-facing impact: indirect
- Web: included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes

This document is staging-only. Production Vercel targets, aliases, and settings are explicitly out of scope for this handoff.

## Current Staging State

### Vercel

- project: `tminuszero-mobile-staging`
- preview deployment: `https://tminuszero-mobile-staging-g6ngzhmau-joshs-projects-2f548a9c.vercel.app`
- deployment id: `dpl_BYJWNcruEoiSSFxFqdpp7YSuobyN`
- status: `Ready`
- direct HTTP check on `/`: `200`

No redeploy was performed in this step. The existing staging preview remains the active validated web target for this remediation.

### Supabase

- linked project ref: `lixuhtyqprseulhdvynq`
- applied migrations:
  - `20260409111500_private_surface_rls_and_invoker.sql`
  - `20260409112000_private_surface_public_revokes.sql`

Security posture already verified earlier in this work:

- RLS enabled on `public.notification_push_destinations_v3`
- RLS enabled on `public.notification_rules_v3`
- RLS enabled on `public.premium_claims`
- `public.program_usaspending_audited_awards` uses `security_invoker=true`
- direct table privileges removed from `public`, `anon`, and `authenticated` for the three private tables

## Application Changes In Scope

- `apps/web/lib/server/v1/mobileApi.ts`
- `apps/web/lib/server/adminUsaspendingReviews.ts`
- `scripts/mobile-security-guard.mts`
- `scripts/security-remediation-smoke.ts`
- `supabase/migrations/20260409111500_private_surface_rls_and_invoker.sql`
- `supabase/migrations/20260409112000_private_surface_public_revokes.sql`
- `docs/2026-04-09-supabase-security-remediation-plan.md`

## What Was Verified

Previously completed and still authoritative for this staging rollout:

- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:mobile-security-guard`
- `npm run type-check:ci`
- `npm run lint`
- `scripts/security-remediation-smoke.ts`
- linked `supabase db lint --linked --schema public`

Today’s staging-only confirmation:

- staging Vercel preview is still `Ready`
- staging preview root responds with `HTTP 200`

## Remaining Safe Staging Work

If additional validation is wanted without touching production:

- manually check the admin USASpending review list on staging
- verify premium claim lookup and attach flows against staging
- verify push register, push test enqueue, and push removal against staging
- verify alert rule create/delete and watchlist sync flows against staging

## Explicit Exclusions

Do not do any of the following as part of this remediation handoff:

- deploy to the `tminuszero` Vercel project
- hit `https://www.tminuszero.app` as a release target
- change production Vercel settings, aliases, or env vars
- push `main` or trigger any production rollout path
