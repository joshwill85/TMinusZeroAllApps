# Supabase WS45 Recovery Runbook

Date: April 8, 2026

## Scope

- Customer-facing or admin/internal: admin/internal incident recovery
- Web: included
- iOS: not included
- Android: not included
- Shared API/backend impact: yes

## Problem Statement

Production is showing two overlapping failure modes:

1. WS45 schema drift:
   - current code expects `public.ws45_launch_forecasts.document_family`
   - current code expects `public.ws45_launch_forecasts.publish_eligible`
   - those columns are added by [20260405120000_ws45_quality_and_admin_monitoring.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405120000_ws45_quality_and_admin_monitoring.sql)

2. Database pressure:
   - admin SQL and Supabase advisor checks time out
   - public API calls have returned `522`
   - manual migrations are failing before they can land

This means the recovery sequence cannot be "just rerun the migration until it works." Pressure needs to come down first.

## Evidence Update From Logs

The first clear failures were not broad read queries. They were scheduler-driven function calls:

1. `POST 504 /functions/v1/ll2-incremental-burst`
   - request source: `pg_net/0.19.5`
   - execution time: about `150330ms`
   - timestamp: April 8, 2026 at `07:17:30 GMT`

2. `POST 504 /functions/v1/spacex-drone-ship-ingest`
   - request source: `pg_net/0.19.5`
   - execution time: about `150559ms`
   - timestamp: April 8, 2026 at `07:17:30 GMT`

Later failures were widespread `GET 522` responses across unrelated REST reads, including both anon and service-role traffic. That pattern is consistent with scheduler or database saturation causing the later API collapse.

## Recovery Goal

Land the missing WS45 schema with the smallest possible write footprint, then defer historical backfill and new WS45 job activation until the database is responsive again.

## Repo Changes Supporting Recovery

1. [20260405120000_ws45_quality_and_admin_monitoring.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405120000_ws45_quality_and_admin_monitoring.sql)
   - now schema-only
   - no longer runs a full-table backfill during migration

2. [20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql)
   - adds batch helpers for deferred backfill
   - does not auto-run during migration

3. [20260408143000_ws45_live_board_and_planning.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260408143000_ws45_live_board_and_planning.sql)
   - new WS45 jobs now default to disabled

4. [pause_ws45_recovery_jobs.sql](/Users/petpawlooza/TMinusZero%20AllApps/docs/sql/pause_ws45_recovery_jobs.sql)
   - targeted pause script for incident response

## Stop First

Use the targeted pause script before retrying migrations:

- [pause_ws45_recovery_jobs.sql](/Users/petpawlooza/TMinusZero%20AllApps/docs/sql/pause_ws45_recovery_jobs.sql)

It disables:

- `ll2_backfill_job_enabled`
- `rocket_media_backfill_job_enabled`
- `ll2_payload_backfill_job_enabled`
- `notifications_dispatch_job_enabled`
- `notifications_send_job_enabled`
- `ws45_live_weather_job_enabled`
- `ws45_planning_forecast_job_enabled`
- `ws45_weather_retention_cleanup_enabled`

It also:

- sets `enabled=false` for managed scheduler rows:
  - `ws45_live_weather_ingest`
  - `ws45_planning_forecast_ingest`
  - `ws45_weather_retention_cleanup`
- unschedules classic `cron.job` entries where they exist:
  - `ll2_backfill`
  - `rocket_media_backfill`
  - `ll2_payload_backfill`
  - `notifications_dispatch`
  - `notifications_send`

This is intentionally narrower than setting `jobs_enabled=false`.

## Aggressive Escalation

If the narrower pause script is not enough, use:

- [pause_ws45_recovery_jobs_aggressive.sql](/Users/petpawlooza/TMinusZero%20AllApps/docs/sql/pause_ws45_recovery_jobs_aggressive.sql)

This additionally disables:

- `ll2_incremental_job_enabled`
- `spacex_drone_ship_ingest_enabled`

And it disables the managed scheduler row:

- `spacex_drone_ship_ingest`

Blast radius:

- premium live launch refresh pauses
- SpaceX drone ship assignment refresh pauses

Do not apply this wider pause unless the narrower script cannot recover a usable SQL window.

## Migration Order

1. Apply [20260405120000_ws45_quality_and_admin_monitoring.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405120000_ws45_quality_and_admin_monitoring.sql)
2. Apply [20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql)
3. Apply [20260408143000_ws45_live_board_and_planning.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260408143000_ws45_live_board_and_planning.sql) only after the earlier schema lands

## Backfill Order

Do not start backfill during the incident if SQL is still timing out.

Once the database is responsive, run the helpers in small loops until they return `0`:

```sql
select public.ws45_backfill_launch_forecast_quality_batch(100);
select public.ws45_seed_parse_runs_batch(100);
select public.ws45_sync_latest_parse_run_ids_batch(100);
```

Raise the batch size only after the database remains healthy.

## Verification Checks

After the pause script:

```sql
select key, value
from public.system_settings
where key in (
  'll2_backfill_job_enabled',
  'rocket_media_backfill_job_enabled',
  'll2_payload_backfill_job_enabled',
  'notifications_dispatch_job_enabled',
  'notifications_send_job_enabled',
  'ws45_live_weather_job_enabled',
  'ws45_planning_forecast_job_enabled',
  'ws45_weather_retention_cleanup_enabled'
)
order by key;
```

```sql
select cron_job_name, enabled, next_run_at, updated_at
from public.managed_scheduler_jobs
where cron_job_name in (
  'ws45_live_weather_ingest',
  'ws45_planning_forecast_ingest',
  'ws45_weather_retention_cleanup'
)
order by cron_job_name;
```

After the schema migration:

```sql
select column_name
from information_schema.columns
where table_schema = 'public'
  and table_name = 'ws45_launch_forecasts'
  and column_name in (
    'document_mode',
    'document_family',
    'classification_confidence',
    'parse_status',
    'parse_confidence',
    'publish_eligible',
    'quarantine_reasons',
    'required_fields_missing',
    'normalization_flags',
    'latest_parse_run_id'
  )
order by column_name;
```

## Escalation Threshold

If the targeted pause script cannot run because admin SQL still times out, stop treating this as a migration-only problem. At that point:

1. do not keep retrying full migrations blindly
2. capture the failed SQL timestamps
3. open a Supabase support incident with the project ref and timeout evidence

## Re-enable Order

After migrations and backfills are complete:

1. re-enable `ws45_live_weather_job_enabled`
2. re-enable `ws45_planning_forecast_job_enabled`
3. re-enable `ws45_weather_retention_cleanup_enabled` if that job exists in the target environment
4. re-enable payload backfill or notifications only if still needed

Do not re-enable everything at once.
