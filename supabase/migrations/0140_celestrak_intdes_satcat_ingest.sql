-- CelesTrak SATCAT ingest by INTDES (COSPAR launch designator).
--
-- Goal: ensure we can attach "what was put into space" (satellites/payload objects) to every launch
-- that has a launch_designator, including historical/decayed payloads not present in "Current Data" groups.

create table if not exists public.celestrak_intdes_datasets (
  launch_designator text primary key,
  enabled boolean not null default true,
  min_interval_seconds int not null default 2592000, -- 30 days
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  consecutive_failures int not null default 0,
  last_http_status int,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists celestrak_intdes_datasets_due_idx on public.celestrak_intdes_datasets(enabled, last_attempt_at);
create index if not exists celestrak_intdes_datasets_success_idx on public.celestrak_intdes_datasets(enabled, last_success_at);

create or replace function public.claim_celestrak_intdes_datasets(
  batch_size int
)
returns setof public.celestrak_intdes_datasets
language plpgsql
security definer
as $$
declare
  effective_batch_size int := greatest(1, least(coalesce(batch_size, 25), 200));
begin
  return query
  with candidates as (
    select launch_designator
    from public.celestrak_intdes_datasets
    where enabled = true
      and (
        last_attempt_at is null
        or last_attempt_at <= now() - (min_interval_seconds * interval '1 second')
      )
    order by coalesce(last_attempt_at, '1970-01-01'::timestamptz) asc, launch_designator asc
    for update skip locked
    limit effective_batch_size
  )
  update public.celestrak_intdes_datasets d
  set last_attempt_at = now(),
      updated_at = now()
  where d.launch_designator in (select launch_designator from candidates)
  returning d.*;
end;
$$;

alter function public.claim_celestrak_intdes_datasets(int) set search_path = public;
revoke execute on function public.claim_celestrak_intdes_datasets(int) from public;
grant execute on function public.claim_celestrak_intdes_datasets(int) to service_role;

alter table public.celestrak_intdes_datasets enable row level security;
revoke all on table public.celestrak_intdes_datasets from public;
revoke all on table public.celestrak_intdes_datasets from anon, authenticated;
grant all on table public.celestrak_intdes_datasets to service_role;

drop policy if exists "admin manage celestrak intdes datasets" on public.celestrak_intdes_datasets;
create policy "admin manage celestrak intdes datasets"
  on public.celestrak_intdes_datasets for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.system_settings (key, value)
values
  ('celestrak_intdes_job_enabled', 'true'::jsonb),
  ('celestrak_intdes_max_designators_per_run', '25'::jsonb)
on conflict (key) do nothing;

-- Seed initial INTDES queue from existing launches.
insert into public.celestrak_intdes_datasets (launch_designator)
select distinct launch_designator
from public.launches
where launch_designator is not null
  and length(launch_designator) > 0
on conflict (launch_designator) do nothing;

-- Schedule incremental INTDES ingest (fast skip when no work due).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'celestrak_intdes_ingest') then
    perform cron.unschedule('celestrak_intdes_ingest');
  end if;
  perform cron.schedule('celestrak_intdes_ingest', '*/15 * * * *', $job$select public.invoke_edge_job('celestrak-intdes-ingest');$job$);
end $$;

