-- LL2 catalog launch joins for astronauts and launchers.

create table if not exists public.ll2_astronaut_launches (
  ll2_astronaut_id int not null references public.ll2_astronauts(ll2_astronaut_id) on delete cascade,
  ll2_launch_uuid uuid not null,
  launch_id uuid references public.launches(id) on delete set null,
  role text,
  primary key (ll2_astronaut_id, ll2_launch_uuid)
);

create index if not exists ll2_astronaut_launches_launch_idx on public.ll2_astronaut_launches(launch_id);
create index if not exists ll2_astronaut_launches_ll2_idx on public.ll2_astronaut_launches(ll2_launch_uuid);

create table if not exists public.ll2_launcher_launches (
  ll2_launcher_id int not null references public.ll2_launchers(ll2_launcher_id) on delete cascade,
  ll2_launch_uuid uuid not null,
  launch_id uuid references public.launches(id) on delete set null,
  primary key (ll2_launcher_id, ll2_launch_uuid)
);

create index if not exists ll2_launcher_launches_launch_idx on public.ll2_launcher_launches(launch_id);
create index if not exists ll2_launcher_launches_ll2_idx on public.ll2_launcher_launches(ll2_launch_uuid);

alter table if exists public.ll2_astronaut_launches enable row level security;
alter table if exists public.ll2_launcher_launches enable row level security;

insert into public.system_settings (key, value)
values
  ('ll2_catalog_astronaut_flights_enabled', 'true'::jsonb),
  ('ll2_catalog_astronaut_flights_batch_size', '1'::jsonb),
  ('ll2_catalog_astronaut_flights_offset', '0'::jsonb),
  ('ll2_catalog_launcher_flights_enabled', 'true'::jsonb),
  ('ll2_catalog_launcher_flights_batch_size', '1'::jsonb),
  ('ll2_catalog_launcher_flights_offset', '0'::jsonb)
on conflict (key) do nothing;
