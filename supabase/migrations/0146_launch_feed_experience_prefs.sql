-- Premium launch feed experience preferences.
-- Stores the user-selected home feed renderer + view-specific settings.

alter table public.profiles
  add column if not exists launch_feed_view text not null default 'classic',
  add column if not exists launch_feed_view_settings jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_launch_feed_view_check'
  ) then
    alter table public.profiles
      add constraint profiles_launch_feed_view_check
      check (
        launch_feed_view in (
          'classic',
          'orbital_hud',
          'chronos_stream',
          'aero_glass_portal',
          'geotemporal_nexus',
          'sentient_grid'
        )
      );
  end if;
end;
$$;

