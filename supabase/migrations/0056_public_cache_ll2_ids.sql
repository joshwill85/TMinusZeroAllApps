-- Keep LL2 identifiers in the public cache so pages can join/link cleanly.

alter table if exists public.launches_public_cache
  add column if not exists ll2_launch_uuid uuid,
  add column if not exists ll2_agency_id int references public.ll2_agencies(ll2_agency_id) on delete set null,
  add column if not exists ll2_pad_id int references public.ll2_pads(ll2_pad_id) on delete set null,
  add column if not exists ll2_rocket_config_id int references public.ll2_rocket_configs(ll2_config_id) on delete set null;

create index if not exists launches_public_cache_ll2_launch_uuid_idx on public.launches_public_cache(ll2_launch_uuid);
create index if not exists launches_public_cache_ll2_agency_id_idx on public.launches_public_cache(ll2_agency_id);
create index if not exists launches_public_cache_ll2_pad_id_idx on public.launches_public_cache(ll2_pad_id);
create index if not exists launches_public_cache_ll2_rocket_config_id_idx on public.launches_public_cache(ll2_rocket_config_id);

