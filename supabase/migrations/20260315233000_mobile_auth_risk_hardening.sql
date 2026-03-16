create table if not exists public.mobile_auth_risk_sessions (
  id uuid primary key default gen_random_uuid(),
  flow text not null check (flow in ('sign_in', 'sign_up', 'resend', 'recover')),
  platform text not null check (platform in ('ios', 'android')),
  email_hash text not null,
  installation_hash text not null,
  attestation_provider text not null,
  attestation_status text not null,
  app_version text null,
  build_profile text null,
  disposition text not null check (disposition in ('silent_turnstile', 'visible_turnstile', 'deny')),
  reason_code text null,
  challenge_completed_at timestamptz null,
  challenge_expires_at timestamptz null,
  used_at timestamptz null,
  result text null,
  result_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mobile_auth_risk_sessions_created_at_idx
  on public.mobile_auth_risk_sessions (created_at desc);

create index if not exists mobile_auth_risk_sessions_email_hash_idx
  on public.mobile_auth_risk_sessions (email_hash);

create index if not exists mobile_auth_risk_sessions_installation_hash_idx
  on public.mobile_auth_risk_sessions (installation_hash);

create table if not exists public.mobile_auth_risk_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.mobile_auth_risk_sessions(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mobile_auth_risk_events_session_created_idx
  on public.mobile_auth_risk_events (session_id, created_at desc);

alter table public.mobile_auth_risk_sessions enable row level security;
alter table public.mobile_auth_risk_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mobile_auth_risk_sessions'
      and policyname = 'service role manages mobile auth risk sessions'
  ) then
    create policy "service role manages mobile auth risk sessions"
      on public.mobile_auth_risk_sessions
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'mobile_auth_risk_events'
      and policyname = 'service role manages mobile auth risk events'
  ) then
    create policy "service role manages mobile auth risk events"
      on public.mobile_auth_risk_events
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end
$$;

insert into public.system_settings (key, value)
values
  ('mobile_auth_enforcement_mode', '"shadow"'::jsonb),
  ('mobile_auth_force_visible_turnstile', 'false'::jsonb),
  ('mobile_auth_disable_attestation_ios', 'false'::jsonb),
  ('mobile_auth_disable_attestation_android', 'false'::jsonb),
  ('mobile_auth_allow_nonprod_bypass', 'true'::jsonb)
on conflict (key) do nothing;
