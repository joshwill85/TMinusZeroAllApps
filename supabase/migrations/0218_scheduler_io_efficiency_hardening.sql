-- Reduce scheduler-induced IO overhead without changing user-facing product behavior.
--
-- This migration targets three pressure points:
-- 1) restore LL2 burst scheduler to 1/min cadence (live drift showed 15-second cadence)
-- 2) make ops-metrics collector scheduling state-driven (disabled => unscheduled)
-- 3) shrink cron.job_run_details read/write amplification (indexes + retention pruning)

-- 1) LL2 burst scheduler cadence hardening.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'll2_incremental_burst') then
    perform cron.unschedule('ll2_incremental_burst');
  end if;

  perform cron.schedule(
    'll2_incremental_burst',
    '* * * * *',
    $job$select public.invoke_ll2_incremental_burst();$job$
  );
end $$;

-- 2) Ops metrics scheduler should only exist when collection is enabled.
create or replace function public.sync_ops_metrics_collect_schedule()
returns void
language plpgsql
security definer
set search_path = public, cron, pg_catalog
as $$
declare
  enabled boolean := false;
begin
  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into enabled
  from public.system_settings
  where key = 'ops_metrics_collection_enabled';

  if exists (select 1 from cron.job where jobname = 'ops_metrics_collect') then
    perform cron.unschedule('ops_metrics_collect');
  end if;

  if enabled then
    -- 5-minute cadence is sufficient for operational trend visibility while cutting scheduler churn.
    perform cron.schedule(
      'ops_metrics_collect',
      '*/5 * * * *',
      $job$select public.invoke_edge_job('ops-metrics-collect');$job$
    );
  end if;
end;
$$;

create or replace function public.trg_sync_ops_metrics_collect_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.key = 'ops_metrics_collection_enabled' then
    perform public.sync_ops_metrics_collect_schedule();
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_ops_metrics_collect_schedule() from public;
grant execute on function public.sync_ops_metrics_collect_schedule() to service_role;

revoke execute on function public.trg_sync_ops_metrics_collect_schedule() from public;
grant execute on function public.trg_sync_ops_metrics_collect_schedule() to service_role;

drop trigger if exists system_settings_sync_ops_metrics_collect_schedule on public.system_settings;

create trigger system_settings_sync_ops_metrics_collect_schedule
after insert or update of value on public.system_settings
for each row
when (new.key = 'ops_metrics_collection_enabled')
execute function public.trg_sync_ops_metrics_collect_schedule();

-- Apply scheduler state now.
select public.sync_ops_metrics_collect_schedule();

-- 3) cron.job_run_details IO pressure controls.
-- Note: These indexes require ownership of cron.job_run_details.
-- In hosted Supabase, they may already exist or require manual creation via dashboard.
do $$
begin
  create index if not exists cron_job_run_details_status_idx on cron.job_run_details (status);
exception when insufficient_privilege then
  raise notice 'Skipping cron_job_run_details_status_idx: insufficient privileges';
end $$;

do $$
begin
  create index if not exists cron_job_run_details_runid_idx on cron.job_run_details (runid);
exception when insufficient_privilege then
  raise notice 'Skipping cron_job_run_details_runid_idx: insufficient privileges';
end $$;

do $$
begin
  create index if not exists cron_job_run_details_end_time_idx on cron.job_run_details (end_time);
exception when insufficient_privilege then
  raise notice 'Skipping cron_job_run_details_end_time_idx: insufficient privileges';
end $$;

create or replace function public.prune_cron_job_run_details(
  retain interval default interval '48 hours',
  batch_limit int default 50000
)
returns int
language plpgsql
security definer
set search_path = public, cron, pg_catalog
as $$
declare
  v_limit int := greatest(100, least(coalesce(batch_limit, 50000), 500000));
  v_deleted int := 0;
begin
  with doomed as (
    select ctid
    from cron.job_run_details
    where coalesce(end_time, start_time) < now() - retain
    order by coalesce(end_time, start_time) asc
    limit v_limit
  ), deleted_rows as (
    delete from cron.job_run_details d
    using doomed
    where d.ctid = doomed.ctid
    returning 1
  )
  select count(*) into v_deleted from deleted_rows;

  return v_deleted;
end;
$$;

revoke execute on function public.prune_cron_job_run_details(interval, int) from public;
grant execute on function public.prune_cron_job_run_details(interval, int) to service_role;

-- Keep cron run-details retention tight to avoid scan amplification.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'cron_job_run_details_prune') then
    perform cron.unschedule('cron_job_run_details_prune');
  end if;

  perform cron.schedule(
    'cron_job_run_details_prune',
    '7 * * * *',
    $job$select public.prune_cron_job_run_details(interval '48 hours', 50000);$job$
  );
end $$;

-- One immediate prune batch to start reducing table size right away.
select public.prune_cron_job_run_details(interval '48 hours', 50000);
