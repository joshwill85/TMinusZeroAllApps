-- Daily fallback social post for days with no US launches + "On this day" US launch highlight.

-- Require base_day for no-launch-day posts.
alter table public.social_posts
  drop constraint if exists social_posts_base_day_chk;

alter table public.social_posts
  add constraint social_posts_base_day_chk
  check (post_type not in ('launch_day', 'mission_drop', 'mission_brief', 'no_launch_day') or base_day is not null);

-- Ensure one no-launch-day post per platform per base day.
create unique index if not exists social_posts_no_launch_day_uidx
  on public.social_posts(platform, base_day)
  where post_type = 'no_launch_day';

-- Pick the most recent past US launch that occurred on a given month/day (in local pad time) with a non-empty mission brief.
create or replace function public.pick_launch_on_this_day(p_month int, p_day int)
returns table (
  id uuid,
  name text,
  slug text,
  net timestamptz,
  net_precision text,
  window_start timestamptz,
  window_end timestamptz,
  provider text,
  vehicle text,
  mission_name text,
  mission_description text,
  rocket_full_name text,
  pad_name text,
  pad_short_code text,
  pad_location_name text,
  pad_timezone text,
  pad_state text,
  pad_country_code text,
  status_name text,
  status_abbrev text,
  hidden boolean
)
language sql
stable
as $$
  select
    l.id,
    l.name,
    l.slug,
    l.net,
    l.net_precision,
    l.window_start,
    l.window_end,
    l.provider,
    l.vehicle,
    l.mission_name,
    l.mission_description,
    l.rocket_full_name,
    l.pad_name,
    l.pad_short_code,
    l.pad_location_name,
    l.pad_timezone,
    l.pad_state,
    l.pad_country_code,
    l.status_name,
    l.status_abbrev,
    l.hidden
  from public.launches l
  left join pg_catalog.pg_timezone_names tz on tz.name = l.pad_timezone
  where l.hidden is false
    and l.pad_country_code in ('USA', 'US')
    and l.net is not null
    and l.net < now()
    and l.mission_description is not null
    and btrim(l.mission_description) <> ''
    and extract(month from (l.net at time zone coalesce(tz.name, 'America/New_York')))::int = p_month
    and extract(day from (l.net at time zone coalesce(tz.name, 'America/New_York')))::int = p_day
    and lower(coalesce(l.status_name,'') || ' ' || coalesce(l.status_abbrev,'')) not like '%scrub%'
    and lower(coalesce(l.status_name,'') || ' ' || coalesce(l.status_abbrev,'')) not like '%cancel%'
  order by l.net desc
  limit 1;
$$;

alter function public.pick_launch_on_this_day(int, int) set search_path = pg_catalog, public;

insert into public.system_settings (key, value)
values
  ('social_posts_no_launch_day_enabled', 'true'::jsonb),
  ('social_posts_no_launch_day_window_start_hour_pt', '5'::jsonb),
  ('social_posts_no_launch_day_window_end_hour_pt', '8'::jsonb)
on conflict (key) do nothing;
