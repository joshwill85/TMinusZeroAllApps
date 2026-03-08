-- Wiki/Wikimedia static enrichment for SpaceX drone-ship profile pages.

alter table public.spacex_drone_ships
  add column if not exists wikidata_id text,
  add column if not exists wiki_source_url text,
  add column if not exists wikipedia_url text,
  add column if not exists wikimedia_commons_category text,
  add column if not exists wiki_last_synced_at timestamptz,
  add column if not exists image_url text,
  add column if not exists image_source_url text,
  add column if not exists image_license text,
  add column if not exists image_license_url text,
  add column if not exists image_credit text,
  add column if not exists image_alt text,
  add column if not exists length_m numeric(8, 3),
  add column if not exists year_built int check (year_built is null or year_built between 1800 and 2100),
  add column if not exists home_port text,
  add column if not exists owner_name text,
  add column if not exists operator_name text,
  add column if not exists country_name text;

create unique index if not exists spacex_drone_ships_wikidata_id_uniq
  on public.spacex_drone_ships (wikidata_id)
  where wikidata_id is not null;

update public.spacex_drone_ships
set
  wikidata_id = case slug
    when 'ocisly' then 'Q23891316'
    when 'asog' then 'Q107172359'
    when 'jrti' then 'Q96157645'
    else wikidata_id
  end,
  wiki_source_url = case slug
    when 'ocisly' then 'https://www.wikidata.org/wiki/Q23891316'
    when 'asog' then 'https://www.wikidata.org/wiki/Q107172359'
    when 'jrti' then 'https://www.wikidata.org/wiki/Q96157645'
    else wiki_source_url
  end,
  updated_at = now()
where slug in ('ocisly', 'asog', 'jrti');

insert into public.system_settings (key, value)
values
  ('spacex_drone_ship_wiki_sync_enabled', 'true'::jsonb),
  ('spacex_drone_ship_wiki_sync_interval_days', '30'::jsonb)
on conflict (key) do nothing;
