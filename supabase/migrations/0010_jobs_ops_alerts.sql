-- Scheduling + monitoring support for Supabase jobs.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create table if not exists public.ops_alerts (
  id bigserial primary key,
  key text not null unique,
  severity text not null check (severity in ('info','warning','critical')),
  message text not null,
  details jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences int not null default 1,
  resolved boolean not null default false,
  resolved_at timestamptz
);

create index if not exists ops_alerts_resolved_idx on public.ops_alerts(resolved, severity, last_seen_at desc);

alter table public.ops_alerts enable row level security;

drop policy if exists "admin read ops alerts" on public.ops_alerts;
create policy "admin read ops alerts"
  on public.ops_alerts for select
  using (public.is_admin());

drop policy if exists "admin insert ops alerts" on public.ops_alerts;
create policy "admin insert ops alerts"
  on public.ops_alerts for insert
  with check (public.is_admin());

drop policy if exists "admin update ops alerts" on public.ops_alerts;
create policy "admin update ops alerts"
  on public.ops_alerts for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin delete ops alerts" on public.ops_alerts;
create policy "admin delete ops alerts"
  on public.ops_alerts for delete
  using (public.is_admin());

insert into public.system_settings (key, value)
values
  ('jobs_enabled', 'false'::jsonb),
  ('jobs_base_url', '""'::jsonb),
  ('jobs_auth_token', '""'::jsonb),
  ('ll2_us_location_ids', '[]'::jsonb)
on conflict (key) do nothing;

create or replace function public.invoke_edge_job(job_slug text)
returns void
language plpgsql
as $$
declare
  enabled boolean := false;
  base_url text := '';
  auth_token text := '';
  headers jsonb;
begin
  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into enabled
  from public.system_settings
  where key = 'jobs_enabled';

  if not enabled then
    return;
  end if;

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into base_url
  from public.system_settings
  where key = 'jobs_base_url';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into auth_token
  from public.system_settings
  where key = 'jobs_auth_token';

  if base_url = '' then
    raise notice 'jobs_base_url not set';
    return;
  end if;

  headers := jsonb_build_object(
    'Authorization', format('Bearer %s', auth_token),
    'Content-Type', 'application/json'
  );

  perform net.http_post(
    url := base_url || '/' || job_slug,
    headers := headers,
    body := '{}'::jsonb
  );
end;
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ingestion_cycle') then
    perform cron.unschedule('ingestion_cycle');
  end if;
  perform cron.schedule('ingestion_cycle', '*/20 * * * *', $job$select public.invoke_edge_job('ingestion-cycle');$job$);

  if exists (select 1 from cron.job where jobname = 'monitoring_check') then
    perform cron.unschedule('monitoring_check');
  end if;
  perform cron.schedule('monitoring_check', '*/5 * * * *', $job$select public.invoke_edge_job('monitoring-check');$job$);
end $$;
