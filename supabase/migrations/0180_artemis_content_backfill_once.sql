-- One-time Artemis content backfill controls + minimal social allowlist expansion.

insert into public.system_settings (key, value)
values
  ('artemis_content_backfill_once_enabled', 'true'::jsonb),
  ('artemis_content_backfill_photo_days', '90'::jsonb),
  ('artemis_content_backfill_social_days', '30'::jsonb)
on conflict (key) do update set
  value = excluded.value,
  updated_at = now();

insert into public.artemis_social_accounts (platform, handle, mission_scope, source_tier, active, notes, metadata)
values
  ('x', 'NASAGroundSys', 'program', 'tier1', true, 'NASA Ground Systems account for launch-day operations context', '{}'::jsonb)
on conflict (platform, handle_normalized) do update set
  mission_scope = excluded.mission_scope,
  source_tier = excluded.source_tier,
  active = excluded.active,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();
