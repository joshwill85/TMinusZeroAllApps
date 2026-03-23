create table if not exists public.mobile_push_installations_v2 (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('guest', 'user')),
  user_id uuid references public.profiles(user_id) on delete cascade,
  installation_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  push_provider text not null check (push_provider in ('expo')),
  token text not null,
  app_version text,
  device_name text,
  device_secret_hash text,
  is_active boolean not null default true,
  last_registered_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_receipt_at timestamptz,
  last_failure_reason text,
  disabled_at timestamptz,
  attempts int not null default 0,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobile_push_installations_v2_owner_check check (
    (owner_kind = 'guest' and user_id is null and device_secret_hash is not null)
    or (owner_kind = 'user' and user_id is not null)
  )
);

create unique index if not exists mobile_push_installations_v2_guest_unique_idx
  on public.mobile_push_installations_v2(installation_id, platform)
  where owner_kind = 'guest';

create unique index if not exists mobile_push_installations_v2_user_unique_idx
  on public.mobile_push_installations_v2(user_id, platform, installation_id)
  where owner_kind = 'user';

create index if not exists mobile_push_installations_v2_active_idx
  on public.mobile_push_installations_v2(owner_kind, is_active, updated_at desc);

create table if not exists public.mobile_push_rules_v2 (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('guest', 'user')),
  user_id uuid references public.profiles(user_id) on delete cascade,
  installation_id text,
  scope_kind text not null check (scope_kind in ('all_us', 'state', 'launch', 'all_launches', 'preset', 'follow')),
  state text,
  launch_id uuid references public.launches(id) on delete cascade,
  filter_preset_id uuid references public.launch_filter_presets(id) on delete cascade,
  follow_rule_type text check (follow_rule_type in ('launch', 'pad', 'provider', 'tier')),
  follow_rule_value text,
  timezone text not null default 'UTC',
  prelaunch_offsets_minutes smallint[] not null default '{}',
  daily_digest_local_time text,
  status_change_types text[] not null default '{}',
  notify_net_change boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mobile_push_rules_v2_owner_check check (
    (owner_kind = 'guest' and user_id is null and installation_id is not null)
    or (owner_kind = 'user' and user_id is not null and installation_id is null)
  ),
  constraint mobile_push_rules_v2_scope_check check (
    (scope_kind = 'all_us' and state is null and launch_id is null and filter_preset_id is null and follow_rule_type is null and follow_rule_value is null)
    or (scope_kind = 'state' and state is not null and launch_id is null and filter_preset_id is null and follow_rule_type is null and follow_rule_value is null)
    or (scope_kind = 'launch' and state is null and launch_id is not null and filter_preset_id is null and follow_rule_type is null and follow_rule_value is null)
    or (scope_kind = 'all_launches' and state is null and launch_id is null and filter_preset_id is null and follow_rule_type is null and follow_rule_value is null)
    or (scope_kind = 'preset' and state is null and launch_id is null and filter_preset_id is not null and follow_rule_type is null and follow_rule_value is null)
    or (scope_kind = 'follow' and state is null and launch_id is null and filter_preset_id is null and follow_rule_type is not null and follow_rule_value is not null)
  )
);

create index if not exists mobile_push_rules_v2_owner_updated_idx
  on public.mobile_push_rules_v2(owner_kind, user_id, installation_id, updated_at desc);

create unique index if not exists mobile_push_rules_v2_guest_all_us_unique_idx
  on public.mobile_push_rules_v2(installation_id)
  where owner_kind = 'guest' and scope_kind = 'all_us';

create unique index if not exists mobile_push_rules_v2_guest_state_unique_idx
  on public.mobile_push_rules_v2(installation_id, state)
  where owner_kind = 'guest' and scope_kind = 'state';

create unique index if not exists mobile_push_rules_v2_guest_launch_unique_idx
  on public.mobile_push_rules_v2(installation_id, launch_id)
  where owner_kind = 'guest' and scope_kind = 'launch';

create unique index if not exists mobile_push_rules_v2_user_all_us_unique_idx
  on public.mobile_push_rules_v2(user_id)
  where owner_kind = 'user' and scope_kind = 'all_us';

create unique index if not exists mobile_push_rules_v2_user_state_unique_idx
  on public.mobile_push_rules_v2(user_id, state)
  where owner_kind = 'user' and scope_kind = 'state';

create unique index if not exists mobile_push_rules_v2_user_launch_unique_idx
  on public.mobile_push_rules_v2(user_id, launch_id)
  where owner_kind = 'user' and scope_kind = 'launch';

create unique index if not exists mobile_push_rules_v2_user_all_launches_unique_idx
  on public.mobile_push_rules_v2(user_id)
  where owner_kind = 'user' and scope_kind = 'all_launches';

create unique index if not exists mobile_push_rules_v2_user_preset_unique_idx
  on public.mobile_push_rules_v2(user_id, filter_preset_id)
  where owner_kind = 'user' and scope_kind = 'preset';

create unique index if not exists mobile_push_rules_v2_user_follow_unique_idx
  on public.mobile_push_rules_v2(user_id, follow_rule_type, follow_rule_value)
  where owner_kind = 'user' and scope_kind = 'follow';

create table if not exists public.mobile_push_outbox_v2 (
  id bigserial primary key,
  owner_kind text not null check (owner_kind in ('guest', 'user')),
  user_id uuid references public.profiles(user_id) on delete cascade,
  installation_id text,
  launch_id uuid references public.launches(id) on delete set null,
  channel text not null default 'push' check (channel = 'push'),
  event_type text not null,
  payload jsonb not null,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  provider_message_id text,
  error text,
  attempts int not null default 0,
  locked_at timestamptz,
  scheduled_for timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint mobile_push_outbox_v2_owner_check check (
    (owner_kind = 'guest' and user_id is null and installation_id is not null)
    or (owner_kind = 'user' and user_id is not null and installation_id is null)
  )
);

create index if not exists mobile_push_outbox_v2_status_idx
  on public.mobile_push_outbox_v2(status, scheduled_for);

create index if not exists mobile_push_outbox_v2_owner_idx
  on public.mobile_push_outbox_v2(owner_kind, user_id, installation_id, scheduled_for desc);

create or replace function public.claim_mobile_push_outbox_v2(
  batch_size int,
  max_attempts int default 5
)
returns setof public.mobile_push_outbox_v2
language plpgsql
security definer
as $$
begin
  return query
  with candidates as (
    select id
    from public.mobile_push_outbox_v2
    where status = 'queued'
      and scheduled_for <= now()
      and attempts < max_attempts
    order by scheduled_for asc
    for update skip locked
    limit batch_size
  )
  update public.mobile_push_outbox_v2
  set status = 'sending',
      locked_at = now(),
      attempts = attempts + 1,
      error = null
  where id in (select id from candidates)
  returning *;
end;
$$;

alter function public.claim_mobile_push_outbox_v2(int, int) set search_path = public;

alter table public.mobile_push_installations_v2 enable row level security;
alter table public.mobile_push_rules_v2 enable row level security;
alter table public.mobile_push_outbox_v2 enable row level security;

drop policy if exists "user owns mobile push installations v2" on public.mobile_push_installations_v2;
create policy "user owns mobile push installations v2"
  on public.mobile_push_installations_v2
  for all
  using (owner_kind = 'user' and auth.uid() = user_id)
  with check (owner_kind = 'user' and auth.uid() = user_id);

drop policy if exists "user owns mobile push rules v2" on public.mobile_push_rules_v2;
create policy "user owns mobile push rules v2"
  on public.mobile_push_rules_v2
  for all
  using (owner_kind = 'user' and auth.uid() = user_id)
  with check (owner_kind = 'user' and auth.uid() = user_id);
