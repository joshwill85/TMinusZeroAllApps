-- FAA TFR/NOTAM storage + launch matching tables.

create table if not exists public.faa_tfr_records (
  id uuid primary key default gen_random_uuid(),

  source text not null default 'faa_tfr',
  source_key text not null,

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
  valid_window tstzrange generated always as (tstzrange(valid_start, valid_end, '[)')) stored,

  has_shape boolean not null default false,
  status text not null default 'active'
    check (status in ('active', 'expired', 'manual')),

  raw jsonb not null default '{}'::jsonb,

  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint faa_tfr_records_source_key_uniq unique (source, source_key)
);

create index if not exists faa_tfr_records_notam_id_idx
  on public.faa_tfr_records(notam_id);

create index if not exists faa_tfr_records_mod_at_idx
  on public.faa_tfr_records(mod_at desc);

create index if not exists faa_tfr_records_valid_window_gist
  on public.faa_tfr_records using gist (valid_window);

create index if not exists faa_tfr_records_status_idx
  on public.faa_tfr_records(status, has_shape);

create table if not exists public.faa_tfr_shapes (
  id uuid primary key default gen_random_uuid(),

  faa_tfr_record_id uuid not null references public.faa_tfr_records(id) on delete cascade,
  source_shape_id text not null default 'shape',

  geometry jsonb not null,
  bbox_min_lat double precision,
  bbox_min_lon double precision,
  bbox_max_lat double precision,
  bbox_max_lon double precision,
  point_count int,

  raw jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint faa_tfr_shapes_record_source_uniq unique (faa_tfr_record_id, source_shape_id)
);

create index if not exists faa_tfr_shapes_record_idx
  on public.faa_tfr_shapes(faa_tfr_record_id);

create index if not exists faa_tfr_shapes_bbox_idx
  on public.faa_tfr_shapes(bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon);

create table if not exists public.faa_notam_details (
  id uuid primary key default gen_random_uuid(),

  notam_id text not null,
  faa_tfr_record_id uuid references public.faa_tfr_records(id) on delete set null,

  source text not null default 'faa_tfr',
  source_url text,

  web_text text,
  notam_text text,

  parsed jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  content_hash text not null,
  parse_version text not null default 'v1',

  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint faa_notam_details_notam_hash_uniq unique (notam_id, content_hash)
);

create index if not exists faa_notam_details_notam_id_idx
  on public.faa_notam_details(notam_id, fetched_at desc);

create table if not exists public.faa_launch_matches (
  id uuid primary key default gen_random_uuid(),

  launch_id uuid references public.launches(id) on delete cascade,
  faa_tfr_record_id uuid not null references public.faa_tfr_records(id) on delete cascade,
  faa_tfr_shape_id uuid references public.faa_tfr_shapes(id) on delete set null,

  match_status text not null default 'unmatched'
    check (match_status in ('matched', 'ambiguous', 'unmatched', 'manual')),
  match_confidence int
    check (match_confidence is null or (match_confidence between 0 and 100)),
  match_score double precision,
  match_strategy text,
  match_meta jsonb not null default '{}'::jsonb,
  match_origin text not null default 'auto'
    check (match_origin in ('auto', 'manual')),

  matched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faa_launch_matches_launch_idx
  on public.faa_launch_matches(launch_id, match_status, matched_at desc);

create index if not exists faa_launch_matches_record_idx
  on public.faa_launch_matches(faa_tfr_record_id, match_status, matched_at desc);

create unique index if not exists faa_launch_matches_record_launch_origin_uidx
  on public.faa_launch_matches(faa_tfr_record_id, launch_id, match_origin)
  where launch_id is not null;

create unique index if not exists faa_launch_matches_record_null_launch_origin_uidx
  on public.faa_launch_matches(faa_tfr_record_id, match_origin)
  where launch_id is null;

alter table public.faa_tfr_records enable row level security;
alter table public.faa_tfr_shapes enable row level security;
alter table public.faa_notam_details enable row level security;
alter table public.faa_launch_matches enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'faa_tfr_records' and policyname = 'public read faa tfr records'
  ) then
    create policy "public read faa tfr records"
      on public.faa_tfr_records
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'faa_tfr_shapes' and policyname = 'public read faa tfr shapes'
  ) then
    create policy "public read faa tfr shapes"
      on public.faa_tfr_shapes
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'faa_launch_matches' and policyname = 'public read faa launch matches'
  ) then
    create policy "public read faa launch matches"
      on public.faa_launch_matches
      for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'faa_notam_details' and policyname = 'admin read faa notam details'
  ) then
    create policy "admin read faa notam details"
      on public.faa_notam_details
      for select using (public.is_admin());
  end if;
end $$;
