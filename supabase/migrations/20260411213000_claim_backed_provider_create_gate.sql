alter table public.premium_onboarding_allow_creates
  add column if not exists claim_id uuid references public.premium_claims(id) on delete cascade;

create unique index if not exists premium_onboarding_allow_creates_claim_uidx
  on public.premium_onboarding_allow_creates(claim_id)
  where claim_id is not null;

create index if not exists premium_onboarding_allow_creates_claim_idx
  on public.premium_onboarding_allow_creates(claim_id, expires_at desc)
  where claim_id is not null;

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
  matched_claim_id uuid;
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
        'message', 'Complete Premium purchase verification before creating a new account.',
        'http_code', 403,
        'code', 'premium_onboarding_required'
      )
    );
  end if;

  if normalized_email = '' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'message', 'Complete Premium purchase verification before creating a new account.',
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
    and claim_id is not null
    and used_at is null
    and expires_at > timezone('utc', now())
    and exists (
      select 1
      from public.premium_claims c
      where c.id = public.premium_onboarding_allow_creates.claim_id
        and c.status = 'verified'
        and c.user_id is null
    )
  returning claim_id into matched_claim_id;

  if matched_claim_id is not null then
    update public.premium_claims
    set
      metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{provider_create}',
        jsonb_build_object(
          'provider', normalized_provider,
          'email', normalized_email,
          'usedAt', timezone('utc', now())
        ),
        true
      ),
      updated_at = timezone('utc', now())
    where id = matched_claim_id
      and status = 'verified'
      and user_id is null;

    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', 'Complete Premium purchase verification before creating a new account.',
      'http_code', 403,
      'code', 'premium_onboarding_required'
    )
  );
end;
$$;

grant execute on function public.premium_onboarding_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.premium_onboarding_before_user_created(jsonb) from authenticated, anon, public;
