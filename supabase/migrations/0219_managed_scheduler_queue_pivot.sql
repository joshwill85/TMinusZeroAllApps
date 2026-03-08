-- Pivot high-frequency pg_cron jobs to a single scheduler tick + managed queue.
--
-- Goals:
-- - Reduce cron.job_run_details churn from many cron entries.
-- - Keep job dispatch semantics via public.invoke_edge_job(job_slug).
-- - Preserve admin cron visibility through get_all_cron_jobs() synthetic rows.

insert into public.system_settings (key, value)
values
  ('managed_scheduler_enabled', 'true'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create table if not exists public.managed_scheduler_jobs (
  cron_job_name text primary key,
  edge_job_slug text not null,
  interval_seconds int not null check (interval_seconds between 60 and 604800),
  offset_seconds int not null default 0 check (offset_seconds >= 0),
  enabled boolean not null default true,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  next_run_at timestamptz not null default now(),
  last_enqueued_at timestamptz,
  last_dispatched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint managed_scheduler_jobs_offset_lt_interval check (offset_seconds < interval_seconds)
);

create index if not exists managed_scheduler_jobs_due_idx
  on public.managed_scheduler_jobs (enabled, next_run_at asc);

create table if not exists public.managed_scheduler_queue (
  id bigint generated always as identity primary key,
  cron_job_name text not null references public.managed_scheduler_jobs(cron_job_name) on delete cascade,
  edge_job_slug text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  error text,
  locked_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists managed_scheduler_queue_job_scheduled_uniq
  on public.managed_scheduler_queue (cron_job_name, scheduled_for);

create index if not exists managed_scheduler_queue_claim_idx
  on public.managed_scheduler_queue (status, scheduled_for asc, id asc);

create index if not exists managed_scheduler_queue_finished_idx
  on public.managed_scheduler_queue (status, coalesce(finished_at, created_at) asc);

alter table public.managed_scheduler_jobs enable row level security;
alter table public.managed_scheduler_queue enable row level security;

revoke all on table public.managed_scheduler_jobs from public;
revoke all on table public.managed_scheduler_jobs from anon, authenticated;
grant all on table public.managed_scheduler_jobs to service_role;

revoke all on table public.managed_scheduler_queue from public;
revoke all on table public.managed_scheduler_queue from anon, authenticated;
grant all on table public.managed_scheduler_queue to service_role;

create or replace function public.managed_scheduler_next_run(
  at_ts timestamptz,
  interval_seconds int,
  offset_seconds int
)
returns timestamptz
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select to_timestamp(
    (
      (
        floor(
          (
            extract(epoch from at_ts)::numeric
            - greatest(0, offset_seconds)::numeric
          ) / greatest(1, interval_seconds)::numeric
        ) + 1
      ) * greatest(1, interval_seconds)::numeric
      + greatest(0, offset_seconds)::numeric
    )::double precision
  )
$$;

create or replace function public.managed_scheduler_enqueue_due(limit_n int default 100)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(limit_n, 100), 1000));
  v_count int := 0;
begin
  with due as (
    select
      j.cron_job_name,
      j.edge_job_slug,
      j.next_run_at,
      j.max_attempts,
      public.managed_scheduler_next_run(now(), j.interval_seconds, j.offset_seconds) as next_due
    from public.managed_scheduler_jobs j
    where j.enabled = true
      and j.next_run_at <= now()
    order by j.next_run_at asc
    for update skip locked
    limit v_limit
  ), advanced as (
    update public.managed_scheduler_jobs j
    set next_run_at = due.next_due,
        last_enqueued_at = now(),
        updated_at = now()
    from due
    where j.cron_job_name = due.cron_job_name
    returning due.cron_job_name, due.edge_job_slug, due.next_run_at as scheduled_for, due.max_attempts
  ), ins as (
    insert into public.managed_scheduler_queue (
      cron_job_name,
      edge_job_slug,
      scheduled_for,
      status,
      attempts,
      max_attempts
    )
    select
      a.cron_job_name,
      a.edge_job_slug,
      a.scheduled_for,
      'queued',
      0,
      a.max_attempts
    from advanced a
    on conflict (cron_job_name, scheduled_for) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;

create or replace function public.prune_managed_scheduler_queue(
  retain interval default interval '7 days',
  batch_limit int default 5000
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := greatest(100, least(coalesce(batch_limit, 5000), 50000));
  v_deleted int := 0;
begin
  with doomed as (
    select ctid
    from public.managed_scheduler_queue
    where status in ('sent', 'failed')
      and coalesce(finished_at, created_at) < now() - retain
    order by coalesce(finished_at, created_at) asc
    limit v_limit
  ), deleted_rows as (
    delete from public.managed_scheduler_queue q
    using doomed
    where q.ctid = doomed.ctid
    returning 1
  )
  select count(*) into v_deleted from deleted_rows;

  return v_deleted;
end;
$$;

create or replace function public.managed_scheduler_tick(
  enqueue_limit int default 200,
  process_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_enqueue_limit int := greatest(1, least(coalesce(enqueue_limit, 200), 1000));
  v_process_limit int := greatest(1, least(coalesce(process_limit, 100), 500));
  v_enqueued int := 0;
  v_sent int := 0;
  v_failed int := 0;
  v_requeued int := 0;
  v_pruned int := 0;
  v_managed_enabled boolean := true;
  v_jobs_enabled boolean := false;
  v_now timestamptz := now();
  item record;
begin
  if not pg_try_advisory_xact_lock(hashtext('managed_scheduler_tick')::bigint) then
    return jsonb_build_object('ok', true, 'skipped', 'locked');
  end if;

  select
    coalesce(
      (
        select case
          when jsonb_typeof(s.value) = 'boolean' then (s.value::boolean)
          when jsonb_typeof(s.value) = 'string' then lower(trim(both '"' from s.value::text)) = 'true'
          else true
        end
        from public.system_settings s
        where s.key = 'managed_scheduler_enabled'
      ),
      true
    )
  into v_managed_enabled;

  if not v_managed_enabled then
    return jsonb_build_object('ok', true, 'skipped', 'managed_scheduler_disabled');
  end if;

  select
    coalesce(
      (
        select case
          when jsonb_typeof(s.value) = 'boolean' then (s.value::boolean)
          when jsonb_typeof(s.value) = 'string' then lower(trim(both '"' from s.value::text)) = 'true'
          else false
        end
        from public.system_settings s
        where s.key = 'jobs_enabled'
      ),
      false
    )
  into v_jobs_enabled;

  if not v_jobs_enabled then
    return jsonb_build_object('ok', true, 'skipped', 'jobs_disabled');
  end if;

  v_enqueued := public.managed_scheduler_enqueue_due(v_enqueue_limit);

  for item in
    with claim as (
      select q.id
      from public.managed_scheduler_queue q
      where q.status = 'queued'
        and q.scheduled_for <= now()
      order by q.scheduled_for asc, q.id asc
      limit v_process_limit
      for update skip locked
    ), sending as (
      update public.managed_scheduler_queue q
      set status = 'sending',
          attempts = q.attempts + 1,
          locked_at = now(),
          started_at = now(),
          error = null,
          updated_at = now()
      from claim
      where q.id = claim.id
      returning
        q.id,
        q.cron_job_name,
        q.edge_job_slug,
        q.attempts,
        q.max_attempts
    )
    select * from sending
  loop
    begin
      perform public.invoke_edge_job(item.edge_job_slug);

      update public.managed_scheduler_queue
      set status = 'sent',
          finished_at = now(),
          locked_at = null,
          updated_at = now()
      where id = item.id;

      update public.managed_scheduler_jobs
      set last_dispatched_at = now(),
          last_error = null,
          updated_at = now()
      where cron_job_name = item.cron_job_name;

      v_sent := v_sent + 1;
    exception when others then
      if item.attempts < item.max_attempts then
        update public.managed_scheduler_queue
        set status = 'queued',
            scheduled_for = now() + interval '2 minutes',
            error = left(sqlerrm, 900),
            locked_at = null,
            started_at = null,
            updated_at = now()
        where id = item.id;

        v_requeued := v_requeued + 1;
      else
        update public.managed_scheduler_queue
        set status = 'failed',
            error = left(sqlerrm, 900),
            finished_at = now(),
            locked_at = null,
            updated_at = now()
        where id = item.id;

        v_failed := v_failed + 1;
      end if;

      update public.managed_scheduler_jobs
      set last_error = left(sqlerrm, 900),
          updated_at = now()
      where cron_job_name = item.cron_job_name;
    end;
  end loop;

  if extract(minute from v_now)::int = 0 then
    v_pruned := public.prune_managed_scheduler_queue(interval '7 days', 5000);
  end if;

  return jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'sent', v_sent,
    'failed', v_failed,
    'requeued', v_requeued,
    'pruned', v_pruned
  );
end;
$$;

revoke execute on function public.managed_scheduler_next_run(timestamptz, int, int) from public;
grant execute on function public.managed_scheduler_next_run(timestamptz, int, int) to service_role;

revoke execute on function public.managed_scheduler_enqueue_due(int) from public;
grant execute on function public.managed_scheduler_enqueue_due(int) to service_role;

revoke execute on function public.prune_managed_scheduler_queue(interval, int) from public;
grant execute on function public.prune_managed_scheduler_queue(interval, int) to service_role;

revoke execute on function public.managed_scheduler_tick(int, int) from public;
grant execute on function public.managed_scheduler_tick(int, int) to service_role;

insert into public.managed_scheduler_jobs (
  cron_job_name,
  edge_job_slug,
  interval_seconds,
  offset_seconds,
  enabled,
  max_attempts,
  next_run_at
)
values
  ('ingestion_cycle', 'ingestion-cycle', 900, 60, true, 3, public.managed_scheduler_next_run(now(), 900, 60)),
  ('artemis_bootstrap', 'artemis-bootstrap', 900, 240, true, 3, public.managed_scheduler_next_run(now(), 900, 240)),
  ('spacex_x_post_snapshot', 'spacex-x-post-snapshot', 900, 660, true, 3, public.managed_scheduler_next_run(now(), 900, 660)),
  ('monitoring_check', 'monitoring-check', 1800, 840, true, 3, public.managed_scheduler_next_run(now(), 1800, 840)),
  ('launch_social_refresh', 'launch-social-refresh', 3600, 540, true, 3, public.managed_scheduler_next_run(now(), 3600, 540)),
  ('social_posts_dispatch', 'social-posts-dispatch', 3600, 2280, true, 3, public.managed_scheduler_next_run(now(), 3600, 2280)),
  ('trajectory_orbit_ingest', 'trajectory-orbit-ingest', 3600, 0, true, 3, public.managed_scheduler_next_run(now(), 3600, 0)),
  ('trajectory_constraints_ingest', 'trajectory-constraints-ingest', 3600, 1200, true, 3, public.managed_scheduler_next_run(now(), 3600, 1200)),
  ('trajectory_products_generate', 'trajectory-products-generate', 3600, 2400, true, 3, public.managed_scheduler_next_run(now(), 3600, 2400)),
  ('faa_tfr_ingest', 'faa-tfr-ingest', 3600, 420, true, 3, public.managed_scheduler_next_run(now(), 3600, 420)),
  ('faa_notam_detail_ingest', 'faa-notam-detail-ingest', 3600, 1020, true, 3, public.managed_scheduler_next_run(now(), 3600, 1020)),
  ('faa_launch_match', 'faa-launch-match', 3600, 1620, true, 3, public.managed_scheduler_next_run(now(), 3600, 1620)),
  ('billing_reconcile', 'billing-reconcile', 3600, 3120, true, 3, public.managed_scheduler_next_run(now(), 3600, 3120)),
  ('launch_social_link_backfill', 'launch-social-link-backfill', 14400, 1740, true, 3, public.managed_scheduler_next_run(now(), 14400, 1740)),
  ('ll2_catalog', 'll2-catalog', 7200, 2220, true, 3, public.managed_scheduler_next_run(now(), 7200, 2220)),
  ('ll2_catalog_agencies', 'll2-catalog-agencies', 21600, 3180, true, 3, public.managed_scheduler_next_run(now(), 21600, 3180)),
  ('nws_refresh', 'nws-refresh', 28800, 360, true, 3, public.managed_scheduler_next_run(now(), 28800, 360)),
  ('ws45_forecasts_ingest', 'ws45-forecast-ingest', 28800, 1440, true, 3, public.managed_scheduler_next_run(now(), 28800, 1440))
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    updated_at = now();

-- Replace cron listing RPC so managed jobs remain visible in admin telemetry.
create or replace function public.get_all_cron_jobs()
returns table (
  jobname text,
  schedule text,
  active boolean,
  command text
)
language plpgsql
security definer
set search_path = public, cron, pg_catalog
as $$
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  return query
  with cron_jobs as (
    select
      j.jobname::text as jobname,
      j.schedule::text as schedule,
      j.active::boolean as active,
      j.command::text as command
    from cron.job j
  ), managed_jobs as (
    select
      m.cron_job_name::text as jobname,
      format('managed/%ss offset %ss', m.interval_seconds, m.offset_seconds)::text as schedule,
      m.enabled::boolean as active,
      format('select public.invoke_edge_job(%L); -- managed_scheduler_tick', m.edge_job_slug)::text as command
    from public.managed_scheduler_jobs m
    where not exists (
      select 1
      from cron_jobs c
      where c.jobname = m.cron_job_name
    )
  )
  select c.jobname, c.schedule, c.active, c.command from cron_jobs c
  union all
  select m.jobname, m.schedule, m.active, m.command from managed_jobs m
  order by jobname;
end;
$$;

revoke execute on function public.get_all_cron_jobs() from public;
grant execute on function public.get_all_cron_jobs() to authenticated, service_role;

-- Move selected high-frequency cron jobs to the managed scheduler.
do $$
declare
  rec record;
begin
  for rec in
    select cron_job_name
    from public.managed_scheduler_jobs
  loop
    if exists (select 1 from cron.job where jobname = rec.cron_job_name) then
      perform cron.unschedule(rec.cron_job_name);
    end if;
  end loop;

  if exists (select 1 from cron.job where jobname = 'managed_jobs_tick') then
    perform cron.unschedule('managed_jobs_tick');
  end if;

  perform cron.schedule(
    'managed_jobs_tick',
    '* * * * *',
    $job$select public.managed_scheduler_tick();$job$
  );
end $$;

-- Prime queue once so next tick can process immediate due work quickly.
select public.managed_scheduler_enqueue_due(200);
