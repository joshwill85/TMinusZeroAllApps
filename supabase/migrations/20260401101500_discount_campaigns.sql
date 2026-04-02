-- Canonical premium discount campaigns that can fan out to web, iOS, and Android provider artifacts.
-- This is additive and leaves existing Stripe coupon flows in place.

create table if not exists public.discount_campaigns (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  product_key text not null check (product_key in ('premium_monthly')),
  campaign_kind text not null check (campaign_kind in ('promo_code', 'store_offer')),
  targeting_kind text not null check (targeting_kind in ('all_users', 'new_subscribers', 'lapsed_subscribers', 'specific_users')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended', 'sync_error')),
  starts_at timestamptz,
  ends_at timestamptz,
  display_copy jsonb not null default '{}'::jsonb,
  internal_notes text,
  created_by uuid references public.profiles(user_id) on delete set null,
  updated_by uuid references public.profiles(user_id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug)
);

create index if not exists discount_campaigns_product_status_idx
  on public.discount_campaigns(product_key, status, starts_at, ends_at);

create table if not exists public.discount_campaign_targets (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.discount_campaigns(id) on delete cascade,
  user_id uuid references public.profiles(user_id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or nullif(trim(coalesce(email, '')), '') is not null)
);

create unique index if not exists discount_campaign_targets_campaign_user_uidx
  on public.discount_campaign_targets(campaign_id, user_id)
  where user_id is not null;

create unique index if not exists discount_campaign_targets_campaign_email_uidx
  on public.discount_campaign_targets(campaign_id, (lower(email)))
  where email is not null;

create index if not exists discount_campaign_targets_campaign_idx
  on public.discount_campaign_targets(campaign_id);

create table if not exists public.discount_campaign_provider_artifacts (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.discount_campaigns(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'apple_app_store', 'google_play')),
  artifact_kind text not null check (
    artifact_kind in (
      'stripe_coupon',
      'stripe_promotion_code',
      'apple_offer_code',
      'apple_promotional_offer',
      'apple_win_back_offer',
      'google_offer',
      'google_promo_code'
    )
  ),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended', 'sync_error')),
  external_id text,
  external_code text,
  payload jsonb not null default '{}'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (external_id is not null or external_code is not null)
);

create unique index if not exists discount_campaign_provider_artifacts_scope_uidx
  on public.discount_campaign_provider_artifacts(campaign_id, provider, artifact_kind);

create index if not exists discount_campaign_provider_artifacts_provider_status_idx
  on public.discount_campaign_provider_artifacts(provider, status, starts_at, ends_at);

create index if not exists discount_campaign_provider_artifacts_campaign_idx
  on public.discount_campaign_provider_artifacts(campaign_id);

alter table public.discount_campaigns enable row level security;
alter table public.discount_campaign_targets enable row level security;
alter table public.discount_campaign_provider_artifacts enable row level security;
