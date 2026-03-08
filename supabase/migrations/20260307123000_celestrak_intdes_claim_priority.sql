-- Prioritize recent launches for INTDES/SATCAT catch-up without increasing request volume.
--
-- Claim order:
-- 1) Recent launches with pending/error inventory state.
-- 2) Recent launches already checked but still catalog_empty.
-- 3) Older launches with pending/error inventory state.
-- 4) Older launches already checked but still catalog_empty.
-- 5) Recent launches with catalog_available inventory state.
-- 6) Older launches with catalog_available inventory state.
--
-- This keeps current launches fresh while still allowing the historical backlog to drain.

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
  with settings as (
    select
      coalesce(
        (
          select case
            when jsonb_typeof(s.value) = 'number' then greatest(1, least((s.value::text)::int, 3650))
            when jsonb_typeof(s.value) = 'string'
              and trim(both '"' from s.value::text) ~ '^[0-9]+$'
              then greatest(1, least((trim(both '"' from s.value::text))::int, 3650))
            else null
          end
          from public.system_settings s
          where s.key = 'celestrak_intdes_recent_window_days'
        ),
        180
      ) as recent_window_days,
      coalesce(
        (
          select case
            when jsonb_typeof(s.value) = 'number' then greatest(300, least((s.value::text)::int, 31536000))
            when jsonb_typeof(s.value) = 'string'
              and trim(both '"' from s.value::text) ~ '^[0-9]+$'
              then greatest(300, least((trim(both '"' from s.value::text))::int, 31536000))
            else null
          end
          from public.system_settings s
          where s.key = 'celestrak_intdes_recent_min_interval_seconds'
        ),
        21600
      ) as recent_min_interval_seconds,
      coalesce(
        (
          select case
            when jsonb_typeof(s.value) = 'number' then greatest(300, least((s.value::text)::int, 31536000))
            when jsonb_typeof(s.value) = 'string'
              and trim(both '"' from s.value::text) ~ '^[0-9]+$'
              then greatest(300, least((trim(both '"' from s.value::text))::int, 31536000))
            else null
          end
          from public.system_settings s
          where s.key = 'celestrak_intdes_legacy_min_interval_seconds'
        ),
        2592000
      ) as legacy_min_interval_seconds
  ),
  candidates as (
    select d.launch_designator
    from public.celestrak_intdes_datasets d
    cross join settings st
    left join lateral (
      select l.net
      from public.launches l
      where l.launch_designator = d.launch_designator
      order by l.net desc nulls last
      limit 1
    ) ln on true
    where d.enabled = true
      and (
        d.last_attempt_at is null
        or d.last_attempt_at <= now() - (
          case
            when ln.net is not null
             and ln.net >= now() - (st.recent_window_days * interval '1 day')
              then st.recent_min_interval_seconds
            else st.legacy_min_interval_seconds
          end * interval '1 second'
        )
      )
    order by
      case
        when ln.net is not null
         and ln.net >= now() - (st.recent_window_days * interval '1 day')
         and coalesce(d.catalog_state, 'pending') in ('pending', 'error') then 0
        when ln.net is not null
         and ln.net >= now() - (st.recent_window_days * interval '1 day')
         and coalesce(d.catalog_state, 'pending') = 'catalog_empty' then 1
        when coalesce(d.catalog_state, 'pending') in ('pending', 'error') then 2
        when coalesce(d.catalog_state, 'pending') = 'catalog_empty' then 3
        when ln.net is not null
         and ln.net >= now() - (st.recent_window_days * interval '1 day')
         and coalesce(d.catalog_state, 'pending') = 'catalog_available' then 4
        else 5
      end asc,
      ln.net desc nulls last,
      coalesce(d.last_attempt_at, '1970-01-01'::timestamptz) asc,
      d.launch_designator asc
    for update of d skip locked
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
