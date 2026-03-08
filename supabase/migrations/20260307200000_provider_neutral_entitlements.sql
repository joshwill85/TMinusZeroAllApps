-- Add provider-neutral purchase mappings, entitlements, and event history.
-- This is additive and coexists with legacy Stripe-only tables during migration.

create table if not exists public.purchase_provider_customers (
  id bigserial primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  provider text not null check (provider in ('stripe', 'apple_app_store', 'google_play')),
  provider_customer_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  unique (provider, provider_customer_id)
);

create index if not exists purchase_provider_customers_user_idx
  on public.purchase_provider_customers(user_id);

create table if not exists public.purchase_entitlements (
  id bigserial primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  entitlement_key text not null default 'premium',
  provider text not null check (provider in ('stripe', 'apple_app_store', 'google_play')),
  provider_subscription_id text,
  provider_product_id text,
  status text not null,
  is_active boolean not null default false,
  cancel_at_period_end boolean not null default false,
  current_period_end timestamptz,
  source text not null default 'provider_sync',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, entitlement_key)
);

create index if not exists purchase_entitlements_user_idx
  on public.purchase_entitlements(user_id);

create index if not exists purchase_entitlements_provider_status_idx
  on public.purchase_entitlements(provider, status);

create table if not exists public.purchase_events (
  id bigserial primary key,
  user_id uuid references public.profiles(user_id) on delete set null,
  provider text not null check (provider in ('stripe', 'apple_app_store', 'google_play')),
  entitlement_key text not null default 'premium',
  event_type text not null,
  provider_event_id text,
  provider_subscription_id text,
  provider_product_id text,
  status text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists purchase_events_user_idx
  on public.purchase_events(user_id, created_at desc);

create index if not exists purchase_events_provider_idx
  on public.purchase_events(provider, created_at desc);

alter table public.purchase_provider_customers enable row level security;
alter table public.purchase_entitlements enable row level security;
alter table public.purchase_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_provider_customers'
      and policyname = 'user reads own purchase provider customers'
  ) then
    create policy "user reads own purchase provider customers" on public.purchase_provider_customers
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_entitlements'
      and policyname = 'user reads own purchase entitlements'
  ) then
    create policy "user reads own purchase entitlements" on public.purchase_entitlements
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'purchase_events'
      and policyname = 'user reads own purchase events'
  ) then
    create policy "user reads own purchase events" on public.purchase_events
      for select using (auth.uid() = user_id);
  end if;
end $$;
