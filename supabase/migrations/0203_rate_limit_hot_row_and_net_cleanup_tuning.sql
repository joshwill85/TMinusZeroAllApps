-- Reduce write amplification on hot rate-limit rows.
-- Once a provider bucket reaches its limit, we avoid no-op UPDATE churn.
create or replace function public.try_increment_api_rate(
  provider_name text,
  window_start_in timestamptz,
  window_seconds_in int,
  limit_in int
)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  new_count int;
begin
  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (provider_name, window_start_in, window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1,
        window_seconds = excluded.window_seconds
  where public.api_rate_counters.count < limit_in
  returning count into new_count;

  if new_count is null then
    return false;
  end if;

  return new_count <= limit_in;
end;
$$;

-- Keep autovacuum proactive on update-heavy operational tables.
alter table if exists public.api_rate_counters set (
  fillfactor = 80,
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 50,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 50
);

alter table if exists public.ingestion_runs set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 100
);

alter table if exists public.ll2_catalog_public_cache set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 200,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_analyze_threshold = 200
);

-- Speed up pg_net response retention cleanup when extension tables are available.
do $$
begin
  if to_regclass('net._http_response') is null then
    return;
  end if;

  if to_regclass('net.net_http_response_created_idx') is null then
    begin
      execute 'create index net_http_response_created_idx on net._http_response (created)';
    exception
      when insufficient_privilege then
        raise notice 'Skipping net_http_response_created_idx: insufficient privilege';
    end;
  end if;
end;
$$;
