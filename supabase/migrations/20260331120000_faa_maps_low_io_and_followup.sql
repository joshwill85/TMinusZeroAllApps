-- FAA map rollout hardening.
--
-- Goals:
-- 1) Reduce write churn in FAA TFR record/shape ingest by skipping no-op rewrites.
-- 2) Trigger a coalesced FAA launch re-match when launch timing or pad coordinates materially change.

create or replace function public.upsert_faa_tfr_records_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      coalesce(nullif(btrim(r.source), ''), 'faa_tfr') as source,
      nullif(btrim(r.source_key), '') as source_key,
      nullif(btrim(r.notam_id), '') as notam_id,
      nullif(btrim(r.notam_key), '') as notam_key,
      nullif(btrim(r.gid), '') as gid,
      nullif(btrim(r.facility), '') as facility,
      nullif(btrim(r.state), '') as state,
      nullif(btrim(r.type), '') as type,
      nullif(btrim(r.legal), '') as legal,
      nullif(btrim(r.title), '') as title,
      nullif(btrim(r.description), '') as description,
      r.is_new,
      nullif(btrim(r.mod_date), '') as mod_date,
      nullif(btrim(r.mod_abs_time), '') as mod_abs_time,
      r.mod_at,
      r.valid_start,
      r.valid_end,
      coalesce(r.has_shape, false) as has_shape,
      case
        when r.status in ('active', 'expired', 'manual') then r.status
        else 'active'
      end as status,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      source text,
      source_key text,
      notam_id text,
      notam_key text,
      gid text,
      facility text,
      state text,
      type text,
      legal text,
      title text,
      description text,
      is_new boolean,
      mod_date text,
      mod_abs_time text,
      mod_at timestamptz,
      valid_start timestamptz,
      valid_end timestamptz,
      has_shape boolean,
      status text,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
  ),
  input as (
    select distinct on (i.source, i.source_key)
      i.source,
      i.source_key,
      i.notam_id,
      i.notam_key,
      i.gid,
      i.facility,
      i.state,
      i.type,
      i.legal,
      i.title,
      i.description,
      i.is_new,
      i.mod_date,
      i.mod_abs_time,
      i.mod_at,
      i.valid_start,
      i.valid_end,
      i.has_shape,
      i.status,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source_key is not null
    order by i.source, i.source_key, i.updated_at desc, i.fetched_at desc
  ),
  upserted as (
    insert into public.faa_tfr_records (
      source,
      source_key,
      notam_id,
      notam_key,
      gid,
      facility,
      state,
      type,
      legal,
      title,
      description,
      is_new,
      mod_date,
      mod_abs_time,
      mod_at,
      valid_start,
      valid_end,
      has_shape,
      status,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.source,
      i.source_key,
      i.notam_id,
      i.notam_key,
      i.gid,
      i.facility,
      i.state,
      i.type,
      i.legal,
      i.title,
      i.description,
      i.is_new,
      i.mod_date,
      i.mod_abs_time,
      i.mod_at,
      i.valid_start,
      i.valid_end,
      i.has_shape,
      i.status,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (source, source_key) do update
      set notam_id = excluded.notam_id,
          notam_key = excluded.notam_key,
          gid = excluded.gid,
          facility = excluded.facility,
          state = excluded.state,
          type = excluded.type,
          legal = excluded.legal,
          title = excluded.title,
          description = excluded.description,
          is_new = excluded.is_new,
          mod_date = excluded.mod_date,
          mod_abs_time = excluded.mod_abs_time,
          mod_at = excluded.mod_at,
          valid_start = excluded.valid_start,
          valid_end = excluded.valid_end,
          has_shape = excluded.has_shape,
          status = excluded.status,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where faa_tfr_records.notam_id is distinct from excluded.notam_id
        or faa_tfr_records.notam_key is distinct from excluded.notam_key
        or faa_tfr_records.gid is distinct from excluded.gid
        or faa_tfr_records.facility is distinct from excluded.facility
        or faa_tfr_records.state is distinct from excluded.state
        or faa_tfr_records.type is distinct from excluded.type
        or faa_tfr_records.legal is distinct from excluded.legal
        or faa_tfr_records.title is distinct from excluded.title
        or faa_tfr_records.description is distinct from excluded.description
        or faa_tfr_records.is_new is distinct from excluded.is_new
        or faa_tfr_records.mod_date is distinct from excluded.mod_date
        or faa_tfr_records.mod_abs_time is distinct from excluded.mod_abs_time
        or faa_tfr_records.mod_at is distinct from excluded.mod_at
        or faa_tfr_records.valid_start is distinct from excluded.valid_start
        or faa_tfr_records.valid_end is distinct from excluded.valid_end
        or faa_tfr_records.has_shape is distinct from excluded.has_shape
        or faa_tfr_records.status is distinct from excluded.status
        or faa_tfr_records.raw is distinct from excluded.raw
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

revoke execute on function public.upsert_faa_tfr_records_if_changed(jsonb) from public;
grant execute on function public.upsert_faa_tfr_records_if_changed(jsonb) to service_role;

create or replace function public.upsert_faa_tfr_shapes_if_changed(rows_in jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.faa_tfr_record_id,
      nullif(btrim(r.source_shape_id), '') as source_shape_id,
      r.geometry,
      r.bbox_min_lat,
      r.bbox_min_lon,
      r.bbox_max_lat,
      r.bbox_max_lon,
      r.point_count,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      faa_tfr_record_id uuid,
      source_shape_id text,
      geometry jsonb,
      bbox_min_lat double precision,
      bbox_min_lon double precision,
      bbox_max_lat double precision,
      bbox_max_lon double precision,
      point_count int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.faa_tfr_record_id is not null
  ),
  input as (
    select distinct on (i.faa_tfr_record_id, i.source_shape_id)
      i.faa_tfr_record_id,
      i.source_shape_id,
      i.geometry,
      i.bbox_min_lat,
      i.bbox_min_lon,
      i.bbox_max_lat,
      i.bbox_max_lon,
      i.point_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source_shape_id is not null
    order by i.faa_tfr_record_id, i.source_shape_id, i.updated_at desc, i.fetched_at desc
  ),
  upserted as (
    insert into public.faa_tfr_shapes (
      faa_tfr_record_id,
      source_shape_id,
      geometry,
      bbox_min_lat,
      bbox_min_lon,
      bbox_max_lat,
      bbox_max_lon,
      point_count,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.faa_tfr_record_id,
      i.source_shape_id,
      i.geometry,
      i.bbox_min_lat,
      i.bbox_min_lon,
      i.bbox_max_lat,
      i.bbox_max_lon,
      i.point_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (faa_tfr_record_id, source_shape_id) do update
      set geometry = excluded.geometry,
          bbox_min_lat = excluded.bbox_min_lat,
          bbox_min_lon = excluded.bbox_min_lon,
          bbox_max_lat = excluded.bbox_max_lat,
          bbox_max_lon = excluded.bbox_max_lon,
          point_count = excluded.point_count,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where faa_tfr_shapes.geometry is distinct from excluded.geometry
        or faa_tfr_shapes.bbox_min_lat is distinct from excluded.bbox_min_lat
        or faa_tfr_shapes.bbox_min_lon is distinct from excluded.bbox_min_lon
        or faa_tfr_shapes.bbox_max_lat is distinct from excluded.bbox_max_lat
        or faa_tfr_shapes.bbox_max_lon is distinct from excluded.bbox_max_lon
        or faa_tfr_shapes.point_count is distinct from excluded.point_count
        or faa_tfr_shapes.raw is distinct from excluded.raw
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

revoke execute on function public.upsert_faa_tfr_shapes_if_changed(jsonb) from public;
grant execute on function public.upsert_faa_tfr_shapes_if_changed(jsonb) to service_role;

insert into public.system_settings (key, value)
values ('faa_launch_match_followup_cooldown_seconds', '120'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create or replace function public.schedule_faa_launch_match_followup()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  cooldown_seconds int := 120;
  lock_id text := gen_random_uuid()::text;
begin
  select
    case
      when jsonb_typeof(value) = 'number' then greatest(15, least(3600, (value::text)::int))
      when jsonb_typeof(value) = 'string'
        and trim(both '"' from value::text) ~ '^\d+$'
        then greatest(15, least(3600, trim(both '"' from value::text)::int))
      else 120
    end
  into cooldown_seconds
  from public.system_settings
  where key = 'faa_launch_match_followup_cooldown_seconds';

  cooldown_seconds := coalesce(cooldown_seconds, 120);

  if public.try_acquire_job_lock('faa_launch_match_followup_trigger', cooldown_seconds, lock_id) then
    perform public.invoke_edge_job('faa-launch-match');
  end if;

  return new;
end;
$$;

drop trigger if exists trg_schedule_faa_launch_match_followup on public.launches;

create trigger trg_schedule_faa_launch_match_followup
after insert or update of hidden, net, window_start, window_end, pad_latitude, pad_longitude, pad_name, pad_short_code, pad_state, pad_country_code
on public.launches
for each row
execute function public.schedule_faa_launch_match_followup();
