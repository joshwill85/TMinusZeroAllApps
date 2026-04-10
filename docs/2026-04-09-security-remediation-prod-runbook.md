# 2026-04-09 Security Remediation Production Runbook

## Scope

- Customer-facing impact: indirect
- Web: included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes

This runbook covers production rollout for the web/application changes that complete the already-applied Supabase security remediation.

## Release Scope

Database changes are already live in the linked Supabase project:

- `supabase/migrations/20260409111500_private_surface_rls_and_invoker.sql`
- `supabase/migrations/20260409112000_private_surface_public_revokes.sql`

Application changes in scope for production:

- `apps/web/lib/server/v1/mobileApi.ts`
- `apps/web/lib/server/adminUsaspendingReviews.ts`
- `scripts/mobile-security-guard.mts`
- `scripts/security-remediation-smoke.ts`
- `docs/2026-04-09-supabase-security-remediation-plan.md`

Behavioral intent:

- unified notification v3 writes are forced through an explicit admin/service-role client
- `premium_claims`, `notification_push_destinations_v3`, and `notification_rules_v3` stay inaccessible to `anon` and `authenticated`
- admin USASpending review pages continue to work without widening the public audited-awards view

## Current State

### Supabase

- Remote migrations `20260409111500` and `20260409112000` are applied.
- RLS is enabled for:
  - `public.notification_push_destinations_v3`
  - `public.notification_rules_v3`
  - `public.premium_claims`
- `public.program_usaspending_audited_awards` has `security_invoker=true`.
- Linked database lint no longer reports the original four security findings.

### Verification

Completed against the linked environment:

- `scripts/security-remediation-smoke.ts` passed
- `npm run check:three-platform:boundaries` passed
- `npm run test:v1-contracts` passed
- `npm run test:mobile-query-guard` passed
- `npm run test:mobile-security-guard` passed
- `npm run type-check:ci` passed
- `npm run lint` passed

### Vercel

- Staging project: `tminuszero-mobile-staging`
  - production URL: `https://tminuszero-mobile-staging.vercel.app`
  - Node.js version: `20.x`
- Production project: `tminuszero`
  - production URL: `https://www.tminuszero.app`
  - Node.js version: `24.x`

This drift matters. A staging pass on `tminuszero-mobile-staging` is not a full proxy for production because the production project builds on a different Node major.

### Production-project rehearsal result

A preview rehearsal was run against the actual production Vercel project:

- preview URL: `https://tminuszero-885njw7pi-joshs-projects-2f548a9c.vercel.app`
- inspect URL: `https://vercel.com/joshs-projects-2f548a9c/tminuszero/9UbxqUL6pgMzr5gK63LZvW4iqRJB`
- status: failed at deploy packaging, not at application build

Observed outcome:

- dependency install succeeded
- `npm run build` succeeded
- Next.js compile, type/lint, and static generation completed
- deployment packaging failed because Vercel looked for `/vercel/path0/.next/routes-manifest.json`

Direct error from Vercel:

- `The file "/vercel/path0/.next/routes-manifest.json" couldn't be found`

This confirms the remaining production blocker is project configuration, not the security remediation code.

## Production Risks

### 1. Vercel project drift

The staging preview used the `tminuszero-mobile-staging` project, but production is served by `tminuszero`. Production prep must validate on the `tminuszero` project before any main-branch rollout.

The rehearsal above shows the exact mismatch:

- staging is configured to read output from `apps/web/.next`
- production still expects the default root `.next`

With the current monorepo build (`npm run build` at repo root, `next build` inside `apps/web`), production packaging fails until the `tminuszero` Vercel project is aligned.

### 2. Dirty local workspace

The working tree contains many unrelated tracked and untracked changes. Do not deploy or push production from the current directory state. Use an isolated worktree, release branch, or clean checkout that contains only the files in this release scope.

### 3. Toolchain instructions are stale in `AGENTS.md`

Local repo enforcement currently expects Node `24.14.1`, while `AGENTS.md` still documents Node `20.19.6`. Use the enforced repo toolchain for verification until the documentation is reconciled in a separate change.

## Safe Promotion Sequence

### Phase 1: Freeze release scope

Build the production release from a clean checkout or isolated worktree containing only:

- `apps/web/lib/server/v1/mobileApi.ts`
- `apps/web/lib/server/adminUsaspendingReviews.ts`
- `scripts/mobile-security-guard.mts`
- `scripts/security-remediation-smoke.ts`
- `docs/2026-04-09-supabase-security-remediation-plan.md`
- `docs/2026-04-09-security-remediation-prod-runbook.md`

Do not include unrelated local migrations, generated artifacts, or other in-progress product work.

### Phase 2: Re-run release verification under the enforced repo toolchain

Required checks:

- `node -v && npm -v`
- `npm run doctor`
- `npm ci`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:mobile-security-guard`
- `npm run type-check:ci`
- `npm run lint`
- `node ./node_modules/.bin/tsx --tsconfig tsconfig.scripts.json scripts/security-remediation-smoke.ts`

### Phase 3: Validate on the production Vercel project as preview

Create a preview deployment against the `tminuszero` Vercel project, not the staging project. This validates:

- production project build settings
- production project Node major
- production project preview environment wiring

This is the final non-production gate.

Current blocker before this phase can pass:

- update the `tminuszero` Vercel project to use the web app build output location used by this repo
- safest expected configuration is:
  - Root Directory: `.`
  - Build Command: `npm run build`
  - Output Directory: `apps/web/.next`

Do not promote to production until the prod-project preview succeeds with that configuration.

### Phase 4: Ship via the normal production path

Preferred release path:

1. commit the scoped release on a clean release branch
2. open/review/merge through the normal GitHub flow
3. let the `main` branch trigger the production deployment for `tminuszero`
4. verify the new production deployment and alias on `https://www.tminuszero.app`

Avoid ad hoc production deploys from a dirty local checkout.

## Production Smoke Checklist

Immediately after production is live:

- open admin USASpending review list
- verify review rows render without the previous `review_notes` select failure
- register a mobile push device
- enqueue a push test
- remove the mobile push device
- create an alert rule
- delete the alert rule
- create a watchlist follow that syncs to unified notifications
- delete the watchlist follow
- load premium claim lookup and attach paths
- re-run `supabase db lint --linked --schema public` if the environment linkage still points at production

## Rollback

If the production web deploy regresses:

1. roll back the Vercel deployment first
2. keep the database hardening in place unless a verified production blocker requires temporary relaxation
3. if rollback reveals a code-path dependency on the locked tables, fix the application path and redeploy rather than restoring broad table access

## Notes

- The production project already shows a `git-main` alias, so a normal merge to `main` is the safest release trigger.
- The security migrations are already live; the remaining production step is web application rollout and immediate smoke verification.
- If future build reliability work is taken on separately, review whether `turbo.json` should also declare `apps/web/.next/**` as a build output for the monorepo web target.
