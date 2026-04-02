-- Prompt FAA rematch when launch timing or pad coordinates change materially.

create table if not exists public.faa_launch_match_dirty_launches (
  launch_id uuid primary key references public.launches(id) on delete cascade,
  reasons text[] not null default '{}'::text[],
  first_queued_at timestamptz not null default now(),
  last_queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists faa_launch_match_dirty_launches_last_queued_idx
  on public.faa_launch_match_dirty_launches (last_queued_at asc);

alter table public.faa_launch_match_dirty_launches enable row level security;

revoke all on table public.faa_launch_match_dirty_launches from public;
revoke all on table public.faa_launch_match_dirty_launches from anon, authenticated;
grant all on table public.faa_launch_match_dirty_launches to service_role;

create or replace function public.enqueue_faa_launch_match_dirty_launch(
  launch_id_in uuid,
  reasons_in text[] default '{}'::text[]
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_now timestamptz := now();
  v_scheduled_for timestamptz := date_trunc('minute', v_now);
begin
  if launch_id_in is null then
    return false;
  end if;

  insert into public.faa_launch_match_dirty_launches (
    launch_id,
    reasons,
    first_queued_at,
    last_queued_at,
    updated_at
  )
  values (
    launch_id_in,
    coalesce(reasons_in, '{}'::text[]),
    v_now,
    v_now,
    v_now
  )
  on conflict (launch_id) do update
    set reasons = (
          select coalesce(array_agg(distinct reason order by reason), '{}'::text[])
          from unnest(
            coalesce(public.faa_launch_match_dirty_launches.reasons, '{}'::text[])
            || coalesce(excluded.reasons, '{}'::text[])
          ) as reason
        ),
        last_queued_at = v_now,
        updated_at = v_now;

  insert into public.managed_scheduler_queue (
    cron_job_name,
    edge_job_slug,
    scheduled_for,
    status,
    attempts,
    max_attempts
  )
  values (
    'faa_launch_match',
    'faa-launch-match',
    v_scheduled_for,
    'queued',
    0,
    3
  )
  on conflict (cron_job_name, scheduled_for) do nothing;

  return true;
end;
$$;

revoke execute on function public.enqueue_faa_launch_match_dirty_launch(uuid, text[]) from public;
grant execute on function public.enqueue_faa_launch_match_dirty_launch(uuid, text[]) to service_role;

create or replace function public.mark_launch_dirty_for_faa_match()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  reasons text[] := '{}'::text[];
begin
  if tg_op = 'UPDATE' and new.hidden = true then
    delete from public.faa_launch_match_dirty_launches where launch_id = new.id;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.hidden = false then
      perform public.enqueue_faa_launch_match_dirty_launch(new.id, array['launch_insert']);
    end if;
    return new;
  end if;

  if new.hidden = true then
    return new;
  end if;

  if new.net is distinct from old.net then
    reasons := array_append(reasons, 'net');
  end if;

  if new.window_start is distinct from old.window_start then
    reasons := array_append(reasons, 'window_start');
  end if;

  if new.window_end is distinct from old.window_end then
    reasons := array_append(reasons, 'window_end');
  end if;

  if new.pad_latitude is distinct from old.pad_latitude then
    reasons := array_append(reasons, 'pad_latitude');
  end if;

  if new.pad_longitude is distinct from old.pad_longitude then
    reasons := array_append(reasons, 'pad_longitude');
  end if;

  if new.hidden is distinct from old.hidden and new.hidden = false then
    reasons := array_append(reasons, 'hidden');
  end if;

  if array_length(reasons, 1) is not null then
    perform public.enqueue_faa_launch_match_dirty_launch(new.id, reasons);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_mark_launch_dirty_for_faa_match on public.launches;

create trigger trg_mark_launch_dirty_for_faa_match
after insert or update of net, window_start, window_end, pad_latitude, pad_longitude, hidden
on public.launches
for each row
execute function public.mark_launch_dirty_for_faa_match();
