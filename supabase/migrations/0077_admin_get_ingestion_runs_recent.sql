-- Expose recent ingestion run telemetry per job to admins (per-job limit).

create or replace function public.get_ingestion_runs_recent(
  job_names text[],
  per_job int default 20
)
returns table (
  job_name text,
  started_at timestamptz,
  ended_at timestamptz,
  success boolean,
  error text,
  stats jsonb
)
language sql
security definer
set search_path = public
as $$
  select job_name, started_at, ended_at, success, error, stats
  from (
    select
      ir.job_name,
      ir.started_at,
      ir.ended_at,
      ir.success,
      ir.error,
      ir.stats,
      row_number() over (partition by ir.job_name order by ir.started_at desc) as rn
    from public.ingestion_runs ir
    where ir.job_name = any(job_names)
      and public.is_admin()
  ) ranked
  where rn <= greatest(1, least(per_job, 200))
  order by job_name, started_at desc;
$$;

