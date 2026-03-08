-- Weather metadata for launches (NWS/other providers).

alter table public.launches
  add column if not exists weather_concerns text[];

alter table public.launches_public_cache
  add column if not exists weather_concerns text[];

create table if not exists public.launch_weather (
  id uuid primary key default gen_random_uuid(),
  launch_id uuid not null references public.launches(id) on delete cascade,
  source text not null default 'nws',
  issued_at timestamptz,
  valid_start timestamptz,
  valid_end timestamptz,
  summary text,
  concerns text[],
  probability int check (probability between 0 and 100),
  data jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launch_weather_launch_id_idx on public.launch_weather(launch_id);
create index if not exists launch_weather_issued_at_idx on public.launch_weather(issued_at desc);
create index if not exists launch_weather_valid_start_idx on public.launch_weather(valid_start desc);

alter table public.launch_weather enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'launch_weather' and policyname = 'paid read launch weather'
  ) then
    create policy "paid read launch weather" on public.launch_weather
      for select using (public.is_paid_user() or public.is_admin());
  end if;
end $$;
