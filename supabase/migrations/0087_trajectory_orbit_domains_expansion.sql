-- Expand default truth domains for trajectory-orbit-ingest to include additional providers/agencies.
-- This only *adds* domains (does not remove existing custom domains).

do $$
declare
  current text := '';
  domains text[] := array[]::text[];
  merged text[] := array[]::text[];
  d text;
  additions text[] := array[
    'ulalaunch.com',
    'nasa.gov',
    'jpl.nasa.gov',
    'spacex.com',
    'content.spacex.com',
    'sxcontent9668.azureedge.us',
    'isaraerospace.com',
    'rocketlabcorp.com',
    'rocketlabusa.com',
    'arianespace.com',
    'ariane.group',
    'isro.gov.in',
    'global.jaxa.jp',
    'humans-in-space.jaxa.jp',
    'fireflyspace.com',
    'cdn.northropgrumman.com'
  ];
begin
  select coalesce(value #>> '{}', '') into current
  from public.system_settings
  where key = 'trajectory_orbit_truth_domains';

  if current <> '' then
    domains := array_remove(regexp_split_to_array(lower(current), '\\s*,\\s*'), '');
  end if;

  merged := domains;
  foreach d in array additions loop
    if d is null or d = '' then
      continue;
    end if;
    if not (d = any(merged)) then
      merged := array_append(merged, d);
    end if;
  end loop;

  if exists (select 1 from public.system_settings where key = 'trajectory_orbit_truth_domains') then
    update public.system_settings
    set value = to_jsonb(array_to_string(merged, ',')::text)
    where key = 'trajectory_orbit_truth_domains';
  else
    insert into public.system_settings (key, value)
    values ('trajectory_orbit_truth_domains', to_jsonb(array_to_string(merged, ',')::text));
  end if;
end $$;

