# High Postgres IO Remediation (Supabase)

This runbook is focused on **reducing IO + cost** without changing product semantics:
- Premium stays “live” (LL2 incremental cadence ~15 seconds).
- Anon + signed-in free continue to use **cached snapshots** (`launches_public_cache`), refreshed on the existing cadence.
- AR trajectory pipeline behavior is unchanged.

## Quick triage (if you see a Disk IO budget warning)
1. Run `supabase inspect db outliers` and look for `select public.invoke_ll2_incremental_burst()`:
   - If it dominates total time, **Edge-burst mode is not enabled** (or the Edge function isn’t deployed).
2. Confirm `system_settings.ll2_incremental_use_edge_burst=true` and that the Edge Function `ll2-incremental-burst` is deployed.
   - SQL helper: `docs/sql/enable_ll2_edge_burst.sql`
3. Pause unintended backfills (safe, reversible):
   - SQL helper: `docs/sql/pause_selected_backfills.sql`
4. If notifications are not active and payload backfill is complete, pause those minute-level jobs too:
   - SQL helper: `docs/sql/pause_notifications_and_payload_backfill.sql`

## What we found (remote inspection)

### 1) Primary offender: Postgres sleep-loop burst job
`pg_stat_statements` outliers showed `select public.invoke_ll2_incremental_burst()` dominating total execution time (sleep loop held open ~45s per minute):
- total exec time: **262:35:17** (~99.6% of tracked time)
- calls: **20,928**

### 2) Secondary offenders / contributors
- `select public.invoke_edge_job($1)`:
  - total exec time: **00:59:07** (~0.4%)
  - calls: **52,814**
- `pg_net` storage table pressure (from `traffic-profile`):
  - `net._http_response`: **221,109** write tuples; blocks write **~1,361,682** (very write-heavy)
- `traffic-profile` was write-heavy for:
  - `net._http_response` (scheduler HTTP responses)
  - `public.satellites` (CelesTrak jobs upserting large row sets repeatedly)
  - `public.ll2_catalog_public_cache`, `public.ll2_agencies/locations/pads/rocket_configs` (frequent upserts)
  - `cron.job_run_details`, `public.ingestion_runs`, `public.system_settings` (high-frequency logging/state updates)
- `bloat` was present but moderate (not the main root cause).

## Remediation (Option A: keep Supabase; move burst loop to Edge)

### A.1 Apply migrations (safe, incremental)
- `supabase/migrations/0137_job_locks.sql` (TTL job locks for Edge schedulers)
- `supabase/migrations/0138_ll2_incremental_burst_edge_bridge.sql` (bridge: Postgres burst function triggers Edge burst when enabled)
- `supabase/migrations/0141_missing_indexes_phase1.sql` (indexes: common filters + FK lookups)
- `supabase/migrations/0142_missing_indexes_phase2.sql` (indexes: remaining small FK gaps + per-launch updates ordering)
- `supabase/migrations/0171_rls_policy_perf_fixes.sql` (RLS: initplan-friendly auth.uid() + scope service-role policies)
- `supabase/migrations/0172_missing_fk_indexes_phase3.sql` (indexes: additional FK covering indexes flagged by linter)

### A.2 Deploy Edge Function: `ll2-incremental-burst`
Deploy `supabase/functions/ll2-incremental-burst`.

### A.3 Enable Edge-burst mode (production setting flip)
Flip the switch once the Edge function is deployed:

```sql
insert into public.system_settings (key, value)
values ('ll2_incremental_use_edge_burst', 'true'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();
```

Expected result:
- `public.invoke_ll2_incremental_burst()` returns quickly (no long `pg_sleep` session).
- Premium cadence stays ~15s, implemented in Edge.
- Fewer `pg_net` HTTP requests per minute (1 burst trigger instead of multiple per-minute calls).

### A.4 Verify impact (remote checks)
Run (in order):
- `supabase inspect db outliers` → confirm `invoke_ll2_incremental_burst()` total time collapses after the change.
- `supabase inspect db traffic-profile` → confirm `net._http_response` write pressure trends down (should drop once burst becomes a single Edge trigger).
- `supabase inspect db bloat` + `supabase inspect db vacuum-stats` → ensure no runaway bloat/dead tuples.

If you want to specifically detect spill-to-disk sorts/aggregations, query `pg_stat_statements` for temp blocks:

```sql
select
  calls,
  total_exec_time,
  temp_blks_read,
  temp_blks_written,
  query
from pg_stat_statements
order by temp_blks_written desc
limit 20;
```

## Backfills: separate from “live” cadence (admin-safe)

### Inventory (from `cron.job`)
Backfills in the current scheduler inventory include:
- `ll2_backfill` (Edge: `ll2-backfill`)
- `ll2_payload_backfill` (Edge: `ll2-payload-backfill`) **also populates spacecraft manifest + satellite payload backfills**
- `rocket_media_backfill` (Edge: `rocket-media-backfill`)

### Safe defaults
- Do **not** disable/unschedule `ll2_payload_backfill` while spacecraft manifest / launch satellite payload backfills depend on it.
- If `system_settings.ll2_payload_backfill_done=true` and no further payload/spacecraft backfill is needed, disable + unschedule `ll2_payload_backfill`.
- Prefer disabling other backfills first.

### Admin UI controls
Admin page now includes buttons to:
- Disable backfills while keeping payload backfill running.
- Manually trigger backfills with `{ force: true }` even if disabled.
- Explicitly enable/disable the payload backfill job with an extra warning prompt.

### Manual SQL (if needed)
`docs/sql/pause_selected_backfills.sql` pauses high-IO backfills **excluding** payload backfill (because it is required by spacecraft/payload manifests).

`docs/sql/pause_notifications_and_payload_backfill.sql` pauses notifications (`notifications_dispatch`, `notifications_send`) and unschedules payload backfill once it is complete.

## Data write amplification reductions (safe semantics)
- LL2 incremental + ingestion-cycle reference upserts use **insert-only** semantics for slow-changing reference tables to avoid no-op rewrites.
- Ingestion-cycle incremental step skips launches whose incoming update timestamp is not newer than what we already stored.

## If costs are still high
Next targeted work items (high ROI, but more invasive than the above):
1. Reduce `satellites` no-op updates (CelesTrak): avoid rewriting `updated_at` and unchanged SATCAT fields every run.
2. Reduce `ll2_catalog_public_cache` churn: update-only-if-changed or smaller refresh windows.
3. Consider reducing `pg_net` response bloat by returning minimal JSON for cron-triggered invocations.
