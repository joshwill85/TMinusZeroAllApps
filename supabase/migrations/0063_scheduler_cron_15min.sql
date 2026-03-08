-- Expose cron job schedules to admins and align ingestion cycle with 15-minute cadence.

create or replace function public.get_cron_jobs(job_names text[])
returns table (
  jobname text,
  schedule text,
  active boolean
)
language sql
security definer
set search_path = public, cron
as $$
  select jobname, schedule, active
  from cron.job
  where jobname = any(job_names)
    and public.is_admin()
  order by jobname;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ingestion_cycle') then
    perform cron.unschedule('ingestion_cycle');
  end if;
  perform cron.schedule('ingestion_cycle', '*/15 * * * *', $job$select public.invoke_edge_job('ingestion-cycle');$job$);

  if exists (select 1 from cron.job where jobname = 'monitoring_check') then
    perform cron.unschedule('monitoring_check');
  end if;
  perform cron.schedule('monitoring_check', '*/5 * * * *', $job$select public.invoke_edge_job('monitoring-check');$job$);
end $$;
