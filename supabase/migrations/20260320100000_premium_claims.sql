create table if not exists public.premium_claims (
  id uuid primary key default gen_random_uuid(),
  claim_token uuid not null default gen_random_uuid(),
  user_id uuid references public.profiles(user_id) on delete set null,
  provider text not null check (provider in ('stripe', 'apple_app_store', 'google_play')),
  product_key text not null default 'premium_monthly',
  status text not null check (status in ('pending', 'verified', 'claimed')),
  email text,
  return_to text not null default '/account',
  checkout_session_id text,
  provider_event_id text,
  provider_customer_id text,
  provider_subscription_id text,
  provider_product_id text,
  provider_status text,
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  claimed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (claim_token)
);

create unique index if not exists premium_claims_checkout_session_uidx
  on public.premium_claims(checkout_session_id)
  where checkout_session_id is not null;

create unique index if not exists premium_claims_provider_event_uidx
  on public.premium_claims(provider, provider_event_id)
  where provider_event_id is not null;

create index if not exists premium_claims_status_idx
  on public.premium_claims(status, updated_at desc);

create index if not exists premium_claims_user_idx
  on public.premium_claims(user_id, updated_at desc);
