# Postgres Failure Audit: Last 3 Hours

Generated from read-only production queries against project `lixuhtyqprseulhdvynq` (`TMinusZero`).

## Scope

- Customer-facing or admin/internal: admin/internal incident audit
- Web: not included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: analysis only

## Audit Window

This audit was assembled from several read-only queries executed across a short sampling span rather than one single snapshot.

- Sampling span:
  - `2026-04-12 20:55` to `21:01` America/New_York
  - `2026-04-13 00:55` to `01:01 UTC`
- Effective audit window:
  - approximately `2026-04-12 17:55` to `21:01` America/New_York
  - approximately `2026-04-12 21:55` to `2026-04-13 01:01 UTC`

## Method

Read-only SQL inspection of:

- `public.ingestion_runs`
- `public.ops_alerts`
- `cron.job_run_details`
- `net._http_response`
- `public.system_settings` keys matching `%last_error%`

Checked and found no failure rows in the same window for:

- `public.managed_scheduler_queue`
- `public.managed_scheduler_jobs`
- `public.webhook_events`
- `public.notifications_outbox`

## Raw Failure Volume

These are raw rows, not deduplicated issue families:

| Source | Rows in window |
| --- | ---: |
| `public.ingestion_runs` | 24 |
| `public.ops_alerts` | 8 |
| `cron.job_run_details` | 4 |
| `net._http_response` | 60 |
| `public.system_settings` `%last_error%` | 1 |

## Unique Error Capture

This section collapses recurring failures into reviewable signatures. `ops_alerts.occurrences` is a rolling counter and is not equivalent to raw row count.

| Error family | Evidence sources | Count / signal | First seen in window | Last seen in window | Representative refs | Notes |
| --- | --- | ---: | --- | --- | --- | --- |
| `HTTP dispatch timeout (5s)` | `net._http_response` | 58 rows | `2026-04-12 23:39:05 UTC` | `2026-04-13 00:58:00 UTC` | `net._http_response.id=2` | Dominant transport failure in the window. These are internal HTTP dispatch timeouts with varying timing breakdowns but the same 5s timeout signature. |
| `HTTP 500` | `net._http_response` | 2 rows | `2026-04-12 23:40:02 UTC` | `2026-04-13 00:27:01 UTC` | `net._http_response.id=8`, `103` | Response bodies identify the underlying app failures as `landingPick is not defined` and `column launches.location_name does not exist`. |
| `job startup timeout` | `cron.job_run_details` | 4 rows | `2026-04-12 23:30:00 UTC` | `2026-04-12 23:32:10 UTC` | `runid=440147`, `440148`, `440149`, `440153` | Affected cron jobs: `managed_jobs_tick` x2, `ll2_incremental_burst` x1, `net_http_response_prune` x1. |
| `ReferenceError: landingPick is not defined` | `public.ingestion_runs`, `public.ops_alerts`, `net._http_response` | 11 failed runs; alert occurrences `150`; HTTP 500 x1 | `2026-04-12 22:00:10 UTC` | `2026-04-13 00:44:07 UTC` | `ingestion_runs.id=267021`, `ops_alerts.id=71`, `net._http_response.id=8` | Primary failing job is `trajectory_products_generate`. This is a code/runtime bug, not a Postgres transport issue. |
| `42703 missing column launches.location_name` | `public.ingestion_runs`, `public.system_settings`, `net._http_response` | 4 failed runs; 1 persisted `last_error`; HTTP 500 x1 | `2026-04-12 22:27:01 UTC` | `2026-04-13 00:27:02 UTC` | `ingestion_runs.id=267053`, `system_settings.key=faa_match_last_error`, `net._http_response.id=103` | Primary failing job is `faa_launch_match`. This is schema drift or query drift against `launches.location_name`. |
| `57014 statement timeout` | `public.ingestion_runs`, `public.ops_alerts` | 4 failed runs directly; multiple alert surfaces | `2026-04-13 00:16:17 UTC` | `2026-04-13 00:44:12 UTC` | `ingestion_runs.id=267203`, `ops_alerts.id=4`, `36`, `152` | Seen in `public_cache_refresh` x3 and `ll2_future_launch_sync` x1. Alert details also show the same timeout under `celestrak_gp_active_failed`. |
| `partial_failure` wrapping `publicCache` timeout | `public.ingestion_runs` | 3 failed runs | `2026-04-13 00:16:10 UTC` | `2026-04-13 00:46:32 UTC` | `ingestion_runs.id=267200` | All `ingestion_cycle` failures in this window wrap a nested `publicCache` error with `57014 canceling statement due to statement timeout`. |
| `partial_failure` in `ws45_planning_forecast_ingest` | `public.ingestion_runs`, `public.ops_alerts` | 1 failed run; alert occurrences `1` | `2026-04-13 00:26:30 UTC` | `2026-04-13 00:44:06 UTC` | `ingestion_runs.id=267214`, `ops_alerts.id=153` | Nested stats show `planning_pdf_ingest` failing with `error: "[object Object]"`, which means the real exception is currently being stringified poorly. |
| `TypeError: error sending request` | `public.ingestion_runs` | 1 failed run | `2026-04-13 00:32:01 UTC` | `2026-04-13 00:32:21 UTC` | `ingestion_runs.id=267222` | `artemis_content_ingest` failed while calling back into Supabase REST. The recorded message includes the internal source IP and request target. |
| `WS45 Florida launch coverage gap` | `public.ops_alerts` | alert occurrences `202` | pre-existing | `2026-04-13 00:44:19 UTC` | `ops_alerts.id=135` | Operational alert, not a SQL exception. Details show upcoming Florida launches missing a publish-eligible 45 WS forecast. |
| `WS45 source page returned no launch forecast PDFs` | `public.ops_alerts` | alert occurrences `131` | pre-existing | `2026-04-13 00:44:19 UTC` | `ops_alerts.id=148` | Operational source failure. Details show the source page returned no forecast PDFs even though one FAQ PDF was found. |
| `CelesTrak gp:active dataset failure` | `public.ops_alerts` | alert occurrences `141` | pre-existing | `2026-04-13 00:44:12 UTC` | `ops_alerts.id=36` | Details show `last_error` is the same `57014 statement timeout` family. |
| `nws_refresh stale` | `public.ops_alerts` | alert occurrences `1777` | pre-existing | `2026-04-12 23:44:06 UTC` | `ops_alerts.id=25` | Operational stale-job alert. Not a direct SQL exception, but it is part of the current degraded state. |

## Wrapper vs Root Cause Notes

Two of the recorded failures are wrappers around deeper problems:

1. `ingestion_cycle -> partial_failure`
   - Nested stats show:
     - `step = publicCache`
     - nested error = `57014 canceling statement due to statement timeout`
2. `ws45_planning_forecast_ingest -> partial_failure`
   - Nested stats show:
     - `step = planning_pdf_ingest`
     - nested error = `"[object Object]"`
   - This means the code is losing the real exception payload before persistence.

## Opaque HTTP 500 Bodies

The two internal `HTTP 500` rows in `net._http_response` are not generic:

- `id=103`
  - body includes `column launches.location_name does not exist`
  - aligns with `faa_launch_match`
- `id=8`
  - body includes `landingPick is not defined`
  - aligns with `trajectory_products_generate`

## Highest-Signal Review Targets

If you want the smallest set of issues to review first, start here:

1. `trajectory_products_generate`
   - recurring runtime bug: `landingPick is not defined`
2. `faa_launch_match`
   - schema/query mismatch: `column launches.location_name does not exist`
3. `public_cache_refresh` and the `publicCache` step inside `ingestion_cycle`
   - repeated `57014` statement timeouts
4. internal HTTP dispatch path
   - `58` separate `5s` timeouts in `net._http_response`
5. cron startup path
   - `4` `job startup timeout` failures around `23:30 UTC`

## Summary

The last 3 hours are not showing one single failure mode. The highest-confidence buckets are:

- repeated internal HTTP dispatch timeouts
- a persistent runtime bug in `trajectory_products_generate`
- a persistent schema/query mismatch in `faa_launch_match`
- repeated statement timeouts affecting `public_cache_refresh`, `ingestion_cycle`, `ll2_future_launch_sync`, and a CelesTrak dataset alert
- ongoing WS45 and NWS operational alert noise on top of the harder failures above
