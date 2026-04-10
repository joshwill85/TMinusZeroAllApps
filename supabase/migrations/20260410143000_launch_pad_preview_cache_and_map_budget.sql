-- Pad preview cache + atomic Google Maps budget gating.

create table if not exists public.launch_pad_preview_cache (
  pad_key text primary key,
  ll2_pad_id int references public.ll2_pads(ll2_pad_id) on delete set null,
  launch_id uuid references public.launches(id) on delete set null,
  provider text not null,
  source_latitude double precision not null,
  source_longitude double precision not null,
  content_type text not null,
  image_base64 text not null,
  byte_size int not null check (byte_size >= 0),
  content_sha256 text not null,
  fetched_at timestamptz not null default now(),
  soft_refresh_at timestamptz not null,
  hard_expire_at timestamptz not null,
  last_accessed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (provider <> ''),
  check (content_type <> ''),
  check (content_sha256 <> ''),
  check (soft_refresh_at <= hard_expire_at)
);

create index if not exists launch_pad_preview_cache_ll2_pad_id_idx
  on public.launch_pad_preview_cache(ll2_pad_id);

create index if not exists launch_pad_preview_cache_hard_expire_at_idx
  on public.launch_pad_preview_cache(hard_expire_at);

alter table if exists public.launch_pad_preview_cache enable row level security;

create or replace function public.try_increment_map_budget(
  provider_base text,
  day_window_start_in timestamptz,
  day_window_seconds_in int,
  day_limit_in int,
  month_window_start_in timestamptz,
  month_window_seconds_in int,
  month_limit_in int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  day_provider text := trim(provider_base) || ':day';
  month_provider text := trim(provider_base) || ':month';
begin
  if trim(provider_base) = '' then
    return false;
  end if;

  if day_provider <= month_provider then
    perform pg_advisory_xact_lock(hashtext(day_provider));
    perform pg_advisory_xact_lock(hashtext(month_provider));
  else
    perform pg_advisory_xact_lock(hashtext(month_provider));
    perform pg_advisory_xact_lock(hashtext(day_provider));
  end if;

  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (day_provider, day_window_start_in, day_window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1,
        window_seconds = excluded.window_seconds
  where public.api_rate_counters.count < day_limit_in;

  if not found then
    return false;
  end if;

  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (month_provider, month_window_start_in, month_window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1,
        window_seconds = excluded.window_seconds
  where public.api_rate_counters.count < month_limit_in;

  if found then
    return true;
  end if;

  update public.api_rate_counters
  set count = greatest(public.api_rate_counters.count - 1, 0)
  where provider = day_provider
    and window_start = day_window_start_in;

  return false;
end;
$$;
