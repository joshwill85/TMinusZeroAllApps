-- Schema: Profiles and subscriptions
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  role text not null default 'user' check (role in ('user','admin')),
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stripe_customers (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  stripe_customer_id text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  stripe_subscription_id text unique not null,
  stripe_price_id text not null,
  status text not null,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_status_idx on public.subscriptions(status);

-- Global system settings
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(user_id)
);

-- API rate counters (external providers)
create table if not exists public.api_rate_counters (
  provider text not null,
  window_start timestamptz not null,
  window_seconds int not null,
  count int not null default 0,
  primary key (provider, window_start)
);

-- Helper to atomically bump rate counters
create or replace function public.increment_api_rate(provider_name text, window_start_in timestamptz, window_seconds_in int)
returns void
language plpgsql
as $$
begin
  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (provider_name, window_start_in, window_seconds_in, 1)
  on conflict (provider, window_start) do update set count = public.api_rate_counters.count + 1;
end;
$$;

-- Reference tables
create table if not exists public.ll2_locations (
  ll2_location_id int primary key,
  name text not null,
  country_code text not null,
  timezone_name text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll2_pads (
  ll2_pad_id int primary key,
  ll2_location_id int not null references public.ll2_locations(ll2_location_id),
  name text not null,
  latitude double precision,
  longitude double precision,
  state_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll2_agencies (
  ll2_agency_id int primary key,
  name text not null,
  abbrev text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ll2_rocket_configs (
  ll2_config_id int primary key,
  name text not null,
  full_name text,
  family text,
  manufacturer text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Launches (live)
create table if not exists public.launches (
  id uuid primary key default gen_random_uuid(),
  ll2_launch_uuid uuid unique not null,

  name text not null,
  slug text,

  status_id int,
  status_name text,
  status_abbrev text,

  net timestamptz,
  net_precision text,
  window_start timestamptz,
  window_end timestamptz,

  provider text,
  vehicle text,
  pad_name text,
  pad_short_code text,
  pad_state text,
  pad_timezone text,

  ll2_agency_id int references public.ll2_agencies(ll2_agency_id),
  ll2_pad_id int references public.ll2_pads(ll2_pad_id),
  ll2_rocket_config_id int references public.ll2_rocket_configs(ll2_config_id),

  webcast_live boolean,
  video_url text,

  image_url text,
  image_thumbnail_url text,
  image_credit text,
  image_license_name text,
  image_license_url text,
  image_single_use boolean,

  tier_auto text not null default 'routine' check (tier_auto in ('routine','notable','major')),
  tier_override text check (tier_override in ('routine','notable','major')),
  featured boolean not null default false,
  hidden boolean not null default false,

  last_updated_source timestamptz,
  ingested_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launches_net_idx on public.launches(net);
create index if not exists launches_last_updated_idx on public.launches(last_updated_source);
create index if not exists launches_pad_idx on public.launches(ll2_pad_id);

-- Change tracking
create table if not exists public.launch_updates (
  id bigserial primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,
  changed_fields text[] not null,
  old_values jsonb,
  new_values jsonb,
  detected_at timestamptz not null default now()
);

create index if not exists launch_updates_detected_idx on public.launch_updates(detected_at desc);

-- Public cache
create table if not exists public.launches_public_cache (
  launch_id uuid primary key,
  name text not null,
  provider text,
  vehicle text,
  net timestamptz,
  net_precision text,
  window_start timestamptz,
  window_end timestamptz,
  status_name text,
  status_abbrev text,
  tier text not null,
  featured boolean not null,

  pad_name text,
  pad_state_code text,
  location_name text,
  image_thumbnail_url text,

  webcast_live boolean,
  video_url text,

  cache_generated_at timestamptz not null default now()
);

create index if not exists launches_public_cache_net_idx on public.launches_public_cache(net);

-- Watchlists
create table if not exists public.watchlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  name text not null default 'My Watchlist',
  created_at timestamptz not null default now()
);

create table if not exists public.watchlist_rules (
  id uuid primary key default gen_random_uuid(),
  watchlist_id uuid not null references public.watchlists(id) on delete cascade,
  rule_type text not null check (rule_type in ('launch','pad','provider','tier')),
  rule_value text not null,
  created_at timestamptz not null default now()
);

create index if not exists watchlist_rules_watchlist_idx on public.watchlist_rules(watchlist_id);

-- Notification preferences
create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,

  email_enabled boolean not null default true,
  sms_enabled boolean not null default false,
  push_enabled boolean not null default true,

  quiet_hours_enabled boolean not null default false,
  quiet_start_local time,
  quiet_end_local time,

  notify_t_minus_60 boolean not null default true,
  notify_t_minus_10 boolean not null default true,
  notify_liftoff boolean not null default true,
  notify_status_change boolean not null default true,
  notify_net_change boolean not null default true,

  sms_phone_e164 text,
  sms_verified boolean not null default false,
  sms_opt_in_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

-- Notification outbox
create table if not exists public.notifications_outbox (
  id bigserial primary key,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  launch_id uuid references public.launches(id) on delete set null,

  channel text not null check (channel in ('email','sms','push')),
  event_type text not null,
  payload jsonb not null,

  status text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  provider_message_id text,
  error text,

  scheduled_for timestamptz not null,
  processed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists notifications_outbox_status_idx on public.notifications_outbox(status, scheduled_for);

-- Notification usage (for caps)
create table if not exists public.notification_usage_monthly (
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  month_start date not null,
  channel text not null check (channel in ('sms','email','push')),
  messages_sent int not null default 0,
  segments_sent int not null default 0,
  primary key (user_id, month_start, channel)
);

-- Operational logs
create table if not exists public.ingestion_runs (
  id bigserial primary key,
  job_name text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  success boolean,
  stats jsonb,
  error text
);

create table if not exists public.webhook_events (
  id bigserial primary key,
  source text not null,
  received_at timestamptz not null default now(),
  payload_hash text,
  processed boolean not null default false,
  error text
);

-- Helper functions
create or replace function public.is_admin()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_paid_user()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = auth.uid()
      and s.status in ('active','trialing')
  );
$$;

-- RLS policies
alter table public.launches_public_cache enable row level security;
create policy "public read public cache" on public.launches_public_cache for select using (true);

alter table public.launches enable row level security;
create policy "paid read launches" on public.launches for select using (public.is_paid_user() or public.is_admin());

alter table public.watchlists enable row level security;
alter table public.watchlist_rules enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "user owns watchlists" on public.watchlists for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user owns watchlist rules" on public.watchlist_rules for all using (
  exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid())
) with check (
  exists (select 1 from public.watchlists w where w.id = watchlist_id and w.user_id = auth.uid())
);
create policy "user owns prefs" on public.notification_preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user owns push subs" on public.push_subscriptions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.system_settings enable row level security;
create policy "admin manage system settings" on public.system_settings for all using (public.is_admin()) with check (public.is_admin());

-- Seed baseline system settings (placeholders)
insert into public.system_settings(key, value)
values
  ('ll2_rate_limit_per_hour', '15'::jsonb),
  ('public_cache_interval_minutes', '15'::jsonb),
  ('live_poll_interval_seconds', '60'::jsonb),
  ('ads_enabled', 'true'::jsonb),
  ('ads_mode', '"placeholder"'::jsonb),
  ('ads_infeed_first_after_row', '5'::jsonb),
  ('ads_infeed_interval_rows', '10'::jsonb),
  ('ads_mobile_max_slots', '2'::jsonb),
  ('sms_enabled', 'true'::jsonb),
  ('sms_allowed_tiers', '["major","notable","routine"]'::jsonb),
  ('sms_monthly_cap_per_user', '20'::jsonb),
  ('sms_daily_cap_per_user', '10'::jsonb),
  ('sms_daily_cap_per_user_per_launch', '3'::jsonb),
  ('sms_min_gap_minutes', '10'::jsonb),
  ('sms_batch_window_minutes', '10'::jsonb),
  ('sms_max_chars', '160'::jsonb)
  on conflict (key) do nothing;
