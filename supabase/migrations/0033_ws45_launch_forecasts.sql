-- Store 45th Weather Squadron (Eastern Range) Launch Mission Execution Forecast PDFs.
-- Join strategy to launches: primarily via valid_window (UTC) overlap with launch net/window, with mission_name as a tie-breaker.

create table if not exists public.ws45_launch_forecasts (
  id uuid primary key default gen_random_uuid(),

  -- Source identity
  source text not null default '45ws',
  source_range text not null default 'eastern_range',
  source_page_url text,
  source_label text,
  forecast_kind text,

  -- PDF fetch metadata (used for periodic checks + dedupe)
  pdf_url text not null,
  pdf_etag text,
  pdf_last_modified timestamptz,
  pdf_sha256 text not null,
  pdf_bytes int,
  pdf_metadata jsonb,
  fetched_at timestamptz not null default now(),

  -- Parsed document header fields
  product_name text,
  mission_name text,
  mission_name_normalized text,
  mission_tokens text[],
  issued_at timestamptz,
  valid_start timestamptz,
  valid_end timestamptz,
  valid_window tstzrange generated always as (tstzrange(valid_start, valid_end, '[)')) stored,
  local_timezone text not null default 'America/New_York',

  forecast_discussion text,

  -- Parsed scenario summaries (kept flexible; details live in jsonb)
  launch_day_pov_percent int check (launch_day_pov_percent between 0 and 100),
  launch_day_primary_concerns text[],
  launch_day jsonb,

  delay_24h_pov_percent int check (delay_24h_pov_percent between 0 and 100),
  delay_24h_primary_concerns text[],
  delay_24h jsonb,

  -- Raw extraction for forward-compatibility / re-parsing
  raw_text text,
  raw jsonb,
  parse_version text not null default 'v1',

  -- Optional stored match to a launch (helps avoid re-matching on every read)
  match_status text not null default 'unmatched'
    check (match_status in ('unmatched', 'matched', 'ambiguous', 'manual')),
  matched_launch_id uuid references public.launches(id) on delete set null,
  match_confidence int check (match_confidence between 0 and 100),
  match_strategy text,
  match_meta jsonb,
  matched_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (pdf_url, pdf_sha256)
);

create index if not exists ws45_launch_forecasts_pdf_url_idx on public.ws45_launch_forecasts(pdf_url);
create index if not exists ws45_launch_forecasts_fetched_at_idx on public.ws45_launch_forecasts(fetched_at desc);
create index if not exists ws45_launch_forecasts_issued_at_idx on public.ws45_launch_forecasts(issued_at desc);
create index if not exists ws45_launch_forecasts_valid_window_gist on public.ws45_launch_forecasts using gist (valid_window);
create index if not exists ws45_launch_forecasts_matched_launch_id_idx on public.ws45_launch_forecasts(matched_launch_id);
create index if not exists ws45_launch_forecasts_mission_tokens_gin on public.ws45_launch_forecasts using gin (mission_tokens);

alter table public.ws45_launch_forecasts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ws45_launch_forecasts' and policyname = 'paid read ws45 launch forecasts'
  ) then
    create policy "paid read ws45 launch forecasts" on public.ws45_launch_forecasts
      for select using (public.is_paid_user() or public.is_admin());
  end if;
end $$;

