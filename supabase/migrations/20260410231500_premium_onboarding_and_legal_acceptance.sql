create table if not exists public.premium_onboarding_intents (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('web', 'ios', 'android')),
  return_to text not null default '/account',
  viewer_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  expires_at timestamptz not null default timezone('utc', now()) + interval '24 hours',
  completed_at timestamptz
);

create index if not exists premium_onboarding_intents_viewer_idx
  on public.premium_onboarding_intents(viewer_id, updated_at desc);

create index if not exists premium_onboarding_intents_expires_idx
  on public.premium_onboarding_intents(expires_at desc);

create table if not exists public.premium_onboarding_allow_creates (
  id uuid primary key default gen_random_uuid(),
  onboarding_intent_id uuid references public.premium_onboarding_intents(id) on delete set null,
  provider text not null check (provider in ('google', 'apple')),
  email text not null,
  email_normalized text not null,
  used_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (email_normalized = lower(btrim(email)))
);

create unique index if not exists premium_onboarding_allow_creates_provider_email_uidx
  on public.premium_onboarding_allow_creates(provider, email_normalized);

create index if not exists premium_onboarding_allow_creates_expires_idx
  on public.premium_onboarding_allow_creates(expires_at desc);

create table if not exists public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_key text not null check (document_key in ('terms_of_service', 'privacy_notice')),
  document_version text not null,
  platform text not null check (platform in ('web', 'ios', 'android')),
  flow text not null check (flow in ('premium_onboarding', 'legacy_claim')),
  accepted_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists legal_acceptances_user_document_version_uidx
  on public.legal_acceptances(user_id, document_key, document_version);

create index if not exists legal_acceptances_user_idx
  on public.legal_acceptances(user_id, accepted_at desc);

alter table if exists public.premium_onboarding_intents enable row level security;
alter table if exists public.premium_onboarding_allow_creates enable row level security;
alter table if exists public.legal_acceptances enable row level security;

drop policy if exists "service role manage premium onboarding intents" on public.premium_onboarding_intents;
create policy "service role manage premium onboarding intents"
  on public.premium_onboarding_intents
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manage premium onboarding allow creates" on public.premium_onboarding_allow_creates;
create policy "service role manage premium onboarding allow creates"
  on public.premium_onboarding_allow_creates
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "service role manage legal acceptances" on public.legal_acceptances;
create policy "service role manage legal acceptances"
  on public.legal_acceptances
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

revoke all on table public.premium_onboarding_intents from public;
revoke all on table public.premium_onboarding_intents from anon, authenticated;
revoke all on table public.premium_onboarding_allow_creates from public;
revoke all on table public.premium_onboarding_allow_creates from anon, authenticated;
revoke all on table public.legal_acceptances from public;
revoke all on table public.legal_acceptances from anon, authenticated;

grant all on table public.premium_onboarding_intents to service_role;
grant all on table public.premium_onboarding_allow_creates to service_role;
grant all on table public.legal_acceptances to service_role;

create or replace function public.premium_onboarding_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_raw text;
  normalized_provider text;
  normalized_email text;
  matched_id uuid;
begin
  provider_raw := lower(coalesce(event->'user'->'app_metadata'->>'provider', ''));
  normalized_email := lower(btrim(coalesce(event->'user'->>'email', '')));

  if provider_raw = 'google' then
    normalized_provider := 'google';
  elsif provider_raw = 'apple' then
    normalized_provider := 'apple';
  else
    normalized_provider := 'email_password';
  end if;

  if normalized_provider = 'email_password' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'message', 'Start Premium before creating a new account.',
        'http_code', 403,
        'code', 'premium_onboarding_required'
      )
    );
  end if;

  if normalized_email = '' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'message', 'Start Premium before creating a new account.',
        'http_code', 403,
        'code', 'premium_onboarding_required'
      )
    );
  end if;

  update public.premium_onboarding_allow_creates
  set
    used_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where provider = normalized_provider
    and email_normalized = normalized_email
    and used_at is null
    and expires_at > timezone('utc', now())
  returning id into matched_id;

  if matched_id is not null then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', 'Start Premium before creating a new account.',
      'http_code', 403,
      'code', 'premium_onboarding_required'
    )
  );
end;
$$;

grant execute on function public.premium_onboarding_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.premium_onboarding_before_user_created(jsonb) from authenticated, anon, public;
