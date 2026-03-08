-- Expected satellite payloads per launch (pre-launch / manifest).
-- Purpose: allow the UI to show an expected satellite count even when SATCAT/INTDES cannot yet
-- provide per-satellite objects (which only exist post-launch).

create table if not exists public.launch_expected_satellite_payloads (
  ll2_launch_uuid uuid primary key,
  expected_count int not null check (expected_count > 0 and expected_count <= 5000),
  source_label text,
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep writes restricted (admin/service role only). Read via a definer function.
alter table public.launch_expected_satellite_payloads enable row level security;
revoke all on table public.launch_expected_satellite_payloads from public;
revoke all on table public.launch_expected_satellite_payloads from anon, authenticated;
grant all on table public.launch_expected_satellite_payloads to service_role;

create or replace function public.get_launch_expected_satellite_payload(ll2_launch_uuid_in uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (
      select jsonb_build_object(
        'll2_launch_uuid', e.ll2_launch_uuid,
        'expected_count', e.expected_count,
        'source_label', e.source_label,
        'source_url', e.source_url,
        'notes', e.notes,
        'updated_at', e.updated_at
      )
      from public.launch_expected_satellite_payloads e
      join public.launches_public_cache c
        on c.ll2_launch_uuid = e.ll2_launch_uuid
      where e.ll2_launch_uuid = ll2_launch_uuid_in
      limit 1
    ),
    '{}'::jsonb
  );
$$;

grant execute on function public.get_launch_expected_satellite_payload(uuid) to anon, authenticated;

