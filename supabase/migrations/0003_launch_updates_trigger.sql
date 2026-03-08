-- Track meaningful launch changes in launch_updates for "recently changed" UX + notifications.

create or replace function public.log_launch_update()
returns trigger
language plpgsql
as $$
declare
  changed text[] := '{}';
  old_values jsonb := '{}'::jsonb;
  new_values jsonb := '{}'::jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.name is distinct from old.name then
    changed := array_append(changed, 'name');
    old_values := old_values || jsonb_build_object('name', old.name);
    new_values := new_values || jsonb_build_object('name', new.name);
  end if;

  if new.status_id is distinct from old.status_id then
    changed := array_append(changed, 'status_id');
    old_values := old_values || jsonb_build_object('status_id', old.status_id);
    new_values := new_values || jsonb_build_object('status_id', new.status_id);
  end if;

  if new.status_name is distinct from old.status_name then
    changed := array_append(changed, 'status_name');
    old_values := old_values || jsonb_build_object('status_name', old.status_name);
    new_values := new_values || jsonb_build_object('status_name', new.status_name);
  end if;

  if new.status_abbrev is distinct from old.status_abbrev then
    changed := array_append(changed, 'status_abbrev');
    old_values := old_values || jsonb_build_object('status_abbrev', old.status_abbrev);
    new_values := new_values || jsonb_build_object('status_abbrev', new.status_abbrev);
  end if;

  if new.net is distinct from old.net then
    changed := array_append(changed, 'net');
    old_values := old_values || jsonb_build_object('net', old.net);
    new_values := new_values || jsonb_build_object('net', new.net);
  end if;

  if new.net_precision is distinct from old.net_precision then
    changed := array_append(changed, 'net_precision');
    old_values := old_values || jsonb_build_object('net_precision', old.net_precision);
    new_values := new_values || jsonb_build_object('net_precision', new.net_precision);
  end if;

  if new.window_start is distinct from old.window_start then
    changed := array_append(changed, 'window_start');
    old_values := old_values || jsonb_build_object('window_start', old.window_start);
    new_values := new_values || jsonb_build_object('window_start', new.window_start);
  end if;

  if new.window_end is distinct from old.window_end then
    changed := array_append(changed, 'window_end');
    old_values := old_values || jsonb_build_object('window_end', old.window_end);
    new_values := new_values || jsonb_build_object('window_end', new.window_end);
  end if;

  if new.webcast_live is distinct from old.webcast_live then
    changed := array_append(changed, 'webcast_live');
    old_values := old_values || jsonb_build_object('webcast_live', old.webcast_live);
    new_values := new_values || jsonb_build_object('webcast_live', new.webcast_live);
  end if;

  if new.video_url is distinct from old.video_url then
    changed := array_append(changed, 'video_url');
    old_values := old_values || jsonb_build_object('video_url', old.video_url);
    new_values := new_values || jsonb_build_object('video_url', new.video_url);
  end if;

  if new.featured is distinct from old.featured then
    changed := array_append(changed, 'featured');
    old_values := old_values || jsonb_build_object('featured', old.featured);
    new_values := new_values || jsonb_build_object('featured', new.featured);
  end if;

  if new.hidden is distinct from old.hidden then
    changed := array_append(changed, 'hidden');
    old_values := old_values || jsonb_build_object('hidden', old.hidden);
    new_values := new_values || jsonb_build_object('hidden', new.hidden);
  end if;

  if new.tier_override is distinct from old.tier_override then
    changed := array_append(changed, 'tier_override');
    old_values := old_values || jsonb_build_object('tier_override', old.tier_override);
    new_values := new_values || jsonb_build_object('tier_override', new.tier_override);
  end if;

  if array_length(changed, 1) is null then
    return new;
  end if;

  insert into public.launch_updates(launch_id, changed_fields, old_values, new_values, detected_at)
  values (new.id, changed, old_values, new_values, now());

  return new;
end;
$$;

drop trigger if exists trg_log_launch_update on public.launches;

create trigger trg_log_launch_update
after update on public.launches
for each row
execute function public.log_launch_update();

