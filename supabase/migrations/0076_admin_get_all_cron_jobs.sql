-- Expose all cron job schedules to admins (pg_cron).

create or replace function public.get_all_cron_jobs()
returns table (
  jobname text,
  schedule text,
  active boolean,
  command text
)
language sql
security definer
set search_path = public, cron
as $$
  select jobname, schedule, active, command
  from cron.job
  where public.is_admin()
  order by jobname;
$$;

