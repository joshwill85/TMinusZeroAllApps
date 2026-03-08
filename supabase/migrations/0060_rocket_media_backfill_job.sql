-- Server-side rocket media backfill (images/wiki/info) from LL2 rocket configs + manufacturers.

create or replace function public.backfill_rocket_media()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  launches_updated int := 0;
  cache_updated int := 0;
begin
  with rocket_sources as (
    select
      rc.ll2_config_id,
      rc.image_url as config_image_url,
      rc.info_url as config_info_url,
      rc.wiki_url as config_wiki_url,
      rc.variant as config_variant,
      rc.reusable as config_reusable,
      a.logo_url as manufacturer_logo_url,
      a.image_url as manufacturer_image_url
    from public.ll2_rocket_configs rc
    left join public.ll2_agencies a
      on a.ll2_agency_id = rc.manufacturer_id
  )
  update public.launches l
  set
    rocket_image_url = coalesce(l.rocket_image_url, s.config_image_url),
    rocket_info_url = coalesce(l.rocket_info_url, s.config_info_url),
    rocket_wiki_url = coalesce(l.rocket_wiki_url, s.config_wiki_url),
    rocket_variant = coalesce(l.rocket_variant, s.config_variant),
    rocket_reusable = coalesce(l.rocket_reusable, s.config_reusable),
    rocket_manufacturer_logo_url = coalesce(l.rocket_manufacturer_logo_url, s.manufacturer_logo_url),
    rocket_manufacturer_image_url = coalesce(l.rocket_manufacturer_image_url, s.manufacturer_image_url),
    updated_at = now()
  from rocket_sources s
  where l.ll2_rocket_config_id = s.ll2_config_id
    and (
      (l.rocket_image_url is null and s.config_image_url is not null)
      or (l.rocket_info_url is null and s.config_info_url is not null)
      or (l.rocket_wiki_url is null and s.config_wiki_url is not null)
      or (l.rocket_variant is null and s.config_variant is not null)
      or (l.rocket_reusable is null and s.config_reusable is not null)
      or (l.rocket_manufacturer_logo_url is null and s.manufacturer_logo_url is not null)
      or (l.rocket_manufacturer_image_url is null and s.manufacturer_image_url is not null)
    );

  get diagnostics launches_updated = row_count;

  with rocket_sources as (
    select
      rc.ll2_config_id,
      rc.image_url as config_image_url,
      rc.info_url as config_info_url,
      rc.wiki_url as config_wiki_url,
      rc.variant as config_variant,
      rc.reusable as config_reusable,
      a.logo_url as manufacturer_logo_url,
      a.image_url as manufacturer_image_url
    from public.ll2_rocket_configs rc
    left join public.ll2_agencies a
      on a.ll2_agency_id = rc.manufacturer_id
  )
  update public.launches_public_cache c
  set
    rocket_image_url = coalesce(c.rocket_image_url, s.config_image_url),
    rocket_info_url = coalesce(c.rocket_info_url, s.config_info_url),
    rocket_wiki_url = coalesce(c.rocket_wiki_url, s.config_wiki_url),
    rocket_variant = coalesce(c.rocket_variant, s.config_variant),
    rocket_reusable = coalesce(c.rocket_reusable, s.config_reusable),
    rocket_manufacturer_logo_url = coalesce(c.rocket_manufacturer_logo_url, s.manufacturer_logo_url),
    rocket_manufacturer_image_url = coalesce(c.rocket_manufacturer_image_url, s.manufacturer_image_url),
    cache_generated_at = now()
  from rocket_sources s
  where c.ll2_rocket_config_id = s.ll2_config_id
    and (
      (c.rocket_image_url is null and s.config_image_url is not null)
      or (c.rocket_info_url is null and s.config_info_url is not null)
      or (c.rocket_wiki_url is null and s.config_wiki_url is not null)
      or (c.rocket_variant is null and s.config_variant is not null)
      or (c.rocket_reusable is null and s.config_reusable is not null)
      or (c.rocket_manufacturer_logo_url is null and s.manufacturer_logo_url is not null)
      or (c.rocket_manufacturer_image_url is null and s.manufacturer_image_url is not null)
    );

  get diagnostics cache_updated = row_count;

  return jsonb_build_object(
    'launchesUpdated', launches_updated,
    'cacheUpdated', cache_updated
  );
end;
$$;

revoke execute on function public.backfill_rocket_media() from public;
grant execute on function public.backfill_rocket_media() to service_role;

insert into public.system_settings (key, value)
values ('rocket_media_backfill_job_enabled', 'true'::jsonb)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'rocket_media_backfill') then
    perform cron.unschedule('rocket_media_backfill');
  end if;
  perform cron.schedule(
    'rocket_media_backfill',
    '17 */6 * * *',
    $job$select public.invoke_edge_job('rocket-media-backfill');$job$
  );
end $$;

