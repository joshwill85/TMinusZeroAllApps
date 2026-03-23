## Cron / Schedules
- LL2 incremental cadence: Supabase `pg_cron` triggers `public.invoke_ll2_incremental_burst()` every minute to achieve the ~15s premium cadence. In legacy mode it calls Edge Function `ll2-incremental` multiple times with `pg_sleep`; with `system_settings.ll2_incremental_use_edge_burst=true` it triggers Edge Function `ll2-incremental-burst` once and the 15s loop happens in Edge (no Postgres sleep loop).
- Ingestion cadence: Supabase `pg_cron` calls Edge Function `ingestion-cycle` every 15 minutes (LL2 event CDC + SNAPI ingest + public cache refresh). Settings live in `system_settings` (`jobs_enabled`, `jobs_base_url`, `jobs_apikey`, `jobs_auth_token`); `jobs_apikey` is the Supabase anon/service key for the Edge gateway and `jobs_auth_token` is sent as `x-job-token`.
- CelesTrak launch inventory cadence: `celestrak-ingest` claims INTDES datasets via `claim_celestrak_intdes_datasets`, using adaptive recency windows from `system_settings`:
  - `celestrak_intdes_recent_window_days` (default `180`)
  - `celestrak_intdes_recent_min_interval_seconds` (default `21600` / 6h)
  - `celestrak_intdes_legacy_min_interval_seconds` (default `2592000` / 30d)
  Recent launches are polled faster; legacy designators back off to reduce write churn.
- LL2 catalog cadence: Supabase `pg_cron` calls Edge Function `ll2-catalog` every 20 minutes to backfill global LL2 catalog endpoints (agencies, astronauts, space stations, expeditions, docking events, launcher configurations, launchers, spacecraft configurations, locations, pads, events) into base tables + public cache.
- LL2 catalog joins: `ll2-catalog` can optionally refresh astronaut + launcher flight join tables (settings `ll2_catalog_astronaut_flights_*`, `ll2_catalog_launcher_flights_*`) for richer launch cross-links.
- Rocket reuse KPIs (Max flights / Avg flights per core) depend on `ll2_launcher_launches`; zeros typically mean the launcher flight joins are empty.
- Backfill launcher flights: enable `system_settings.ll2_catalog_launcher_flights_enabled` and let the scheduled `ll2-catalog` job drain `ll2_catalog_launcher_flights_offset` back to 0.
- Force a full re-run: set the relevant `ll2_catalog_*_offset` keys back to 0 (and keep `ll2_catalog_job_enabled` true); `ll2-catalog` will resume backfilling on its next runs.
- LL2 payload/spacecraft manifest backfill: Edge Function `ll2-payload-backfill` drains historical launches to populate payload manifest tables (migration `0133`) and spacecraft manifest tables (migration `0135`). To backfill only spacecraft tables, set `system_settings.ll2_payload_backfill_spacecraft_only=true`. When the backfill is complete, disable + unschedule it to avoid minute-level no-op scheduler churn.
- CDC cadence: LL2 incremental uses a cursor watermark; SNAPI uses high-water marks with an overlap window.
- Monitoring cadence: Supabase `pg_cron` calls `monitoring-check` every 5 minutes to populate `ops_alerts` for the admin UI.
- Notifications cadence: Supabase `pg_cron` calls `notifications-dispatch` every 2 minutes and `notifications-send` every minute to queue and deliver notifications (SMS, push, email) when enabled.
- SpaceX launch-content ingest: Supabase `pg_cron` calls `spacex-infographics-ingest` daily to cache normalized `content.spacex.com` mission bundles into `launch_external_resources` for launch detail pages, while writing lightweight `mission_infographic` and `landing_hint` constraint rows only when those trajectory/display hints are present.
- NAVCEN BNM hazard ingest: managed scheduler runs `navcen-bnm-ingest` hourly to ingest District 7 (SE US) GovDelivery RSS items, resolve NAVCEN BNM message GUIDs, and store parsed hazard areas for trajectory constraints.
- FAA trajectory hazard ingest: managed scheduler runs `faa-trajectory-hazard-ingest` hourly to project matched FAA TFR shapes into `launch_trajectory_constraints` (`constraint_type='hazard_area'`) for additional hazard coverage.
- Social launch posts: managed scheduler runs `social-posts-dispatch` every 30 minutes (`social_posts_dispatch` interval 1800s, offset 480s; fallback `pg_cron` is `8,38 * * * *` when present) to post automated launch-day updates (X + optional Facebook Page) between 8:00–11:00 AM local pad time (with a 15-minute grace window to tolerate scheduler jitter; US pads only; config in `system_settings` + `UPLOAD_POST_API_KEY`; Facebook requires `social_posts_facebook_page_id`). Launch-day base posts attach the launch OG/share image as media and **do not include URLs** (no link replies/comments). If a launch-day send fails, the dispatcher keeps retrying via send-lock claims until the launch-day retry deadline; if a launch’s NET slips to a new local day, a new base post is queued for that new day (one per day per platform). Subsequent timing/status updates are driven by `launch_updates` (`social_posts_updates_enabled`) as replies in-thread on X and standalone posts on Facebook.
- Trajectory orbit ingest: managed scheduler runs `trajectory-orbit-ingest` hourly (staggered) to fetch & parse official mission documents (press kits / mission overviews) linked in LL2, caching document versions and conditionally merging `target_orbit` constraints (inclination/azimuth when present).
- Trajectory constraints ingest: managed scheduler runs `trajectory-constraints-ingest` hourly (staggered) to fetch LL2 landings for top eligible launches, refresh `ll2_launch_landings`, and conditionally merge `launch_trajectory_constraints` (`constraint_type='landing'`).
- Trajectory products generate: managed scheduler runs `trajectory-products-generate` hourly (staggered) to refresh `launch_trajectory_products` for top eligible upcoming launches while skipping materially unchanged rows.
- Opportunistic trajectory follow-up triggers: existing source ingests (`trajectory-orbit-ingest`, `trajectory-constraints-ingest`, `navcen-bnm-ingest`, `faa-trajectory-hazard-ingest`) can request an immediate follow-up run of the existing `trajectory-products-generate` job when fresh evidence lands. These are coalesced by `system_settings.trajectory_products_followup_cooldown_seconds` (default `90`) so multiple near-simultaneous source updates collapse into one generator wake-up instead of a burst of redundant runs.
- Artemis budget + procurement ingest: Supabase `pg_cron` calls `artemis-budget-ingest` weekly (Monday UTC) and `artemis-procurement-ingest` daily (04:47 UTC). `artemis-procurement-ingest` sequences USASpending scope pulls in priority order (`artemis` first, then `blue-origin`, then `spacex`) and tags rows with scope metadata.
- Artemis contracts ingest: Supabase `pg_cron` calls `artemis-contracts-ingest` three times daily (05:17, 13:17, 21:17 UTC) for SAM backfill throughput under non-federal limits. Each run applies SAM guardrails using `artemis_sam_quota_state` (daily limit/reserve) plus `artemis_sam_max_requests_per_run`.
- Blue Origin ingestion chain: Supabase `pg_cron` runs a weekly Blue Origin sequence on Monday UTC with 90-minute spacing between jobs: `blue-origin-bootstrap` (00:00), `blue-origin-missions-ingest` (01:30), `blue-origin-news-ingest` (03:00), `blue-origin-media-ingest` (04:30), `blue-origin-passengers-ingest` (06:00), `blue-origin-payloads-ingest` (07:30), `blue-origin-contracts-ingest` (09:00), `blue-origin-social-ingest` (10:30), `blue-origin-snapshot-build` (12:00).
- US-only filter: `ll2_us_location_ids` stores cached LL2 location IDs for USA pads (refreshed daily by `ingestion-cycle`).
- SNAPI ingestion: performed inside `ingestion-cycle` (Spaceflight News API v4).
- LL2 event ingestion: performed inside `ingestion-cycle` when `ll2_event_ingest_enabled` is true, fetching SNAPI-linked LL2 event IDs in small batches.
- Local runner: production should rely on Supabase cron + Edge Functions; local one-off ingestion scripts were removed to avoid drift from server behavior.

## Temporary Pause (2026-02-20)
- Notifications + payload backfill were intentionally paused to reduce Disk IO while notifications are inactive and payload backfill is already complete.
- Applied state:
  - `system_settings.notifications_dispatch_job_enabled=false`
  - `system_settings.notifications_send_job_enabled=false`
  - `system_settings.ll2_payload_backfill_job_enabled=false`
  - cron unscheduled: `notifications_dispatch`, `notifications_send`, `ll2_payload_backfill`
- SQL helper: `docs/sql/pause_notifications_and_payload_backfill.sql`

## AR Operational Release Gate (Profile Policy)
- Release gate source of truth: `docs/ar-trajectory-qa-matrix.md`.
- Must-pass profile buckets per release:
  - `android_chrome`
  - `android_samsung_internet`
  - `ios_webkit`
  - `android_fallback`
- For each candidate release, attach manual matrix evidence (A-F checks) plus telemetry verification from `public.ar_camera_guide_sessions` for `client_profile` and fallback/mode distributions.
- Do not promote if any must-pass profile has unresolved permission dead-ends, fallback regressions, or broken telemetry rows.

## Trajectory Freshness SLOs (Monitoring)
- `monitoring-check` now evaluates trajectory source freshness for current eligible launches (`system_settings.trajectory_products_top3_ids`) in addition to cron heartbeat staleness.
- Source freshness uses the newer of:
  - latest material constraint write (`launch_trajectory_constraints.fetched_at`)
  - latest successful source poll run (`ingestion_runs` for source ingest jobs)
- Ingest stats now include per-launch coverage counters in `ingestion_runs.stats.launchCoverage` for:
  - `trajectory_orbit_ingest`
  - `trajectory_constraints_ingest`
  - `navcen_bnm_ingest`
  - `faa_trajectory_hazard_ingest`
- Settings keys (all optional; defaults shown):
  - `trajectory_source_freshness_alerts_enabled` = `true`
  - `trajectory_freshness_orbit_max_age_hours` = `12`
  - `trajectory_freshness_landing_max_age_hours` = `12`
  - `trajectory_freshness_hazard_max_age_hours` = `3`
- Alert keys emitted in `ops_alerts`:
  - `trajectory_products_missing_for_eligible`
  - `trajectory_products_precision_stale`
  - `trajectory_source_orbit_stale`
  - `trajectory_source_landing_stale`
  - `trajectory_source_hazard_stale`
- Operator runbook:
  - If source alerts fire, inspect latest `ingestion_runs` for `trajectory_orbit_ingest`, `trajectory_constraints_ingest`, `navcen_bnm_ingest`, and `faa_trajectory_hazard_ingest`.
  - If jobs are healthy but alerts persist, check source coverage gaps in `launch_trajectory_constraints` for affected launch IDs.
  - Tighten/relax thresholds only after a week of observed run cadence and source behavior.

## LL2 Archive Notes
- `last_updated` is a *change timestamp*, not an archive timestamp (historical launches may share a relatively recent `last_updated` if the record was imported/normalized later).
- Observed (from Supabase `launches` table):
  - earliest `net`: `1967-03-16T17:30:00Z`
  - latest `net`: `2031-09-30T00:00:00Z`
  - earliest `last_updated_source`: `2023-06-14T03:30:56Z`
  - latest `last_updated_source`: `2026-01-04T02:29:04Z`
- LL2 does not publish an explicit data-retention/purge SLA on the public docs; confirm archive guarantees with The Space Devs if this will be customer-facing BI.

## One-off: spacecraft manifest backfill (migration `0135`)
The spacecraft manifest tables are populated by the `ll2-payload-backfill` Edge Function. To backfill only the spacecraft manifest tables:

```sql
-- Enable spacecraft-only mode + reset the backfill cursor.
insert into public.system_settings (key, value)
values
  ('ll2_payload_backfill_spacecraft_only', 'true'::jsonb),
  ('ll2_payload_backfill_job_enabled', 'true'::jsonb),
  ('ll2_payload_backfill_cursor', '"1960-01-01T00:00:00Z"'::jsonb),
  ('ll2_payload_backfill_offset', '0'::jsonb),
  ('ll2_payload_backfill_done', 'false'::jsonb),
  ('ll2_payload_backfill_completed_at', 'null'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

-- Reschedule the job to run every minute (remove if you will trigger manually).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_payload_backfill') then
    perform cron.unschedule('ll2_payload_backfill');
  end if;
  perform cron.schedule('ll2_payload_backfill', '* * * * *', $job$select public.invoke_edge_job('ll2-payload-backfill');$job$);
end $$;
```

Monitor progress via `system_settings.ll2_payload_backfill_done` and `ingestion_runs` where `job_name='ll2_payload_backfill_page'`.

After completion, you can pause it again:

```sql
insert into public.system_settings (key, value)
values
  ('ll2_payload_backfill_job_enabled', 'false'::jsonb),
  ('ll2_payload_backfill_spacecraft_only', 'false'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_payload_backfill') then
    perform cron.unschedule('ll2_payload_backfill');
  end if;
end $$;
```
