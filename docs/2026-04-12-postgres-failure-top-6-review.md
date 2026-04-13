# Postgres Failure Audit: Top 6 Review

Follow-up to [2026-04-12-postgres-failure-audit-last-3h.md](/Users/petpawlooza/TMinusZero%20AllApps/docs/2026-04-12-postgres-failure-audit-last-3h.md).

This pass ranks the six highest-signal failure families from the earlier last-3-hours audit and traces each one to its most likely root cause.

## Scope

- Customer-facing or admin/internal: admin/internal incident audit
- Web: not included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: analysis only

## Ranking Summary

Ranked by a mix of recurrence, blast radius, and how directly the evidence points to a fix.

| Rank | Failure family | Window signal | Root-cause assessment | Local vs deployed | Confidence |
| --- | --- | ---: | --- | --- | --- |
| 1 | Internal HTTP dispatch timeout (`5s`) | `58` rows in original audit window | `pg_net` edge-job bridge is timing out at the transport layer under current load | SQL plumbing and settings match current repo intent | High |
| 2 | `trajectory_products_generate`: `landingPick is not defined` | `11` failed runs, alert occurrences `150`, HTTP `500` x1 | Production is running a stale function build with a block-scoped `landingPick` bug | Local repo is fixed; deployed function is older | High |
| 3 | `faa_launch_match`: `column launches.location_name does not exist` | `4` failed runs, persisted `faa_match_last_error`, HTTP `500` x1 | Live code still queries a removed column on `public.launches` | Local and deployed are both broken the same way | High |
| 4 | `public_cache_refresh` / `ingestion_cycle` / `ll2_future_launch_sync`: `57014 statement timeout` | `4` direct failed runs plus `3` wrapper failures | Large cache-refresh and future-sync reads/writes are pushing into timeout territory | Local and deployed match; this is a live workload/problem-shape issue | Medium-high |
| 5 | `cron.job_run_details`: `job startup timeout` | `4` rows | Scheduler workers likely missed startup under transient load pressure rather than job-definition bugs | Job schedules and wrappers look correct | Medium |
| 6 | `ws45_planning_forecast_ingest`: hidden `"[object Object]"` error | `1` failed run, alert occurrences `1` | The function is swallowing the real exception by stringifying unknown objects poorly | Local and deployed match; observability bug is live | High |

## 1. Internal HTTP Dispatch Timeout (`5s`)

### Evidence

- Original audit window captured `58` timeout rows in `net._http_response` with the same `Timeout of 5000 ms reached` signature.
- A follow-up spot check still showed the issue continuing: `64` explicit timeout rows and `2` HTTP `500` rows in the trailing three-hour window.
- The current scheduler bridge still routes jobs through `public.invoke_edge_job(job_slug)`, which calls `net.http_post(...)` without an explicit timeout override in [20260406213000_ll2_future_launch_sync_job.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260406213000_ll2_future_launch_sync_job.sql:11) and [20260406213000_ll2_future_launch_sync_job.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260406213000_ll2_future_launch_sync_job.sql:124).
- The managed scheduler marks rows as `sent` immediately after `perform public.invoke_edge_job(...)` returns in [0220_managed_scheduler_backpressure_and_admin_stats.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/0220_managed_scheduler_backpressure_and_admin_stats.sql:280), so downstream edge-function timeouts will not necessarily surface as `managed_scheduler_queue.status = failed`.

### Assessment

This is the dominant transport-level failure in the incident window. It is not one single business-logic bug. It is the DB-side bridge to edge jobs timing out at five seconds while the database still considers the dispatch itself successful enough to mark the queue row as sent.

In practice, this means:

- some edge jobs are taking longer than the bridge timeout to return
- some scheduler work is disappearing into the gap between `queue sent` and `edge response completed`
- the queue tables under-report real downstream failures

### Smallest remediation path

1. Treat this as scheduler/bridge pressure, not a single app bug.
2. Add request-level attribution so each `net._http_response.id` can be tied back to `edge_job_slug`.
3. Raise or tune the bridge timeout only after attribution is in place.
4. Stop relying on `managed_scheduler_queue.status = sent` as proof of edge success.

## 2. `trajectory_products_generate`: `landingPick is not defined`

### Evidence

- Earlier audit captured `11` failed `trajectory_products_generate` runs, alert occurrences `150`, and one matching internal HTTP `500`.
- Local source now declares `let landingPick: LandingConstraintEvaluation | null = null;` before the branch in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/trajectory-products-generate/index.ts:974) and later assigns `landingPick = pickBestLandingConstraint(...)` in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/trajectory-products-generate/index.ts:1015).
- A direct diff against the deployed production function showed the live version still used `const landingPick = ...` inside the narrower block, which makes later references illegal outside that scope.
- `supabase functions list` shows `trajectory-products-generate` version `27`, updated `2026-04-12 22:07:56 UTC`, which matches the period when the stale build was still live.

### Assessment

This one is a deterministic runtime bug caused by deployment drift. The repo already contains the fix. Production is running an older function body.

This is not a Postgres query problem. Postgres only records the aftereffects:

- failed ingestion runs
- alert churn
- one internal HTTP `500`

### Smallest remediation path

1. Deploy the current local `trajectory-products-generate` function.
2. Re-run a single manual invocation and verify the `landingPick` error disappears.
3. After deploy, clear or age out the alert noise only if new runs stay clean.

## 3. `faa_launch_match`: `column launches.location_name does not exist`

### Evidence

- Earlier audit captured `4` failed `faa_launch_match` runs, one matching HTTP `500`, and persisted `public.system_settings.faa_match_last_error`.
- Local code still selects `location_name` from `public.launches` in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/faa-launch-match/index.ts:100) and again in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/faa-launch-match/index.ts:132).
- Production schema inspection showed:
  - `public.launches` no longer has `location_name`
  - `public.launches` does have `pad_location_name`
  - `public.launches_public_cache` still has `location_name`
- Deployed and local `faa-launch-match` diffed cleanly, so this is not a stale deploy. The checked-in code itself is wrong for the current `public.launches` schema.

### Assessment

This is a live schema/code mismatch. The job is querying the wrong column from the wrong shape. Unlike the trajectory issue, there is no deploy-only escape hatch here; local code needs to change.

### Smallest remediation path

1. Update `faa-launch-match` to read the current launch location field from `public.launches`.
2. Prefer an explicit compatibility mapping instead of assuming cache and source tables share identical column names.
3. Re-run the job and confirm `faa_match_last_error` clears.

## 4. `public_cache_refresh` / `ingestion_cycle` / `ll2_future_launch_sync`: `57014 statement timeout`

### Evidence

- Earlier audit captured:
  - `public_cache_refresh` direct statement timeouts
  - `ingestion_cycle` wrapper failures whose nested `publicCache` step timed out
  - `ll2_future_launch_sync` failures in the same timeout family
- Local `ingestion-cycle` uses very large defaults in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ingestion-cycle/index.ts:31):
  - `publicCacheHistoryDays = 36500`
  - `publicCacheHorizonDays = 36500`
  - `publicCachePageSize = 1000`
- The refresh path does a wide `select('*')` from `public.launches` in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ingestion-cycle/index.ts:821) and upserts large batches into `launches_public_cache` in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ingestion-cycle/index.ts:854).
- No overriding `public_cache_*` settings were present in `public.system_settings`, so those large defaults are effectively in use.
- Actual table size is not tiny in runtime terms:
  - `public.launches`: `7857` rows
  - `public.launches_public_cache`: `7857` rows
- `pg_stat_statements` showed the hottest related write as the `launches_public_cache` upsert with `4` calls totaling about `21564 ms`, mean about `5391 ms`.
- `ll2-future-launch-sync` reads future launches from `launches_public_cache` in pages of `1000` rows in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ll2-future-launch-sync/index.ts:287).
- Deployed `ingestion-cycle` and `ll2-future-launch-sync` match local, so this is not a stale-function issue.

### Assessment

This is the clearest workload-driven timeout bucket. The job shape is expensive:

- broad time windows
- wide row selection
- large page size
- expensive upserts into the cache table
- related readers depending on that same cache table

This does not yet prove a missing index is the primary problem. The stronger evidence is query shape and write volume. The upsert timings already cross the same order of magnitude as the bridge timeout pressure.

### Smallest remediation path

1. Reduce cache refresh scope before changing schema:
   - shrink history/horizon defaults or set tighter `public_cache_*` overrides
   - cut page size below `1000`
   - stop using `select('*')` if only a subset is needed to build cache rows
2. Separate cache writers from future-sync readers where possible.
3. Only after narrowing the workload, inspect whether a new composite/partial index is still justified.

## 5. `cron.job_run_details`: `job startup timeout`

### Evidence

- Earlier audit captured four `job startup timeout` rows affecting:
  - `managed_jobs_tick` x2
  - `ll2_incremental_burst` x1
  - `net_http_response_prune` x1
- These are all scheduler/plumbing jobs, not customer-facing business jobs.
- The live schedules are dense:
  - `ll2_incremental_burst` every minute
  - `managed_jobs_tick` every minute
  - `net_http_response_prune` every 30 minutes
- Repo migrations already contain explicit scheduler IO-pressure hardening notes in [0218_scheduler_io_efficiency_hardening.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/0218_scheduler_io_efficiency_hardening.sql:1), which is consistent with this class of failure recurring under load rather than from one bad job definition.

### Assessment

These timeouts are best explained as scheduler-worker saturation or startup starvation during a busy period. The affected jobs are the same jobs responsible for dispatching and cleaning up the rest of the system, which means scheduler health is part of the incident, not just a victim of it.

I do not see evidence that the cron definitions themselves are malformed.

### Smallest remediation path

1. Treat these as platform-pressure signals tied to the transport/cache issues above.
2. Reduce avoidable scheduler churn before tuning cadence further.
3. Keep `ll2_incremental_burst`, `managed_jobs_tick`, and pruning jobs from colliding with the heaviest cache work where possible.

## 6. `ws45_planning_forecast_ingest`: hidden `"[object Object]"` error

### Evidence

- Earlier audit captured one `ws45_planning_forecast_ingest` failure whose nested stats recorded:
  - `step = planning_pdf_ingest`
  - `error = "[object Object]"`
- The per-PDF catch block stores `error: stringifyError(err)` in [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ws45-planning-forecast-ingest/index.ts:142).
- `stringifyError` is currently:
  - `err instanceof Error ? err.message : String(err)`
  - see [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ws45-planning-forecast-ingest/index.ts:698)
- Deployed and local versions match, so this observability gap is live right now.

### Assessment

This is not necessarily a high-volume incident driver, but it is a high-value diagnostic defect. The function is catching an object-shaped error and collapsing it into `"[object Object]"`, which strips the exact detail needed to decide whether the underlying failure is a PDF parse problem, fetch problem, or Supabase write problem.

### Smallest remediation path

1. Replace the fallback stringification with structured serialization for unknown objects.
2. Include the important fields from Supabase/PostgREST errors when present.
3. Re-run the job once and capture the real exception before changing anything else in WS45.

## Cross-Cutting Notes

- The two HTTP `500` rows from the original audit are not standalone top-six items; they are manifestations of items `#2` and `#3`.
- The timeout families interact:
  - `public_cache_refresh` pressure raises latency
  - the edge-job bridge times out at `5s`
  - scheduler startup begins missing windows
- The cleanest first moves are:
  1. deploy the fixed `trajectory-products-generate`
  2. patch `faa-launch-match`
  3. reduce `public_cache_refresh` scope and batch size
  4. improve scheduler/bridge attribution before changing timeout thresholds
