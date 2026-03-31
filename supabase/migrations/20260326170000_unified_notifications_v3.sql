create table if not exists public.notification_push_destinations_v3 (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('guest', 'user')),
  owner_key text not null,
  user_id uuid references public.profiles(user_id) on delete cascade,
  installation_id text,
  platform text not null check (platform in ('web', 'ios', 'android')),
  delivery_kind text not null check (delivery_kind in ('web_push', 'mobile_push')),
  push_provider text not null check (push_provider in ('webpush', 'expo')),
  destination_key text not null,
  endpoint text,
  p256dh text,
  auth text,
  token text,
  app_version text,
  device_name text,
  user_agent text,
  device_secret_hash text,
  is_active boolean not null default true,
  verified boolean not null default true,
  last_registered_at timestamptz not null default now(),
  last_sent_at timestamptz,
  last_receipt_at timestamptz,
  last_failure_reason text,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_push_destinations_v3_owner_check check (
    (owner_kind = 'guest' and user_id is null and installation_id is not null and device_secret_hash is not null)
    or (owner_kind = 'user' and user_id is not null)
  ),
  constraint notification_push_destinations_v3_payload_check check (
    (delivery_kind = 'web_push' and push_provider = 'webpush' and endpoint is not null and p256dh is not null and auth is not null and token is null)
    or (delivery_kind = 'mobile_push' and push_provider = 'expo' and token is not null and endpoint is null and p256dh is null and auth is null)
  )
);

create unique index if not exists notification_push_destinations_v3_owner_key_unique_idx
  on public.notification_push_destinations_v3(owner_key, destination_key);

create index if not exists notification_push_destinations_v3_owner_active_idx
  on public.notification_push_destinations_v3(owner_kind, owner_key, is_active, updated_at desc);

create table if not exists public.notification_rules_v3 (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('guest', 'user')),
  owner_key text not null,
  user_id uuid references public.profiles(user_id) on delete cascade,
  installation_id text,
  intent text not null check (intent in ('follow', 'notifications_only')),
  visible_in_following boolean not null default false,
  enabled boolean not null default true,
  scope_kind text not null check (scope_kind in ('launch', 'state', 'provider', 'rocket', 'pad', 'launch_site', 'preset', 'filter', 'all_us', 'all_launches', 'tier')),
  scope_key text not null,
  launch_id uuid references public.launches(id) on delete cascade,
  state text,
  provider text,
  rocket_id int references public.ll2_rocket_configs(ll2_config_id) on delete set null,
  pad_key text,
  launch_site text,
  filter_preset_id uuid references public.launch_filter_presets(id) on delete cascade,
  filters jsonb,
  tier text,
  channels text[] not null default '{}'::text[],
  timezone text not null default 'UTC',
  prelaunch_offsets_minutes smallint[] not null default '{}'::smallint[],
  include_liftoff boolean not null default false,
  daily_digest_local_time text,
  status_change_types text[] not null default '{}'::text[],
  notify_net_change boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_rules_v3_owner_check check (
    (owner_kind = 'guest' and user_id is null and installation_id is not null)
    or (owner_kind = 'user' and user_id is not null and installation_id is null)
  ),
  constraint notification_rules_v3_channels_check check (channels <@ array['push', 'email', 'sms']::text[]),
  constraint notification_rules_v3_status_types_check check (status_change_types <@ array['any', 'go', 'hold', 'scrubbed', 'tbd']::text[])
);

create unique index if not exists notification_rules_v3_owner_scope_unique_idx
  on public.notification_rules_v3(owner_key, scope_kind, scope_key);

create index if not exists notification_rules_v3_owner_updated_idx
  on public.notification_rules_v3(owner_kind, owner_key, updated_at desc);

create index if not exists notification_rules_v3_following_idx
  on public.notification_rules_v3(owner_kind, owner_key, visible_in_following, updated_at desc)
  where visible_in_following is true;

alter table public.notifications_outbox
  alter column user_id drop not null;

alter table public.notifications_outbox
  add column if not exists owner_kind text,
  add column if not exists owner_key text,
  add column if not exists installation_id text,
  add column if not exists push_destination_id uuid references public.notification_push_destinations_v3(id) on delete set null;

update public.notifications_outbox
set owner_kind = 'user',
    owner_key = 'user:' || user_id::text
where owner_kind is null
  and user_id is not null;

alter table public.notifications_outbox
  alter column owner_kind set default 'user';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications_outbox'
      and column_name = 'owner_kind'
  ) then
    alter table public.notifications_outbox alter column owner_kind set not null;
  end if;
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'notifications_outbox'
      and column_name = 'owner_key'
  ) then
    alter table public.notifications_outbox alter column owner_key set not null;
  end if;
end $$;

alter table public.notifications_outbox
  drop constraint if exists notifications_outbox_owner_check;

alter table public.notifications_outbox
  add constraint notifications_outbox_owner_check check (
    (owner_kind = 'guest' and user_id is null and installation_id is not null and owner_key like 'guest:%')
    or (owner_kind = 'user' and user_id is not null and owner_key like 'user:%')
  );

create index if not exists notifications_outbox_owner_status_idx
  on public.notifications_outbox(owner_kind, owner_key, status, scheduled_for);

create index if not exists notifications_outbox_push_destination_idx
  on public.notifications_outbox(push_destination_id, status, scheduled_for)
  where push_destination_id is not null;

insert into public.notification_push_destinations_v3 (
  owner_kind,
  owner_key,
  user_id,
  installation_id,
  platform,
  delivery_kind,
  push_provider,
  destination_key,
  endpoint,
  p256dh,
  auth,
  user_agent,
  is_active,
  verified,
  last_registered_at,
  created_at,
  updated_at
)
select
  'user',
  'user:' || ps.user_id::text,
  ps.user_id,
  null,
  'web',
  'web_push',
  'webpush',
  'legacy-endpoint:' || md5(ps.endpoint),
  ps.endpoint,
  ps.p256dh,
  ps.auth,
  ps.user_agent,
  true,
  true,
  ps.created_at,
  ps.created_at,
  ps.created_at
from public.push_subscriptions ps
on conflict (owner_key, destination_key) do update
set endpoint = excluded.endpoint,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    is_active = true,
    disabled_at = null,
    updated_at = now();

insert into public.notification_push_destinations_v3 (
  owner_kind,
  owner_key,
  user_id,
  installation_id,
  platform,
  delivery_kind,
  push_provider,
  destination_key,
  token,
  app_version,
  device_name,
  device_secret_hash,
  is_active,
  verified,
  last_registered_at,
  last_sent_at,
  last_receipt_at,
  last_failure_reason,
  disabled_at,
  created_at,
  updated_at
)
select
  mp.owner_kind,
  case
    when mp.owner_kind = 'user' then 'user:' || mp.user_id::text
    else 'guest:' || mp.installation_id
  end,
  mp.user_id,
  mp.installation_id,
  mp.platform,
  'mobile_push',
  mp.push_provider,
  mp.push_provider || ':' || mp.platform || ':' || coalesce(mp.installation_id, md5(mp.token)),
  mp.token,
  mp.app_version,
  mp.device_name,
  mp.device_secret_hash,
  coalesce(mp.is_active, true),
  true,
  mp.last_registered_at,
  mp.last_sent_at,
  mp.last_receipt_at,
  mp.last_failure_reason,
  mp.disabled_at,
  mp.created_at,
  mp.updated_at
from public.mobile_push_installations_v2 mp
on conflict (owner_key, destination_key) do update
set token = excluded.token,
    app_version = excluded.app_version,
    device_name = excluded.device_name,
    device_secret_hash = excluded.device_secret_hash,
    is_active = excluded.is_active,
    disabled_at = excluded.disabled_at,
    last_registered_at = excluded.last_registered_at,
    last_sent_at = excluded.last_sent_at,
    last_receipt_at = excluded.last_receipt_at,
    last_failure_reason = excluded.last_failure_reason,
    updated_at = excluded.updated_at;

insert into public.notification_rules_v3 (
  owner_kind,
  owner_key,
  user_id,
  installation_id,
  intent,
  visible_in_following,
  enabled,
  scope_kind,
  scope_key,
  launch_id,
  state,
  provider,
  rocket_id,
  pad_key,
  launch_site,
  tier,
  channels,
  timezone,
  prelaunch_offsets_minutes,
  include_liftoff,
  daily_digest_local_time,
  status_change_types,
  notify_net_change,
  created_at,
  updated_at
)
select
  'user',
  'user:' || w.user_id::text,
  w.user_id,
  null,
  'follow',
  true,
  true,
  case wr.rule_type
    when 'launch' then 'launch'
    when 'pad' then 'pad'
    when 'provider' then 'provider'
    when 'rocket' then 'rocket'
    when 'launch_site' then 'launch_site'
    when 'state' then 'state'
    else 'tier'
  end,
  lower(trim(wr.rule_value)),
  case
    when wr.rule_type = 'launch'
      and wr.rule_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then wr.rule_value::uuid
    else null
  end,
  case when wr.rule_type = 'state' then upper(trim(wr.rule_value)) else null end,
  case when wr.rule_type = 'provider' then trim(wr.rule_value) else null end,
  case when wr.rule_type = 'rocket' and wr.rule_value ~ '^ll2:[0-9]+$' then substring(wr.rule_value from 5)::int else null end,
  case when wr.rule_type = 'pad' then trim(wr.rule_value) else null end,
  case when wr.rule_type = 'launch_site' then trim(wr.rule_value) else null end,
  case when wr.rule_type = 'tier' then trim(wr.rule_value) else null end,
  '{}'::text[],
  'UTC',
  '{}'::smallint[],
  false,
  null,
  '{}'::text[],
  false,
  coalesce(wr.created_at, w.created_at, now()),
  coalesce(wr.created_at, w.created_at, now())
from public.watchlist_rules wr
join public.watchlists w on w.id = wr.watchlist_id
on conflict (owner_key, scope_kind, scope_key) do update
set intent = 'follow',
    visible_in_following = true,
    enabled = true,
    updated_at = now();

insert into public.notification_rules_v3 (
  owner_kind,
  owner_key,
  user_id,
  installation_id,
  intent,
  visible_in_following,
  enabled,
  scope_kind,
  scope_key,
  launch_id,
  channels,
  timezone,
  prelaunch_offsets_minutes,
  include_liftoff,
  daily_digest_local_time,
  status_change_types,
  notify_net_change,
  created_at,
  updated_at
)
select
  'user',
  'user:' || lnp.user_id::text,
  lnp.user_id,
  null,
  'notifications_only',
  false,
  true,
  'launch',
  lower(lnp.launch_id::text),
  lnp.launch_id,
  array[lnp.channel]::text[],
  coalesce(nullif(lnp.timezone, ''), 'UTC'),
  coalesce(array(select unnest(coalesce(lnp.t_minus_minutes, '{}'::integer[]))::smallint), '{}'::smallint[]),
  false,
  null,
  case when coalesce(lnp.notify_status_change, false) then array['any']::text[] else '{}'::text[] end,
  coalesce(lnp.notify_net_change, false),
  coalesce(lnp.updated_at, lnp.created_at, now()),
  coalesce(lnp.updated_at, lnp.created_at, now())
from public.launch_notification_preferences lnp
on conflict (owner_key, scope_kind, scope_key) do update
set intent = 'notifications_only',
    enabled = true,
    channels = (
      select array(
        select distinct unnest(coalesce(public.notification_rules_v3.channels, '{}'::text[]) || excluded.channels)
      )
    ),
    timezone = excluded.timezone,
    prelaunch_offsets_minutes = excluded.prelaunch_offsets_minutes,
    status_change_types = excluded.status_change_types,
    notify_net_change = excluded.notify_net_change,
    updated_at = excluded.updated_at;

insert into public.notification_rules_v3 (
  owner_kind,
  owner_key,
  user_id,
  installation_id,
  intent,
  visible_in_following,
  enabled,
  scope_kind,
  scope_key,
  launch_id,
  state,
  provider,
  filter_preset_id,
  tier,
  channels,
  timezone,
  prelaunch_offsets_minutes,
  include_liftoff,
  daily_digest_local_time,
  status_change_types,
  notify_net_change,
  created_at,
  updated_at
)
select
  'user',
  'user:' || nar.user_id::text,
  nar.user_id,
  null,
  case when nar.kind = 'follow' then 'follow' else 'notifications_only' end,
  case when nar.kind = 'follow' then true else false end,
  true,
  case
    when nar.kind = 'region_us' then 'all_us'
    when nar.kind = 'state' then 'state'
    when nar.kind = 'filter_preset' then 'preset'
    when nar.follow_rule_type = 'launch' then 'launch'
    when nar.follow_rule_type = 'pad' then 'pad'
    when nar.follow_rule_type = 'provider' then 'provider'
    else 'tier'
  end,
  case
    when nar.kind = 'region_us' then 'us'
    when nar.kind = 'state' then lower(trim(nar.state))
    when nar.kind = 'filter_preset' then lower(nar.filter_preset_id::text)
    else lower(trim(nar.follow_rule_value))
  end,
  case
    when nar.kind = 'follow'
      and nar.follow_rule_type = 'launch'
      and nar.follow_rule_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then nar.follow_rule_value::uuid
    else null
  end,
  case when nar.kind = 'state' then upper(trim(nar.state)) else null end,
  case when nar.kind = 'follow' and nar.follow_rule_type = 'provider' then trim(nar.follow_rule_value) else null end,
  case when nar.kind = 'filter_preset' then nar.filter_preset_id else null end,
  case when nar.kind = 'follow' and nar.follow_rule_type = 'tier' then trim(nar.follow_rule_value) else null end,
  array['push']::text[],
  'UTC',
  case
    when np.notify_t_minus_60 is not false and np.notify_t_minus_10 is not false then array[60,10]::smallint[]
    when np.notify_t_minus_60 is not false then array[60]::smallint[]
    when np.notify_t_minus_10 is not false then array[10]::smallint[]
    else '{}'::smallint[]
  end,
  coalesce(np.notify_liftoff, false),
  null,
  case when coalesce(np.notify_status_change, false) then array['any']::text[] else '{}'::text[] end,
  coalesce(np.notify_net_change, false),
  coalesce(nar.updated_at, nar.created_at, now()),
  coalesce(nar.updated_at, nar.created_at, now())
from public.notification_alert_rules nar
left join public.notification_preferences np on np.user_id = nar.user_id
on conflict (owner_key, scope_kind, scope_key) do update
set intent = case when excluded.intent = 'follow' then 'follow' else public.notification_rules_v3.intent end,
    visible_in_following = public.notification_rules_v3.visible_in_following or excluded.visible_in_following,
    enabled = true,
    channels = (
      select array(
        select distinct unnest(coalesce(public.notification_rules_v3.channels, '{}'::text[]) || excluded.channels)
      )
    ),
    prelaunch_offsets_minutes = case
      when cardinality(excluded.prelaunch_offsets_minutes) > 0 then excluded.prelaunch_offsets_minutes
      else public.notification_rules_v3.prelaunch_offsets_minutes
    end,
    include_liftoff = public.notification_rules_v3.include_liftoff or excluded.include_liftoff,
    status_change_types = case
      when cardinality(excluded.status_change_types) > 0 then excluded.status_change_types
      else public.notification_rules_v3.status_change_types
    end,
    notify_net_change = public.notification_rules_v3.notify_net_change or excluded.notify_net_change,
    updated_at = greatest(public.notification_rules_v3.updated_at, excluded.updated_at);

insert into public.notification_rules_v3 (
  owner_kind,
  owner_key,
  user_id,
  installation_id,
  intent,
  visible_in_following,
  enabled,
  scope_kind,
  scope_key,
  launch_id,
  state,
  provider,
  filter_preset_id,
  tier,
  channels,
  timezone,
  prelaunch_offsets_minutes,
  include_liftoff,
  daily_digest_local_time,
  status_change_types,
  notify_net_change,
  created_at,
  updated_at
)
select
  mpr.owner_kind,
  case
    when mpr.owner_kind = 'user' then 'user:' || mpr.user_id::text
    else 'guest:' || mpr.installation_id
  end,
  mpr.user_id,
  mpr.installation_id,
  'notifications_only',
  false,
  coalesce(mpr.enabled, true),
  case
    when mpr.scope_kind = 'all_us' then 'all_us'
    when mpr.scope_kind = 'state' then 'state'
    when mpr.scope_kind = 'launch' then 'launch'
    when mpr.scope_kind = 'all_launches' then 'all_launches'
    when mpr.scope_kind = 'preset' then 'preset'
    when mpr.follow_rule_type = 'launch' then 'launch'
    when mpr.follow_rule_type = 'pad' then 'pad'
    when mpr.follow_rule_type = 'provider' then 'provider'
    else 'tier'
  end,
  case
    when mpr.scope_kind = 'all_us' then 'us'
    when mpr.scope_kind = 'state' then lower(trim(mpr.state))
    when mpr.scope_kind = 'launch' then lower(mpr.launch_id::text)
    when mpr.scope_kind = 'all_launches' then 'all'
    when mpr.scope_kind = 'preset' then lower(mpr.filter_preset_id::text)
    else lower(trim(mpr.follow_rule_value))
  end,
  mpr.launch_id,
  case when mpr.scope_kind = 'state' then upper(trim(mpr.state)) else null end,
  case when mpr.scope_kind = 'follow' and mpr.follow_rule_type = 'provider' then trim(mpr.follow_rule_value) else null end,
  case when mpr.scope_kind = 'preset' then mpr.filter_preset_id else null end,
  case when mpr.scope_kind = 'follow' and mpr.follow_rule_type = 'tier' then trim(mpr.follow_rule_value) else null end,
  array['push']::text[],
  coalesce(nullif(mpr.timezone, ''), 'UTC'),
  coalesce(array(select unnest(coalesce(mpr.prelaunch_offsets_minutes, '{}'::integer[]))::smallint), '{}'::smallint[]),
  false,
  mpr.daily_digest_local_time,
  coalesce(mpr.status_change_types, '{}'::text[]),
  coalesce(mpr.notify_net_change, false),
  coalesce(mpr.updated_at, mpr.created_at, now()),
  coalesce(mpr.updated_at, mpr.created_at, now())
from public.mobile_push_rules_v2 mpr
on conflict (owner_key, scope_kind, scope_key) do update
set enabled = excluded.enabled,
    channels = (
      select array(
        select distinct unnest(coalesce(public.notification_rules_v3.channels, '{}'::text[]) || excluded.channels)
      )
    ),
    timezone = excluded.timezone,
    prelaunch_offsets_minutes = excluded.prelaunch_offsets_minutes,
    daily_digest_local_time = coalesce(excluded.daily_digest_local_time, public.notification_rules_v3.daily_digest_local_time),
    status_change_types = excluded.status_change_types,
    notify_net_change = excluded.notify_net_change,
    updated_at = excluded.updated_at;
