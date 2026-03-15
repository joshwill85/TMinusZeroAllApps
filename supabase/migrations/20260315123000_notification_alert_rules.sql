create table if not exists public.notification_alert_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  kind text not null check (kind in ('region_us', 'state', 'filter_preset', 'follow')),
  state text,
  filter_preset_id uuid references public.launch_filter_presets(id) on delete cascade,
  follow_rule_type text check (follow_rule_type in ('launch', 'pad', 'provider', 'tier')),
  follow_rule_value text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_alert_rules_kind_scope_check check (
    (kind = 'region_us' and state is null and filter_preset_id is null and follow_rule_type is null and follow_rule_value is null)
    or (kind = 'state' and state is not null and filter_preset_id is null and follow_rule_type is null and follow_rule_value is null)
    or (kind = 'filter_preset' and state is null and filter_preset_id is not null and follow_rule_type is null and follow_rule_value is null)
    or (kind = 'follow' and state is null and filter_preset_id is null and follow_rule_type is not null and follow_rule_value is not null)
  )
);

create index if not exists notification_alert_rules_user_idx
  on public.notification_alert_rules(user_id, updated_at desc);

create unique index if not exists notification_alert_rules_region_us_unique_idx
  on public.notification_alert_rules(user_id)
  where kind = 'region_us';

create unique index if not exists notification_alert_rules_state_unique_idx
  on public.notification_alert_rules(user_id, state)
  where kind = 'state';

create unique index if not exists notification_alert_rules_filter_preset_unique_idx
  on public.notification_alert_rules(user_id, filter_preset_id)
  where kind = 'filter_preset';

create unique index if not exists notification_alert_rules_follow_unique_idx
  on public.notification_alert_rules(user_id, follow_rule_type, follow_rule_value)
  where kind = 'follow';

alter table public.notification_alert_rules enable row level security;

drop policy if exists "user owns notification alert rules" on public.notification_alert_rules;
create policy "user owns notification alert rules"
  on public.notification_alert_rules
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
