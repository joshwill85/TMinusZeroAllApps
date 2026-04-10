create table if not exists public.launch_refresh_state (
  cache_key text primary key,
  scope text not null check (scope in ('feed_public', 'feed_live', 'detail_public', 'detail_live')),
  launch_id uuid references public.launches(id) on delete cascade,
  updated_at timestamptz not null default now(),
  revision bigint not null default 1 check (revision >= 0),
  created_at timestamptz not null default now()
);

create index if not exists launch_refresh_state_scope_idx
  on public.launch_refresh_state(scope);

create index if not exists launch_refresh_state_launch_id_idx
  on public.launch_refresh_state(launch_id);

alter table public.launch_refresh_state enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_refresh_state'
      and policyname = 'public read public launch refresh state'
  ) then
    create policy "public read public launch refresh state"
      on public.launch_refresh_state
      for select
      using (scope in ('feed_public', 'detail_public'));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_refresh_state'
      and policyname = 'premium read live launch refresh state'
  ) then
    create policy "premium read live launch refresh state"
      on public.launch_refresh_state
      for select
      using (
        scope in ('feed_live', 'detail_live')
        and ((select public.is_paid_user()) or (select public.is_admin()))
      );
  end if;
end
$$;

create or replace function public.touch_launch_refresh_state(
  p_cache_key text,
  p_scope text,
  p_launch_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.launch_refresh_state (
    cache_key,
    scope,
    launch_id,
    updated_at,
    revision
  )
  values (
    p_cache_key,
    p_scope,
    p_launch_id,
    now(),
    1
  )
  on conflict (cache_key)
  do update
  set
    scope = excluded.scope,
    launch_id = excluded.launch_id,
    updated_at = now(),
    revision = public.launch_refresh_state.revision + 1;
end;
$$;

create or replace function public.broadcast_launch_refresh_state_changes()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, realtime
as $$
begin
  perform realtime.broadcast_changes(
    'launch-refresh:' || coalesce(new.cache_key, old.cache_key),
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );

  return null;
end;
$$;

create or replace function public.handle_launch_refresh_state_from_live_launches()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_launch_id uuid := coalesce(new.id, old.id);
  should_touch boolean := false;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_touch := new.hidden is not true;
  elsif tg_op = 'DELETE' then
    should_touch := old.hidden is not true;
  else
    should_touch := old.hidden is not true or new.hidden is not true;
  end if;

  if should_touch and current_launch_id is not null then
    perform public.touch_launch_refresh_state('feed:live', 'feed_live', null);
    perform public.touch_launch_refresh_state('detail:live:' || current_launch_id::text, 'detail_live', current_launch_id);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.handle_launch_refresh_state_from_public_cache()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_launch_id uuid := coalesce(new.launch_id, old.launch_id);
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if current_launch_id is not null then
    perform public.touch_launch_refresh_state('feed:public', 'feed_public', null);
    perform public.touch_launch_refresh_state('detail:public:' || current_launch_id::text, 'detail_public', current_launch_id);
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.handle_launch_refresh_state_from_manifest_tables()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  current_launch_id uuid := coalesce(new.launch_id, old.launch_id);
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if current_launch_id is not null then
    perform public.touch_launch_refresh_state('detail:public:' || current_launch_id::text, 'detail_public', current_launch_id);
    perform public.touch_launch_refresh_state('detail:live:' || current_launch_id::text, 'detail_live', current_launch_id);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists launch_refresh_state_broadcast_trigger on public.launch_refresh_state;
create trigger launch_refresh_state_broadcast_trigger
after insert or update
on public.launch_refresh_state
for each row
execute function public.broadcast_launch_refresh_state_changes();

drop trigger if exists touch_launch_refresh_state_live_launches on public.launches;
create trigger touch_launch_refresh_state_live_launches
after insert or update or delete
on public.launches
for each row
execute function public.handle_launch_refresh_state_from_live_launches();

drop trigger if exists touch_launch_refresh_state_public_cache on public.launches_public_cache;
create trigger touch_launch_refresh_state_public_cache
after insert or update or delete
on public.launches_public_cache
for each row
execute function public.handle_launch_refresh_state_from_public_cache();

drop trigger if exists touch_launch_refresh_state_payload_flights on public.ll2_payload_flights;
create trigger touch_launch_refresh_state_payload_flights
after insert or update or delete
on public.ll2_payload_flights
for each row
execute function public.handle_launch_refresh_state_from_manifest_tables();

drop trigger if exists touch_launch_refresh_state_spacecraft_flights on public.ll2_spacecraft_flights;
create trigger touch_launch_refresh_state_spacecraft_flights
after insert or update or delete
on public.ll2_spacecraft_flights
for each row
execute function public.handle_launch_refresh_state_from_manifest_tables();

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'realtime'
      and tablename = 'messages'
      and policyname = 'premium receive launch refresh broadcasts'
  ) then
    create policy "premium receive launch refresh broadcasts"
      on realtime.messages
      for select
      to authenticated
      using (
        realtime.topic() like 'launch-refresh:%'
        and ((select public.is_paid_user()) or (select public.is_admin()))
      );
  end if;
end
$$;

insert into public.launch_refresh_state (cache_key, scope, launch_id, updated_at, revision)
values (
  'feed:public',
  'feed_public',
  null,
  coalesce((select max(cache_generated_at) from public.launches_public_cache), now()),
  1
)
on conflict (cache_key)
do update
set
  scope = excluded.scope,
  launch_id = excluded.launch_id,
  updated_at = greatest(public.launch_refresh_state.updated_at, excluded.updated_at);

insert into public.launch_refresh_state (cache_key, scope, launch_id, updated_at, revision)
values (
  'feed:live',
  'feed_live',
  null,
  coalesce((select max(last_updated_source) from public.launches where hidden = false), now()),
  1
)
on conflict (cache_key)
do update
set
  scope = excluded.scope,
  launch_id = excluded.launch_id,
  updated_at = greatest(public.launch_refresh_state.updated_at, excluded.updated_at);

insert into public.launch_refresh_state (cache_key, scope, launch_id, updated_at, revision)
select
  'detail:public:' || c.launch_id::text,
  'detail_public',
  c.launch_id,
  coalesce(c.cache_generated_at, now()),
  1
from public.launches_public_cache c
on conflict (cache_key)
do update
set
  scope = excluded.scope,
  launch_id = excluded.launch_id,
  updated_at = greatest(public.launch_refresh_state.updated_at, excluded.updated_at);

insert into public.launch_refresh_state (cache_key, scope, launch_id, updated_at, revision)
select
  'detail:live:' || l.id::text,
  'detail_live',
  l.id,
  coalesce(l.last_updated_source, l.updated_at, l.created_at, now()),
  1
from public.launches l
on conflict (cache_key)
do update
set
  scope = excluded.scope,
  launch_id = excluded.launch_id,
  updated_at = greatest(public.launch_refresh_state.updated_at, excluded.updated_at);
