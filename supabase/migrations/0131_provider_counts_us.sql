-- Aggregate US launch provider counts for schedule hubs.
-- Used by the /launch-providers directory to avoid pagination loops.

create or replace function public.provider_counts_us(lookback_days int default 365)
returns table(provider text, launch_count int)
language sql
stable
as $$
  select
    provider,
    count(*)::int as launch_count
  from public.launches_public_cache
  where provider is not null
    and provider <> ''
    and lower(provider) <> 'unknown'
    and pad_country_code in ('USA', 'US')
    and net >= now() - make_interval(days => greatest(1, least(lookback_days, 3650)))
  group by provider
  order by launch_count desc, provider asc;
$$;

alter function public.provider_counts_us(int) set search_path = pg_catalog, public;
grant execute on function public.provider_counts_us(int) to anon, authenticated;

create index if not exists launches_public_cache_pad_country_net_provider_idx
  on public.launches_public_cache(pad_country_code, net, provider);

