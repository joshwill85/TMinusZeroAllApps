# Supabase Migration Cleanup Strategy

Date: `2026-04-10`

This is a strategy document only. No migrations were rewritten, squashed, reordered, or removed in this pass.

## Current State Inventory

- Migrations: `323`
- Edge functions: `71`
- Seed files: `supabase/seed.sql`
- Auth templates:
  - `supabase/templates/auth/confirm_signup.html`
  - `supabase/templates/auth/password_changed.html`
  - `supabase/templates/auth/reset_password.html`
- Local state:
  - tracked: `supabase/.branches/_current_branch`
  - untracked local temp state under `supabase/.temp/*`

## Churn Signals

Observed across current migration history:

- `343` `ALTER TABLE` statements
- `161` `CREATE POLICY` statements
- many `drop policy if exists` + `create policy` pairs
- repeated `create or replace function` for shared helpers such as:
  - `public.invoke_edge_job`
  - `public.get_launch_filter_options*`
  - `public.managed_scheduler_*`
- `399` `cron.` references across migrations/functions
- special-case migration `20260301141801_remote_commit.sql` contains remote/storage guard behavior and earlier local reset recovery notes

Interpretation:
- the migration chain is operationally dense
- it has real history bloat
- it is not safe to “clean it up later” by ad hoc deletion

## Specific Cleanup Risks

### Policy churn

There is heavy policy drop/create churn. That is a strong sign that:
- policy intent is still evolving
- the historical chain contains superseded rewrites
- a future baseline should group policies by domain, not by every small iteration

### Scheduler / cron churn

The repo has a lot of scheduler topology encoded over time:
- managed scheduler functions
- cron inspection/admin helpers
- repeated `invoke_edge_job` rewrites
- function-level scheduling expectations in both SQL and edge-function code

This means:
- migration cleanup must preserve runtime job topology
- “unused cron helper” assumptions are dangerous without runtime inventory

### Reset-path sensitivity

The repo already has evidence of past local reset breakage:
- `docs/three-platform-overhaul-plan.md` explicitly notes prior reset blockers
- `20260301141801_remote_commit.sql` contains guarded storage-trigger logic

This means:
- local reset parity is a hard gate for any future migration rewrite

## Safe First-Pass Cleanup

Safe now:
- delete tracked local state marker `supabase/.branches/_current_branch`
- document migration domains and suspicious churn clusters
- stop adding new local-state files to git
- create a migration manifest or inventory doc before any baseline work

Not safe now:
- squashing migrations
- renumbering/reordering migrations
- removing “old-looking” migrations
- changing remote migration history
- moving active historical migrations into an archive folder

## Recommended Baseline Strategy

### Phase A: Inventory and freeze

Before any rewrite:
- classify migrations by domain:
  - auth / entitlements / billing
  - launch feed / launch detail
  - AR / JEP / trajectory
  - notifications
  - admin / ops / scheduler
  - program hubs / contracts / ingestion
- identify repeated helpers with 3+ rewrites
- identify policy churn tables with repeated drop/create cycles
- identify cron-managed jobs and the canonical current owner for each

### Phase B: Validate local truth

Run and record:
- `supabase db reset`
- `supabase db diff`
- current repo smoke commands that depend on the DB shape

Minimum validation set after any migration cleanup prototype:
- `npm run doctor`
- `npm run test:v1-contracts`
- `npm run test:smoke`
- any domain-specific smoke that depends on changed schema areas

### Phase C: Create a baseline branch, not a surprise rewrite

Recommended approach:
- create a dedicated migration-cleanup branch
- generate a fresh baseline migration from a verified current schema
- keep the old history available on the branch and in git history
- compare old-history reset vs baseline reset
- do not touch `main` until reset, diff, and smoke parity are documented

### Phase D: Keep follow-up migrations additive

After a validated baseline exists:
- keep only the new baseline + post-baseline additive migrations in the active path
- archive the old chain in git history, not in a search-polluting source folder

## Validation Requirements For Any Future Migration Rewrite

Required:
1. `supabase db reset`
2. `supabase db diff`
3. targeted smoke checks for touched domains
4. API contract smoke where schema affects `/api/v1`
5. rollback note describing how to return to the old chain if parity fails

Recommended:
- dry-run against a fresh local DB and a separately provisioned staging-like DB
- explicit check of scheduler jobs and function permissions after reset

## Declarative Schema Follow-Up

If the team wants better long-term hygiene, declarative schema files may be worth a later follow-up.

Not now:
- this repo is still changing quickly in auth, billing, AR/JEP, and notifications
- introducing declarative schemas during first-pass cleanup would multiply risk

Reasonable follow-up path:
- after a validated baseline exists
- after policy/scheduler ownership is documented
- after current high-churn domains slow down

## Recommended Sequence

1. Remove tracked local Supabase state from git.
2. Document migration domains and churn clusters.
3. Freeze opportunistic migration cleanup.
4. Build a validated baseline branch.
5. Reset/diff/smoke-test it.
6. Only then consider replacing the active history.

