-- Allow service-role observability for cron jobs while preserving admin checks.

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
  where public.is_admin() or auth.role() = 'service_role'
  order by jobname;
$$;
