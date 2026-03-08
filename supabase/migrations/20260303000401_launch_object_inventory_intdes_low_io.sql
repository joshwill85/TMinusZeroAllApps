-- Launch object inventory snapshots (INTDES/COSPAR keyed) with low-IO SATCAT upserts.
--
-- Goals:
-- 1) Keep per-launch cataloged object inventory history (change-only snapshots).
-- 2) Add a low-write SATCAT upsert path (skip no-op rewrites).
-- 3) Expose one public RPC for launch inventory + reconciliation + freshness signals.
-- 4) Keep INTDES cadence adaptive by launch recency (recent launches faster polling).

insert into public.system_settings (key, value)
values
  ('celestrak_intdes_recent_window_days', '180'::jsonb),
  ('celestrak_intdes_recent_min_interval_seconds', '21600'::jsonb),
  ('celestrak_intdes_legacy_min_interval_seconds', '2592000'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create table if not exists public.launch_object_inventory_snapshots (
  id bigserial primary key,
  launch_designator text not null,
  snapshot_hash text not null,
  object_count int not null check (object_count >= 0),
  payload_count int not null check (payload_count >= 0),
  rb_count int not null check (rb_count >= 0),
  deb_count int not null check (deb_count >= 0),
  unk_count int not null check (unk_count >= 0),
  payloads_filter_count int not null check (payloads_filter_count >= 0),
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (launch_designator, snapshot_hash)
);

create index if not exists launch_object_inventory_snapshots_designator_captured_idx
  on public.launch_object_inventory_snapshots (launch_designator, captured_at desc);

create table if not exists public.launch_object_inventory_snapshot_items (
  snapshot_id bigint not null references public.launch_object_inventory_snapshots(id) on delete cascade,
  object_id text not null,
  norad_cat_id bigint,
  object_name text,
  object_type text not null check (object_type in ('PAY', 'RB', 'DEB', 'UNK')),
  ops_status_code text,
  owner text,
  launch_date date,
  launch_site text,
  decay_date date,
  period_min double precision,
  inclination_deg double precision,
  apogee_km double precision,
  perigee_km double precision,
  rcs_m2 double precision,
  data_status_code text,
  orbit_center text,
  orbit_type text,
  primary key (snapshot_id, object_id)
);

create index if not exists launch_object_inventory_snapshot_items_snapshot_type_idx
  on public.launch_object_inventory_snapshot_items (snapshot_id, object_type, object_id);

create index if not exists launch_object_inventory_snapshot_items_norad_idx
  on public.launch_object_inventory_snapshot_items (norad_cat_id);

alter table public.celestrak_intdes_datasets
  add column if not exists latest_snapshot_id bigint references public.launch_object_inventory_snapshots(id) on delete set null,
  add column if not exists latest_snapshot_hash text,
  add column if not exists catalog_state text not null default 'pending',
  add column if not exists last_checked_at timestamptz,
  add column if not exists last_non_empty_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'celestrak_intdes_datasets_catalog_state_check'
      and conrelid = 'public.celestrak_intdes_datasets'::regclass
  ) then
    alter table public.celestrak_intdes_datasets
      add constraint celestrak_intdes_datasets_catalog_state_check
      check (catalog_state in ('pending', 'catalog_available', 'catalog_empty', 'error'));
  end if;
end $$;

create index if not exists celestrak_intdes_datasets_catalog_state_idx
  on public.celestrak_intdes_datasets (catalog_state, last_checked_at desc);

alter table public.launch_object_inventory_snapshots enable row level security;
alter table public.launch_object_inventory_snapshot_items enable row level security;

revoke all on table public.launch_object_inventory_snapshots from public;
revoke all on table public.launch_object_inventory_snapshots from anon, authenticated;
grant all on table public.launch_object_inventory_snapshots to service_role;

revoke all on table public.launch_object_inventory_snapshot_items from public;
revoke all on table public.launch_object_inventory_snapshot_items from anon, authenticated;
grant all on table public.launch_object_inventory_snapshot_items to service_role;

drop policy if exists "admin manage launch object inventory snapshots" on public.launch_object_inventory_snapshots;
create policy "admin manage launch object inventory snapshots"
  on public.launch_object_inventory_snapshots for all
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin manage launch object inventory snapshot items" on public.launch_object_inventory_snapshot_items;
create policy "admin manage launch object inventory snapshot items"
  on public.launch_object_inventory_snapshot_items for all
  using (public.is_admin())
  with check (public.is_admin());

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
    order by coalesce(d.last_attempt_at, '1970-01-01'::timestamptz) asc, d.launch_designator asc
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

create or replace function public.upsert_satellites_satcat_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      (r.norad_cat_id)::bigint as norad_cat_id,
      nullif(btrim(r.intl_des), '') as intl_des,
      nullif(btrim(r.object_name), '') as object_name,
      case
        when upper(nullif(btrim(r.object_type), '')) = 'R/B' then 'RB'
        when upper(nullif(btrim(r.object_type), '')) in ('PAY', 'RB', 'DEB') then upper(nullif(btrim(r.object_type), ''))
        else 'UNK'
      end as object_type,
      nullif(btrim(r.ops_status_code), '') as ops_status_code,
      nullif(btrim(r.owner), '') as owner,
      case
        when r.launch_date is null then null
        when btrim(r.launch_date) ~ '^\\d{4}-\\d{2}-\\d{2}$' then (btrim(r.launch_date))::date
        else null
      end as launch_date,
      nullif(btrim(r.launch_site), '') as launch_site,
      case
        when r.decay_date is null then null
        when btrim(r.decay_date) ~ '^\\d{4}-\\d{2}-\\d{2}$' then (btrim(r.decay_date))::date
        else null
      end as decay_date,
      case
        when r.period_min is null or btrim(r.period_min) = '' then null
        when btrim(r.period_min) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.period_min))::double precision
        else null
      end as period_min,
      case
        when r.inclination_deg is null or btrim(r.inclination_deg) = '' then null
        when btrim(r.inclination_deg) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.inclination_deg))::double precision
        else null
      end as inclination_deg,
      case
        when r.apogee_km is null or btrim(r.apogee_km) = '' then null
        when btrim(r.apogee_km) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.apogee_km))::double precision
        else null
      end as apogee_km,
      case
        when r.perigee_km is null or btrim(r.perigee_km) = '' then null
        when btrim(r.perigee_km) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.perigee_km))::double precision
        else null
      end as perigee_km,
      case
        when r.rcs_m2 is null or btrim(r.rcs_m2) = '' then null
        when btrim(r.rcs_m2) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.rcs_m2))::double precision
        else null
      end as rcs_m2,
      coalesce(r.raw_satcat, '{}'::jsonb) as raw_satcat,
      coalesce(r.satcat_updated_at, now()) as satcat_updated_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      norad_cat_id text,
      intl_des text,
      object_name text,
      object_type text,
      ops_status_code text,
      owner text,
      launch_date text,
      launch_site text,
      decay_date text,
      period_min text,
      inclination_deg text,
      apogee_km text,
      perigee_km text,
      rcs_m2 text,
      raw_satcat jsonb,
      satcat_updated_at timestamptz,
      updated_at timestamptz
    )
    where r.norad_cat_id is not null
      and r.norad_cat_id ~ '^[0-9]+$'
  ),
  upserted as (
    insert into public.satellites (
      norad_cat_id,
      intl_des,
      object_name,
      object_type,
      ops_status_code,
      owner,
      launch_date,
      launch_site,
      decay_date,
      period_min,
      inclination_deg,
      apogee_km,
      perigee_km,
      rcs_m2,
      raw_satcat,
      satcat_updated_at,
      updated_at
    )
    select
      i.norad_cat_id,
      i.intl_des,
      i.object_name,
      i.object_type,
      i.ops_status_code,
      i.owner,
      i.launch_date,
      i.launch_site,
      i.decay_date,
      i.period_min,
      i.inclination_deg,
      i.apogee_km,
      i.perigee_km,
      i.rcs_m2,
      i.raw_satcat,
      i.satcat_updated_at,
      i.updated_at
    from input i
    on conflict (norad_cat_id) do update
      set intl_des = coalesce(excluded.intl_des, satellites.intl_des),
          object_name = coalesce(excluded.object_name, satellites.object_name),
          object_type = coalesce(excluded.object_type, satellites.object_type),
          ops_status_code = coalesce(excluded.ops_status_code, satellites.ops_status_code),
          owner = coalesce(excluded.owner, satellites.owner),
          launch_date = coalesce(excluded.launch_date, satellites.launch_date),
          launch_site = coalesce(excluded.launch_site, satellites.launch_site),
          decay_date = coalesce(excluded.decay_date, satellites.decay_date),
          period_min = coalesce(excluded.period_min, satellites.period_min),
          inclination_deg = coalesce(excluded.inclination_deg, satellites.inclination_deg),
          apogee_km = coalesce(excluded.apogee_km, satellites.apogee_km),
          perigee_km = coalesce(excluded.perigee_km, satellites.perigee_km),
          rcs_m2 = coalesce(excluded.rcs_m2, satellites.rcs_m2),
          raw_satcat = coalesce(excluded.raw_satcat, satellites.raw_satcat),
          satcat_updated_at = excluded.satcat_updated_at,
          updated_at = excluded.updated_at
      where satellites.intl_des is distinct from coalesce(excluded.intl_des, satellites.intl_des)
         or satellites.object_name is distinct from coalesce(excluded.object_name, satellites.object_name)
         or satellites.object_type is distinct from coalesce(excluded.object_type, satellites.object_type)
         or satellites.ops_status_code is distinct from coalesce(excluded.ops_status_code, satellites.ops_status_code)
         or satellites.owner is distinct from coalesce(excluded.owner, satellites.owner)
         or satellites.launch_date is distinct from coalesce(excluded.launch_date, satellites.launch_date)
         or satellites.launch_site is distinct from coalesce(excluded.launch_site, satellites.launch_site)
         or satellites.decay_date is distinct from coalesce(excluded.decay_date, satellites.decay_date)
         or satellites.period_min is distinct from coalesce(excluded.period_min, satellites.period_min)
         or satellites.inclination_deg is distinct from coalesce(excluded.inclination_deg, satellites.inclination_deg)
         or satellites.apogee_km is distinct from coalesce(excluded.apogee_km, satellites.apogee_km)
         or satellites.perigee_km is distinct from coalesce(excluded.perigee_km, satellites.perigee_km)
         or satellites.rcs_m2 is distinct from coalesce(excluded.rcs_m2, satellites.rcs_m2)
         or satellites.raw_satcat is distinct from coalesce(excluded.raw_satcat, satellites.raw_satcat)
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;

alter function public.upsert_satellites_satcat_if_changed(jsonb) set search_path = public, pg_catalog;
revoke execute on function public.upsert_satellites_satcat_if_changed(jsonb) from public;
grant execute on function public.upsert_satellites_satcat_if_changed(jsonb) to service_role;

create or replace function public.get_launch_object_inventory_v1(
  ll2_launch_uuid_in uuid,
  include_orbit boolean default true,
  history_limit int default 5
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with launch_meta as (
    select
      l.ll2_launch_uuid,
      l.launch_designator
    from public.launches l
    where l.ll2_launch_uuid = ll2_launch_uuid_in
    limit 1
  ),
  manifest_counts as (
    select
      count(*)::int as ll2_payload_count
    from public.ll2_payload_flights pf
    where pf.ll2_launch_uuid = ll2_launch_uuid_in
      and pf.active = true
  ),
  dataset as (
    select d.*
    from public.celestrak_intdes_datasets d
    join launch_meta lm on lm.launch_designator = d.launch_designator
    limit 1
  ),
  latest_snapshot as (
    select s.*
    from public.launch_object_inventory_snapshots s
    join launch_meta lm on lm.launch_designator = s.launch_designator
    order by s.captured_at desc
    limit 1
  ),
  snapshot_choice as (
    select
      coalesce(d.latest_snapshot_id, ls.id) as snapshot_id,
      coalesce(d.latest_snapshot_hash, ls.snapshot_hash) as snapshot_hash,
      coalesce(d.catalog_state, case when ls.id is null then 'pending' else 'catalog_available' end) as catalog_state,
      d.last_checked_at,
      d.last_success_at,
      d.last_error,
      d.last_non_empty_at
    from dataset d
    full join latest_snapshot ls on true
    limit 1
  ),
  snapshot_meta as (
    select s.*
    from snapshot_choice sc
    join public.launch_object_inventory_snapshots s
      on s.id = sc.snapshot_id
  ),
  current_items as (
    select i.*
    from snapshot_choice sc
    join public.launch_object_inventory_snapshot_items i
      on i.snapshot_id = sc.snapshot_id
  ),
  orbit_latest as (
    select distinct on (oe.norad_cat_id)
      oe.norad_cat_id,
      oe.source,
      oe.epoch,
      oe.inclination_deg,
      oe.raan_deg,
      oe.eccentricity,
      oe.arg_perigee_deg,
      oe.mean_anomaly_deg,
      oe.mean_motion_rev_per_day,
      oe.bstar,
      oe.fetched_at
    from public.orbit_elements oe
    join current_items ci
      on ci.norad_cat_id is not null
     and ci.norad_cat_id = oe.norad_cat_id
    order by oe.norad_cat_id, oe.epoch desc
  ),
  counts as (
    select
      count(*)::int as satcat_total_count,
      count(*) filter (where object_type = 'PAY')::int as satcat_payload_count,
      count(*) filter (where object_type = 'RB')::int as satcat_rb_count,
      count(*) filter (where object_type = 'DEB')::int as satcat_deb_count,
      count(*) filter (where object_type = 'UNK')::int as satcat_unk_count
    from current_items
  ),
  payload_objects as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'object_id', ci.object_id,
            'norad_cat_id', ci.norad_cat_id,
            'name', ci.object_name,
            'object_type', ci.object_type,
            'ops_status_code', ci.ops_status_code,
            'owner', ci.owner,
            'launch_date', ci.launch_date,
            'launch_site', ci.launch_site,
            'decay_date', ci.decay_date,
            'period_min', ci.period_min,
            'inclination_deg', ci.inclination_deg,
            'apogee_km', ci.apogee_km,
            'perigee_km', ci.perigee_km,
            'rcs_m2', ci.rcs_m2,
            'data_status_code', ci.data_status_code,
            'orbit_center', ci.orbit_center,
            'orbit_type', ci.orbit_type,
            'orbit',
              case
                when include_orbit then (
                  select jsonb_strip_nulls(
                    jsonb_build_object(
                      'source', o.source,
                      'epoch', o.epoch,
                      'inclination_deg', o.inclination_deg,
                      'raan_deg', o.raan_deg,
                      'eccentricity', o.eccentricity,
                      'arg_perigee_deg', o.arg_perigee_deg,
                      'mean_anomaly_deg', o.mean_anomaly_deg,
                      'mean_motion_rev_per_day', o.mean_motion_rev_per_day,
                      'bstar', o.bstar,
                      'fetched_at', o.fetched_at
                    )
                  )
                  from orbit_latest o
                  where o.norad_cat_id = ci.norad_cat_id
                )
                else null
              end
          )
        )
        order by ci.object_id
      ),
      '[]'::jsonb
    ) as payloads_json
    from current_items ci
    where ci.object_type = 'PAY'
  ),
  non_payload_objects as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'object_id', ci.object_id,
            'norad_cat_id', ci.norad_cat_id,
            'name', ci.object_name,
            'object_type', ci.object_type,
            'ops_status_code', ci.ops_status_code,
            'owner', ci.owner,
            'launch_date', ci.launch_date,
            'launch_site', ci.launch_site,
            'decay_date', ci.decay_date,
            'period_min', ci.period_min,
            'inclination_deg', ci.inclination_deg,
            'apogee_km', ci.apogee_km,
            'perigee_km', ci.perigee_km,
            'rcs_m2', ci.rcs_m2,
            'data_status_code', ci.data_status_code,
            'orbit_center', ci.orbit_center,
            'orbit_type', ci.orbit_type,
            'orbit',
              case
                when include_orbit then (
                  select jsonb_strip_nulls(
                    jsonb_build_object(
                      'source', o.source,
                      'epoch', o.epoch,
                      'inclination_deg', o.inclination_deg,
                      'raan_deg', o.raan_deg,
                      'eccentricity', o.eccentricity,
                      'arg_perigee_deg', o.arg_perigee_deg,
                      'mean_anomaly_deg', o.mean_anomaly_deg,
                      'mean_motion_rev_per_day', o.mean_motion_rev_per_day,
                      'bstar', o.bstar,
                      'fetched_at', o.fetched_at
                    )
                  )
                  from orbit_latest o
                  where o.norad_cat_id = ci.norad_cat_id
                )
                else null
              end
          )
        )
        order by ci.object_type, ci.object_id
      ),
      '[]'::jsonb
    ) as non_payloads_json
    from current_items ci
    where ci.object_type <> 'PAY'
  ),
  history as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'launch_designator', s.launch_designator,
          'snapshot_hash', s.snapshot_hash,
          'object_count', s.object_count,
          'payload_count', s.payload_count,
          'rb_count', s.rb_count,
          'deb_count', s.deb_count,
          'unk_count', s.unk_count,
          'payloads_filter_count', s.payloads_filter_count,
          'captured_at', s.captured_at
        )
        order by s.captured_at desc
      ),
      '[]'::jsonb
    ) as history_json
    from (
      select s.*
      from public.launch_object_inventory_snapshots s
      join launch_meta lm on lm.launch_designator = s.launch_designator
      order by s.captured_at desc
      limit greatest(1, least(coalesce(history_limit, 5), 20))
    ) s
  )
  select jsonb_build_object(
    'launch_designator', (select lm.launch_designator from launch_meta lm),
    'inventory_status', jsonb_strip_nulls(
      jsonb_build_object(
        'catalog_state', coalesce((select sc.catalog_state from snapshot_choice sc), 'pending'),
        'last_checked_at', (select sc.last_checked_at from snapshot_choice sc),
        'last_success_at', (select sc.last_success_at from snapshot_choice sc),
        'last_error', (select sc.last_error from snapshot_choice sc),
        'last_non_empty_at', (select sc.last_non_empty_at from snapshot_choice sc),
        'latest_snapshot_hash', (select sc.snapshot_hash from snapshot_choice sc)
      )
    ),
    'reconciliation', jsonb_build_object(
      'll2_manifest_payload_count', coalesce((select mc.ll2_payload_count from manifest_counts mc), 0),
      'satcat_payload_count', coalesce((select c.satcat_payload_count from counts c), 0),
      'satcat_payloads_filter_count', coalesce((select sm.payloads_filter_count from snapshot_meta sm), 0),
      'satcat_total_count', coalesce((select c.satcat_total_count from counts c), 0),
      'satcat_type_counts', jsonb_build_object(
        'PAY', coalesce((select c.satcat_payload_count from counts c), 0),
        'RB', coalesce((select c.satcat_rb_count from counts c), 0),
        'DEB', coalesce((select c.satcat_deb_count from counts c), 0),
        'UNK', coalesce((select c.satcat_unk_count from counts c), 0)
      ),
      'delta_manifest_vs_satcat_payload',
        coalesce((select c.satcat_payload_count from counts c), 0)
        - coalesce((select mc.ll2_payload_count from manifest_counts mc), 0)
    ),
    'satcat_payload_objects', coalesce((select p.payloads_json from payload_objects p), '[]'::jsonb),
    'satcat_non_payload_objects', coalesce((select n.non_payloads_json from non_payload_objects n), '[]'::jsonb),
    'history', coalesce((select h.history_json from history h), '[]'::jsonb)
  );
$$;

grant execute on function public.get_launch_object_inventory_v1(uuid, boolean, int) to anon, authenticated;
