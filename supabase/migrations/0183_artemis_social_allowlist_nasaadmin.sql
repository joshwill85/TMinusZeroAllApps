insert into public.artemis_social_accounts (platform, handle, mission_scope, source_tier, active, notes, metadata)
values ('x', 'NASAAdmin', 'program', 'tier1', true, 'NASA Administrator official account', '{}'::jsonb)
on conflict (platform, handle_normalized) do update set
  mission_scope = excluded.mission_scope,
  source_tier = excluded.source_tier,
  active = excluded.active,
  notes = excluded.notes,
  metadata = excluded.metadata,
  updated_at = now();
