-- Admin metrics foundation for IO observability.
-- Adds:
-- - raw + rollup metric sample tables
-- - admin RPC helpers for chart/query data
-- - rollup + retention helpers for collectors
-- - scheduler entry for ops-metrics-collect

insert into public.system_settings (key, value)
values
  ('ops_metrics_collection_enabled', 'false'::jsonb),
  ('ops_metrics_retention_raw_days', '7'::jsonb),
  ('ops_metrics_retention_rollup_days', '30'::jsonb),
  ('ops_metrics_scrape_timeout_ms', '8000'::jsonb)
on conflict (key) do nothing;

create table if not exists public.ops_metrics_samples_1m (
  id bigserial primary key,
  sampled_at timestamptz not null,
  metric_key text not null,
  labels jsonb not null default '{}'::jsonb,
  value double precision not null,
  source text not null default 'supabase_metrics',
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ops_metrics_samples_1m_uniq_idx
  on public.ops_metrics_samples_1m(sampled_at, metric_key, labels);

create index if not exists ops_metrics_samples_1m_metric_sampled_idx
  on public.ops_metrics_samples_1m(metric_key, sampled_at desc);

create index if not exists ops_metrics_samples_1m_sampled_idx
  on public.ops_metrics_samples_1m(sampled_at desc);

create table if not exists public.ops_metrics_samples_5m (
  id bigserial primary key,
  sampled_at timestamptz not null,
  metric_key text not null,
  labels jsonb not null default '{}'::jsonb,
  value double precision not null,
  source text not null default 'rollup_5m',
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists ops_metrics_samples_5m_uniq_idx
  on public.ops_metrics_samples_5m(sampled_at, metric_key, labels);

create index if not exists ops_metrics_samples_5m_metric_sampled_idx
  on public.ops_metrics_samples_5m(metric_key, sampled_at desc);

create index if not exists ops_metrics_samples_5m_sampled_idx
  on public.ops_metrics_samples_5m(sampled_at desc);

alter table public.ops_metrics_samples_1m enable row level security;
alter table public.ops_metrics_samples_5m enable row level security;

drop policy if exists "admin read ops metrics 1m" on public.ops_metrics_samples_1m;
create policy "admin read ops metrics 1m"
  on public.ops_metrics_samples_1m for select
  using (public.is_admin());

drop policy if exists "service role manage ops metrics 1m" on public.ops_metrics_samples_1m;
create policy "service role manage ops metrics 1m"
  on public.ops_metrics_samples_1m for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "admin read ops metrics 5m" on public.ops_metrics_samples_5m;
create policy "admin read ops metrics 5m"
  on public.ops_metrics_samples_5m for select
  using (public.is_admin());

drop policy if exists "service role manage ops metrics 5m" on public.ops_metrics_samples_5m;
create policy "service role manage ops metrics 5m"
  on public.ops_metrics_samples_5m for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

create or replace function public.admin_get_ops_metrics_series(
  window_hours int default 24,
  resolution text default '1m',
  metric_keys text[] default null
)
returns table (
  sampled_at timestamptz,
  metric_key text,
  labels jsonb,
  value double precision,
  source text
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_window int := greatest(1, least(coalesce(window_hours, 24), 24 * 30));
  v_resolution text := case when lower(coalesce(resolution, '1m')) = '5m' then '5m' else '1m' end;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  if v_resolution = '5m' then
    return query
      select t.sampled_at, t.metric_key, t.labels, t.value, t.source
      from public.ops_metrics_samples_5m t
      where t.sampled_at >= now() - make_interval(hours => v_window)
        and (metric_keys is null or t.metric_key = any(metric_keys))
      order by t.sampled_at asc, t.metric_key asc;
  else
    return query
      select t.sampled_at, t.metric_key, t.labels, t.value, t.source
      from public.ops_metrics_samples_1m t
      where t.sampled_at >= now() - make_interval(hours => v_window)
        and (metric_keys is null or t.metric_key = any(metric_keys))
      order by t.sampled_at asc, t.metric_key asc;
  end if;
end;
$$;

create or replace function public.admin_get_pg_io_outliers(limit_n int default 25)
returns table (
  query text,
  calls bigint,
  total_exec_time double precision,
  mean_exec_time double precision,
  rows bigint,
  shared_blks_hit bigint,
  shared_blks_read bigint,
  shared_blks_dirtied bigint,
  shared_blks_written bigint,
  temp_blks_read bigint,
  temp_blks_written bigint
)
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(limit_n, 25), 200));
  stats_relation text := null;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  if to_regclass('pg_stat_statements') is not null then
    stats_relation := 'pg_stat_statements';
  elsif to_regclass('extensions.pg_stat_statements') is not null then
    stats_relation := 'extensions.pg_stat_statements';
  else
    return;
  end if;

  return query execute format(
    $sql$
      select
        left(regexp_replace(s.query, '\s+', ' ', 'g'), 500) as query,
        s.calls,
        s.total_exec_time,
        s.mean_exec_time,
        s.rows,
        s.shared_blks_hit,
        s.shared_blks_read,
        s.shared_blks_dirtied,
        s.shared_blks_written,
        s.temp_blks_read,
        s.temp_blks_written
      from %s s
      where s.calls > 0
      order by
        (coalesce(s.temp_blks_written, 0) + coalesce(s.shared_blks_written, 0)) desc,
        s.total_exec_time desc
      limit %s
    $sql$,
    stats_relation,
    v_limit
  );
end;
$$;

create or replace function public.admin_get_table_write_pressure(limit_n int default 25)
returns table (
  table_name text,
  total_writes bigint,
  n_tup_ins bigint,
  n_tup_upd bigint,
  n_tup_del bigint,
  n_tup_hot_upd bigint,
  n_live_tup bigint,
  n_dead_tup bigint,
  dead_ratio double precision,
  seq_scan bigint,
  idx_scan bigint,
  last_autovacuum timestamptz,
  last_autoanalyze timestamptz
)
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_limit int := greatest(1, least(coalesce(limit_n, 25), 200));
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  return query
    select
      st.relname::text as table_name,
      (coalesce(st.n_tup_ins, 0) + coalesce(st.n_tup_upd, 0) + coalesce(st.n_tup_del, 0) + coalesce(st.n_tup_hot_upd, 0))::bigint as total_writes,
      coalesce(st.n_tup_ins, 0)::bigint as n_tup_ins,
      coalesce(st.n_tup_upd, 0)::bigint as n_tup_upd,
      coalesce(st.n_tup_del, 0)::bigint as n_tup_del,
      coalesce(st.n_tup_hot_upd, 0)::bigint as n_tup_hot_upd,
      coalesce(st.n_live_tup, 0)::bigint as n_live_tup,
      coalesce(st.n_dead_tup, 0)::bigint as n_dead_tup,
      case
        when coalesce(st.n_live_tup, 0) + coalesce(st.n_dead_tup, 0) = 0 then 0
        else coalesce(st.n_dead_tup, 0)::double precision / (coalesce(st.n_live_tup, 0) + coalesce(st.n_dead_tup, 0))
      end as dead_ratio,
      coalesce(st.seq_scan, 0)::bigint as seq_scan,
      coalesce(st.idx_scan, 0)::bigint as idx_scan,
      st.last_autovacuum,
      st.last_autoanalyze
    from pg_stat_user_tables st
    order by total_writes desc, coalesce(st.n_dead_tup, 0) desc
    limit v_limit;
end;
$$;

create or replace function public.ops_metrics_rollup_5m()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  upserted_count bigint := 0;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  with agg as (
    select
      to_timestamp(floor(extract(epoch from t.sampled_at) / 300) * 300)::timestamptz as sampled_at,
      t.metric_key,
      t.labels,
      avg(t.value)::double precision as value
    from public.ops_metrics_samples_1m t
    where t.sampled_at >= now() - interval '3 days'
    group by 1, 2, 3
  ), upserted as (
    insert into public.ops_metrics_samples_5m(sampled_at, metric_key, labels, value, source, collected_at)
    select sampled_at, metric_key, labels, value, 'rollup_5m', now()
    from agg
    on conflict (sampled_at, metric_key, labels) do update
      set value = excluded.value,
          source = excluded.source,
          collected_at = excluded.collected_at
    returning 1
  )
  select count(*) into upserted_count from upserted;

  return jsonb_build_object('ok', true, 'upserted', upserted_count);
end;
$$;

create or replace function public.ops_metrics_prune()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  raw_days int := 7;
  rollup_days int := 30;
  raw_deleted bigint := 0;
  rollup_deleted bigint := 0;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else raw_days
    end
  into raw_days
  from public.system_settings
  where key = 'ops_metrics_retention_raw_days';

  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else rollup_days
    end
  into rollup_days
  from public.system_settings
  where key = 'ops_metrics_retention_rollup_days';

  raw_days := greatest(1, least(coalesce(raw_days, 7), 90));
  rollup_days := greatest(raw_days, least(coalesce(rollup_days, 30), 365));

  with raw_del as (
    delete from public.ops_metrics_samples_1m
    where sampled_at < now() - make_interval(days => raw_days)
    returning 1
  )
  select count(*) into raw_deleted from raw_del;

  with rollup_del as (
    delete from public.ops_metrics_samples_5m
    where sampled_at < now() - make_interval(days => rollup_days)
    returning 1
  )
  select count(*) into rollup_deleted from rollup_del;

  return jsonb_build_object(
    'ok', true,
    'rawDays', raw_days,
    'rollupDays', rollup_days,
    'rawDeleted', raw_deleted,
    'rollupDeleted', rollup_deleted
  );
end;
$$;

revoke execute on function public.admin_get_ops_metrics_series(int, text, text[]) from public;
grant execute on function public.admin_get_ops_metrics_series(int, text, text[]) to authenticated, service_role;

revoke execute on function public.admin_get_pg_io_outliers(int) from public;
grant execute on function public.admin_get_pg_io_outliers(int) to authenticated, service_role;

revoke execute on function public.admin_get_table_write_pressure(int) from public;
grant execute on function public.admin_get_table_write_pressure(int) to authenticated, service_role;

revoke execute on function public.ops_metrics_rollup_5m() from public;
grant execute on function public.ops_metrics_rollup_5m() to service_role;

revoke execute on function public.ops_metrics_prune() from public;
grant execute on function public.ops_metrics_prune() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'ops_metrics_collect') then
    perform cron.unschedule('ops_metrics_collect');
  end if;

  perform cron.schedule(
    'ops_metrics_collect',
    '* * * * *',
    $job$select public.invoke_edge_job('ops-metrics-collect');$job$
  );
end $$;
