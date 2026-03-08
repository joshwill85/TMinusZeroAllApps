-- US-only filter options for launches.
-- Keep in sync with the product scope (US pads only) and the LL2 ingest location filter.

create or replace function public.get_launch_filter_options()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider)
       from (
         select distinct provider
         from public.launches
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and provider is not null
           and provider <> ''
       ) p),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state)
       from (
         select distinct pad_state
         from public.launches
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and pad_state is not null
           and pad_state <> ''
       ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name)
       from (
         select distinct status_name
         from public.launches
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and status_name is not null
           and status_name <> ''
       ) st),
      '[]'::jsonb
    )
  );
$$;

