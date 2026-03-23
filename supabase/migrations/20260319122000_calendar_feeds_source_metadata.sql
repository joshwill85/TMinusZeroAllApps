alter table public.calendar_feeds
  add column if not exists source_kind text not null default 'all_launches',
  add column if not exists source_preset_id uuid references public.launch_filter_presets(id) on delete set null,
  add column if not exists source_follow_rule_type text,
  add column if not exists source_follow_rule_value text;

alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_source_kind_check;

alter table public.calendar_feeds
  add constraint calendar_feeds_source_kind_check check (
    source_kind in ('all_launches', 'preset', 'follow')
  );

alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_source_follow_rule_type_check;

alter table public.calendar_feeds
  add constraint calendar_feeds_source_follow_rule_type_check check (
    source_follow_rule_type is null or source_follow_rule_type in ('launch', 'pad', 'provider', 'tier')
  );

alter table public.calendar_feeds
  drop constraint if exists calendar_feeds_source_scope_check;

alter table public.calendar_feeds
  add constraint calendar_feeds_source_scope_check check (
    (source_kind = 'all_launches' and source_preset_id is null and source_follow_rule_type is null and source_follow_rule_value is null)
    or (source_kind = 'preset' and source_preset_id is not null and source_follow_rule_type is null and source_follow_rule_value is null)
    or (source_kind = 'follow' and source_preset_id is null and source_follow_rule_type is not null and source_follow_rule_value is not null)
  );
