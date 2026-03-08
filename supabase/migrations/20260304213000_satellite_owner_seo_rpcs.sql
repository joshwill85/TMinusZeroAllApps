-- Public RPCs for satellite + owner SEO surfaces.

create index if not exists satellites_owner_updated_norad_idx
  on public.satellites (owner, satcat_updated_at desc, norad_cat_id desc)
  where owner is not null and owner <> '';

create or replace function public.get_satellite_sitemap_batch_v1(
  limit_in int default 1000,
  offset_in int default 0
)
returns table (
  norad_cat_id bigint,
  satcat_updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    s.norad_cat_id,
    s.satcat_updated_at
  from public.satellites s
  where s.norad_cat_id is not null
  order by s.satcat_updated_at desc nulls last, s.norad_cat_id desc
  limit greatest(1, least(coalesce(limit_in, 1000), 50000))
  offset greatest(0, coalesce(offset_in, 0));
$$;

grant execute on function public.get_satellite_sitemap_batch_v1(int, int) to anon, authenticated;

create or replace function public.get_satellite_preview_batch_v1(
  limit_in int default 100,
  offset_in int default 0
)
returns table (
  norad_cat_id bigint,
  intl_des text,
  object_name text,
  object_type text,
  owner text,
  satcat_updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    s.norad_cat_id,
    s.intl_des,
    s.object_name,
    s.object_type,
    s.owner,
    s.satcat_updated_at
  from public.satellites s
  where s.norad_cat_id is not null
  order by s.satcat_updated_at desc nulls last, s.norad_cat_id desc
  limit greatest(1, least(coalesce(limit_in, 100), 1000))
  offset greatest(0, coalesce(offset_in, 0));
$$;

grant execute on function public.get_satellite_preview_batch_v1(int, int) to anon, authenticated;

create or replace function public.get_satellite_owner_index_v1(
  limit_in int default 500,
  offset_in int default 0
)
returns table (
  owner text,
  satellite_count int,
  last_satcat_updated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    s.owner,
    count(*)::int as satellite_count,
    max(s.satcat_updated_at) as last_satcat_updated_at
  from public.satellites s
  where s.owner is not null
    and s.owner <> ''
  group by s.owner
  order by count(*) desc, s.owner asc
  limit greatest(1, least(coalesce(limit_in, 500), 5000))
  offset greatest(0, coalesce(offset_in, 0));
$$;

grant execute on function public.get_satellite_owner_index_v1(int, int) to anon, authenticated;

create or replace function public.get_satellite_owner_profile_v1(
  owner_in text,
  satellites_limit int default 30,
  satellites_offset int default 0,
  launches_limit int default 20
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with normalized as (
    select upper(trim(coalesce(owner_in, ''))) as owner_code
  ),
  owner_rows as (
    select s.*
    from public.satellites s
    join normalized n on s.owner = n.owner_code
    where n.owner_code <> ''
  ),
  totals as (
    select
      count(*)::int as owner_satellite_count,
      max(orow.satcat_updated_at) as last_satcat_updated_at,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'PAY')::int as pay_count,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'RB')::int as rb_count,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'DEB')::int as deb_count,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'UNK')::int as unk_count
    from owner_rows orow
  ),
  selected_satellites as (
    select
      orow.norad_cat_id,
      orow.intl_des,
      orow.object_name,
      orow.object_type,
      orow.satcat_updated_at,
      orow.apogee_km,
      orow.perigee_km,
      orow.inclination_deg
    from owner_rows orow
    order by orow.satcat_updated_at desc nulls last, orow.norad_cat_id desc
    limit greatest(1, least(coalesce(satellites_limit, 30), 200))
    offset greatest(0, coalesce(satellites_offset, 0))
  ),
  satellites_json as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'norad_cat_id', ss.norad_cat_id,
            'intl_des', ss.intl_des,
            'name', ss.object_name,
            'object_type', ss.object_type,
            'satcat_updated_at', ss.satcat_updated_at,
            'apogee_km', ss.apogee_km,
            'perigee_km', ss.perigee_km,
            'inclination_deg', ss.inclination_deg
          )
        )
        order by ss.satcat_updated_at desc nulls last, ss.norad_cat_id desc
      ),
      '[]'::jsonb
    ) as payload
    from selected_satellites ss
  ),
  launch_designators as (
    select distinct regexp_replace(orow.intl_des, '[A-Z]+$', '') as launch_designator
    from owner_rows orow
    where orow.intl_des is not null
      and orow.intl_des <> ''
  ),
  related_launches as (
    select
      l.id as launch_id,
      l.name as launch_name,
      l.slug as launch_slug,
      l.net as launch_net,
      l.provider as launch_provider,
      l.vehicle as launch_vehicle
    from public.launches l
    join launch_designators ld on ld.launch_designator = l.launch_designator
    where l.hidden = false
    order by l.net desc nulls last, l.id asc
    limit greatest(1, least(coalesce(launches_limit, 20), 100))
  ),
  launches_json as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'launch_id', rl.launch_id,
            'launch_name', rl.launch_name,
            'launch_slug', rl.launch_slug,
            'launch_net', rl.launch_net,
            'launch_provider', rl.launch_provider,
            'launch_vehicle', rl.launch_vehicle
          )
        )
        order by rl.launch_net desc nulls last, rl.launch_id asc
      ),
      '[]'::jsonb
    ) as payload
    from related_launches rl
  ),
  present as (
    select exists(select 1 from owner_rows) as has_rows
  )
  select
    case
      when not (select has_rows from present) then '{}'::jsonb
      else jsonb_build_object(
        'owner', (select owner_code from normalized),
        'owner_satellite_count', coalesce((select t.owner_satellite_count from totals t), 0),
        'last_satcat_updated_at', (select t.last_satcat_updated_at from totals t),
        'type_counts', jsonb_build_object(
          'PAY', coalesce((select t.pay_count from totals t), 0),
          'RB', coalesce((select t.rb_count from totals t), 0),
          'DEB', coalesce((select t.deb_count from totals t), 0),
          'UNK', coalesce((select t.unk_count from totals t), 0)
        ),
        'satellites', coalesce((select s.payload from satellites_json s), '[]'::jsonb),
        'related_launches', coalesce((select l.payload from launches_json l), '[]'::jsonb)
      )
    end;
$$;

grant execute on function public.get_satellite_owner_profile_v1(text, int, int, int) to anon, authenticated;
