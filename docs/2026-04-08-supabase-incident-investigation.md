# Supabase Incident Investigation

Date of incident: April 8, 2026

## Scope

- Customer-facing or admin/internal: admin/internal incident investigation
- Web: included
- iOS: not included
- Android: not included
- Shared API/backend impact: yes

## Executive Summary

Production did not fail because the database ran out of disk. The database is about `3.2 GB`, and the largest tables are large but not near a disk-exhaustion signature.

The primary failure path was scheduler and `pg_net` pressure centered on two long-lived Edge jobs:

1. `ll2-incremental-burst`
2. `spacex-drone-ship-ingest`

The best evidence-backed model is:

1. WS45 schema drift already existed and was producing missing-column errors.
2. Scheduler-driven Edge invocations then degraded at the runtime boundary, with both `ll2-incremental-burst` and `spacex-drone-ship-ingest` hitting the same ~150 second wall.
3. `managed_scheduler_tick`, `invoke_ll2_incremental_burst`, `prune_cron_job_run_details`, and `prune_net_http_response` continued generating internal load and write amplification.
4. The project degraded into broad REST `522` responses.
5. Restart restored enough health to inspect and pause targeted jobs, but it also flushed 7 to 8.5 hours of delayed managed-scheduler work at once.

WS45 schema drift was a real issue, but it was a secondary contributor. It explains query errors and monitoring noise, not the broad host-wide timeout pattern by itself.

## Timeline

All timestamps below are UTC.

| Time | Event |
| --- | --- |
| `2026-04-08 05:14` | `monitoring_check` reports `ws45_launch_forecasts.document_family does not exist` |
| `2026-04-08 05:44` | `monitoring_check` reports the same WS45 missing-column error again |
| `2026-04-08 06:14` | `monitoring_check` still reports the WS45 missing-column error |
| `2026-04-08 06:50` | `monitoring_check` still reports the WS45 missing-column error |
| `2026-04-08 07:14` | `monitoring_check` adds `trajectorySourceFreshnessError = canceling statement due to statement timeout` |
| `2026-04-08 07:15` | `spacex_drone_ship_ingest` starts and never records `ended_at` |
| `2026-04-08 07:17` | external logs show `POST 504 /functions/v1/ll2-incremental-burst` and `POST 504 /functions/v1/spacex-drone-ship-ingest` |
| `2026-04-08 07:17+` | broad REST `522` begins appearing on unrelated public and service-role reads |
| `2026-04-09 00:46` | after restart, delayed managed-scheduler rows begin starting in a burst; `net._http_response` records multiple internal 5 second timeouts |
| `2026-04-09 01:22` to `2026-04-09 01:23` | repeated public and admin probes return `200` consistently after targeted job stoppages |

## Findings

### 1. Disk usage was not the primary cause

- Database size at capture: `3196.7 MB`
- Largest relations:
  - `public.orbit_elements`: `1915.3 MB`
  - `public.ingestion_runs`: `208.8 MB`
  - `public.navcen_bnm_messages`: `179.8 MB`
  - `cron.job_run_details`: `67.4 MB`
  - `net._http_response`: `35.7 MB`

This is meaningful storage, but not a disk-full outage.

### 2. The scheduler and internal HTTP path were the main load amplifiers

At capture time, the key internal statements were still major cumulative outliers:

| Query | Calls | Total exec time | Mean exec time |
| --- | ---: | ---: | ---: |
| `select public.prune_cron_job_run_details(interval $1, $2)` | `681` | `2308.9s` | `3390.41ms` |
| `select public.managed_scheduler_tick()` | `40789` | `1205.3s` | `29.55ms` |
| `select public.invoke_ll2_incremental_burst()` | `40789` | `547.4s` | `13.42ms` |
| `select public.prune_net_http_response()` | `1360` | `97.7s` | `71.85ms` |
| `select public.invoke_edge_job($1)` | `1524` | `25.2s` | `16.55ms` |

Write-heavy tables during inspection:

| Table | Live rows | Inserts | Updates | Deletes |
| --- | ---: | ---: | ---: | ---: |
| `cron.job_run_details` | `4947` | `85106` | `340410` | `86314` |
| `net._http_response` | `655` | `69335` | `0` | `68680` |
| `net.http_request_queue` | `50` | `69385` | `0` | `69335` |
| `public.managed_scheduler_queue` | `7215` | `27066` | `54132` | `26209` |
| `public.managed_scheduler_jobs` | `26` | `5` | `54105` | `0` |
| `public.system_settings` | `391` | `20` | `137544` | `8` |

This matches the operational pattern: the scheduler itself, its bookkeeping, and internal HTTP response retention generated a large amount of write churn.

### 3. The restart caused a delayed-work flush, not a clean idle recovery

`public.managed_scheduler_queue` currently retains `7215` sent rows and shows the backlog flush clearly. The most delayed rows all started at `2026-04-09 00:46:00.117904+00`.

Top delays at that flush point:

| Edge job | Scheduled for | Started at | Delay |
| --- | --- | --- | --- |
| `artemis-bootstrap` | `2026-04-08 16:19:00+00` | `2026-04-09 00:46:00.117904+00` | `08:27:00.117904` |
| `trajectory-constraints-ingest` | `2026-04-08 16:20:00+00` | `2026-04-09 00:46:00.117904+00` | `08:26:00.117904` |
| `jep-score-refresh` | `2026-04-08 16:22:30+00` | `2026-04-09 00:46:00.117904+00` | `08:23:30.117904` |
| `celestrak-supgp-ingest` | `2026-04-08 16:23:00+00` | `2026-04-09 00:46:00.117904+00` | `08:23:00.117904` |
| `ws45-forecast-ingest` | `2026-04-08 16:24:00+00` | `2026-04-09 00:46:00.117904+00` | `08:22:00.117904` |
| `ingestion-cycle` | `2026-04-08 16:31:00+00` | `2026-04-09 00:46:00.117904+00` | `08:15:00.117904` |
| `monitoring-check` | `2026-04-08 16:44:00+00` | `2026-04-09 00:46:00.117904+00` | `08:02:00.117904` |

At the same time, `net._http_response` recorded multiple internal 5 second timeouts, starting at `2026-04-09 00:46:00.264062+00`.

Restart helped regain control, but it also released a large queue of due work.

### 4. WS45 schema drift was real, but it was not the host-wide root cause

Before the schema landed, `monitoring_check` repeatedly reported:

- `column ws45_launch_forecasts.document_family does not exist`

By the current capture:

- `public.ws45_launch_forecasts` has the expected quality columns
- `public.ws45_forecast_parse_runs` exists
- `public.ws45_live_weather_snapshots` exists
- `public.ws45_planning_forecasts` exists

Also, `public.ws45_launch_forecasts` is tiny:

- `n_live_tup = 14`

That is enough to explain WS45 query failures and monitoring noise, but not broad REST `522` on unrelated tables.

### 5. Migration history is inaccurate relative to the live schema

Recorded migration history currently stops at:

- `20260406213000`

But the following migrations have live objects present without recorded ledger rows:

| Migration | Recorded in `schema_migrations` | Live objects present |
| --- | --- | --- |
| `20260405120000_ws45_quality_and_admin_monitoring` | `false` | `true` |
| `20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers` | `false` | `true` |
| `20260408143000_ws45_live_board_and_planning` | `false` | `true` |
| `20260408190000_ws45_low_io_retention` | `false` | `false` |

This is a deployment-safety issue. Future `supabase db push` or migration sequencing cannot trust the recorded ledger until it is reconciled against production truth.

### 6. The two first failed jobs both have code shapes that can overrun a long Edge invocation

`ll2-incremental-burst`:

- defaults to `4` calls per minute
- defaults to `15` second spacing
- performs those calls inside one Edge invocation
- file: `supabase/functions/ll2-incremental-burst/index.ts`

`spacex-drone-ship-ingest`:

- defaults to `batchSize = 24`
- loops `for (const candidate of candidates)`
- calls `fetchLandingsForLaunch(...)` per candidate before optional wiki sync
- file: `supabase/functions/spacex-drone-ship-ingest/index.ts`

The incident logs showed both jobs failing at roughly the same `150s` execution boundary. The code shape supports the inference that both jobs were able to run long enough to hit runtime limits under slower network or database conditions.

### 7. Cron believed it was succeeding while downstream work was already failing

`cron.job_run_details` for the incident window shows:

- `ll2_incremental_burst` succeeded every minute from `06:50` through `07:29`
- `managed_jobs_tick` also succeeded every minute in the same window

That does not mean the downstream Edge work succeeded. It only means the SQL scheduler functions returned quickly after dispatching work.

### 8. Current production state is stable enough to inspect

Current safety state at capture:

- `jobs_enabled = true`
- `ll2_incremental_use_edge_burst = true`
- `ll2_incremental_job_enabled = false`
- `spacex_drone_ship_ingest_enabled = false`
- `ws45_live_weather_job_enabled = false`
- `ws45_planning_forecast_job_enabled = false`
- `ws45_weather_retention_cleanup_enabled = false`

Current scheduler inventory:

| Scheduler | State |
| --- | --- |
| `cron.job ll2_incremental_burst` | active, every minute |
| `cron.job managed_jobs_tick` | active, every minute |
| `cron.job cron_job_run_details_prune` | active, hourly |
| `cron.job net_http_response_prune` | active, every 30 minutes |
| `managed_scheduler_jobs.spacex_drone_ship_ingest` | disabled |
| `managed_scheduler_jobs.ws45_live_weather_ingest` | disabled |
| `managed_scheduler_jobs.ws45_planning_forecast_ingest` | disabled |

Stability watch after restart and targeted pauses:

| Time | Public probe | Admin probe |
| --- | --- | --- |
| `2026-04-09T01:22:44Z` | `200` in `0.425s` | `200` in `0.357s` |
| `2026-04-09T01:23:00Z` | `200` in `0.459s` | `200` in `0.203s` |
| `2026-04-09T01:23:15Z` | `200` in `0.412s` | `200` in `0.195s` |
| `2026-04-09T01:23:31Z` | `200` in `0.371s` | `200` in `0.193s` |

## Root Cause

Primary cause:

- scheduler-driven Edge/runtime pressure centered on `ll2-incremental-burst` and `spacex-drone-ship-ingest`

Primary amplifiers:

1. `managed_scheduler_tick`
2. `prune_cron_job_run_details`
3. `prune_net_http_response`
4. `pg_net` request and response churn
5. delayed queue flush after restart

Secondary contributor:

- WS45 schema drift and migration-ledger drift

Not supported as primary cause:

- disk exhaustion

## Blast Radius Matrix

### Low blast radius

- keep `ll2_incremental_job_enabled = false`
- keep `spacex_drone_ship_ingest_enabled = false`
- keep WS45 live and planning jobs disabled
- one controlled database restart if health collapses again
- temporary compute scale-up if timeouts return

### Medium blast radius

- reconcile migration history to production truth
- reduce `managed_scheduler_process_limit`
- reduce `managed_scheduler_enqueue_limit`
- lower retention or batch sizes for scheduler bookkeeping
- refactor long-running Edge jobs into smaller bounded units

### High blast radius

- broad scheduler shutdown via `jobs_enabled = false`
- large backfill replay
- schema rewrites outside the already-landed WS45 recovery set
- restore from backup or PITR

## Remediation Order

1. Keep `ll2_incremental_job_enabled` off until `ll2-incremental-burst` is changed so one invocation cannot sit near the runtime ceiling.
2. Keep `spacex_drone_ship_ingest_enabled` off until it is split into smaller batches or otherwise bounded below the runtime limit.
3. Reconcile `supabase_migrations.schema_migrations` with the live schema before any further `supabase db push`.
4. Review `managed_scheduler_tick`, `prune_cron_job_run_details`, and `prune_net_http_response` settings for lower churn while the incident remains warm.
5. Keep WS45 live and planning jobs disabled until the migration ledger is reconciled and the scheduler is stable.
6. Re-enable in this order:
   - `ws45_live_weather_job_enabled`
   - `ws45_planning_forecast_job_enabled`
   - `spacex_drone_ship_ingest_enabled`
   - `ll2_incremental_job_enabled`
7. Only re-enable one job class at a time, with public and admin probes between each step.

## Existing Repo Artifacts

- Recovery runbook: `docs/supabase-ws45-recovery-runbook-2026-04-08.md`
- Narrow pause SQL: `docs/sql/pause_ws45_recovery_jobs.sql`
- Aggressive pause SQL: `docs/sql/pause_ws45_recovery_jobs_aggressive.sql`

## Evidence Appendix

### SQL used for the live investigation

```sql
select now() as captured_at_utc, current_setting('server_version') as server_version;

select key, value, updated_at
from public.system_settings
where key in (
  'jobs_enabled',
  'll2_incremental_use_edge_burst',
  'll2_incremental_job_enabled',
  'spacex_drone_ship_ingest_enabled',
  'ws45_live_weather_job_enabled',
  'ws45_planning_forecast_job_enabled',
  'ws45_weather_retention_cleanup_enabled'
)
order by key;

select cron_job_name, enabled, interval_seconds, offset_seconds, next_run_at, updated_at
from public.managed_scheduler_jobs
where cron_job_name in (
  'spacex_drone_ship_ingest',
  'ws45_live_weather_ingest',
  'ws45_planning_forecast_ingest',
  'ws45_weather_retention_cleanup'
)
order by cron_job_name;

select jobid, jobname, schedule, command, active
from cron.job
where jobname in (
  'll2_incremental_burst',
  'managed_jobs_tick',
  'cron_job_run_details_prune',
  'net_http_response_prune',
  'ws45_forecasts_ingest'
);

select status, count(*)
from public.managed_scheduler_queue
group by status
order by status;

select edge_job_slug, scheduled_for, started_at, (started_at - scheduled_for) as delay
from public.managed_scheduler_queue
where started_at is not null
order by delay desc nulls last
limit 20;

select job_name, started_at, ended_at, success, error, stats
from public.ingestion_runs
where started_at >= '2026-04-08 05:00:00+00'
  and job_name in (
    'monitoring_check',
    'spacex_drone_ship_ingest',
    'ws45_forecasts_ingest',
    'ws45_live_weather_ingest',
    'ws45_planning_forecast_ingest'
  )
order by started_at asc;

select calls,
       round((total_exec_time / 1000.0)::numeric, 1) as total_exec_s,
       round(mean_exec_time::numeric, 2) as mean_exec_ms,
       left(regexp_replace(query, '\s+', ' ', 'g'), 180) as query_sample
from pg_stat_statements
where query ilike '%invoke_ll2_incremental_burst%'
   or query ilike '%managed_scheduler_tick%'
   or query ilike '%prune_net_http_response%'
   or query ilike '%prune_cron_job_run_details%'
   or query ilike '%invoke_edge_job%'
order by total_exec_time desc;

select id, status_code, error_msg, created, content_type
from net._http_response
order by created desc
limit 20;

select round(pg_database_size(current_database()) / 1024.0 / 1024.0, 1) as db_size_mb;
```

### REST probes used for the stability watch

```bash
curl -sS -o /dev/null -w '%{http_code} %{time_total}' \
  --max-time 12 \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/ll2_catalog_public_cache?select=entity_type,entity_id&limit=1" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_ANON_KEY"

curl -sS -o /dev/null -w '%{http_code} %{time_total}' \
  --max-time 12 \
  "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/system_settings?select=key&key=eq.jobs_enabled" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
