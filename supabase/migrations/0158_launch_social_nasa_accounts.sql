-- Normalize NASA provider mapping for launch-social matching and seed NASA accounts.

update public.social_accounts
set
  provider_key = 'nasa',
  provider_name = 'NASA',
  updated_at = now()
where
  platform = 'x'
  and provider_key in (
    'national-aeronautics-and-space-administration',
    'national-aeronautics-space-administration'
  );

insert into public.social_accounts (provider_key, provider_name, platform, handle, priority, active, verified_hint)
values
  ('nasa', 'NASA', 'x', 'nasaartemis', 12, true, true),
  ('nasa', 'NASA', 'x', 'nasa', 13, true, true)
on conflict (platform, provider_key, handle) do update
set
  provider_name = excluded.provider_name,
  priority = excluded.priority,
  active = excluded.active,
  verified_hint = excluded.verified_hint,
  updated_at = now();
