-- Lightweight, TTL-based locks for Edge scheduled jobs.
-- Used to prevent overlapping runs when a scheduler can trigger concurrent invocations.

create table if not exists public.job_locks (
  lock_name text primary key,
  locked_until timestamptz not null,
  locked_by text not null,
  locked_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent public access via PostgREST.
alter table public.job_locks enable row level security;
revoke all on table public.job_locks from public;
revoke all on table public.job_locks from anon, authenticated;
grant all on table public.job_locks to service_role;

create or replace function public.try_acquire_job_lock(
  lock_name_in text,
  ttl_seconds_in int,
  locked_by_in text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  ttl_seconds int := ttl_seconds_in;
  acquired boolean := false;
  affected_rows int := 0;
begin
  if lock_name_in is null or length(lock_name_in) = 0 then
    raise exception 'lock_name_required';
  end if;
  if locked_by_in is null or length(locked_by_in) = 0 then
    raise exception 'locked_by_required';
  end if;

  ttl_seconds := greatest(1, least(coalesce(ttl_seconds, 60), 3600));

  insert into public.job_locks(lock_name, locked_until, locked_by, locked_at, updated_at)
  values (
    lock_name_in,
    now() + make_interval(secs => ttl_seconds),
    locked_by_in,
    now(),
    now()
  )
  on conflict (lock_name) do update
    set locked_until = excluded.locked_until,
        locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        updated_at = excluded.updated_at
    where public.job_locks.locked_until < now();

  get diagnostics affected_rows = row_count;
  acquired := affected_rows > 0;
  return acquired;
end;
$$;

create or replace function public.release_job_lock(
  lock_name_in text,
  locked_by_in text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  released boolean := false;
  affected_rows int := 0;
begin
  if lock_name_in is null or length(lock_name_in) = 0 then
    raise exception 'lock_name_required';
  end if;
  if locked_by_in is null or length(locked_by_in) = 0 then
    raise exception 'locked_by_required';
  end if;

  update public.job_locks
  set locked_until = now(),
      updated_at = now()
  where lock_name = lock_name_in
    and locked_by = locked_by_in;

  get diagnostics affected_rows = row_count;
  released := affected_rows > 0;
  return released;
end;
$$;

revoke execute on function public.try_acquire_job_lock(text, int, text) from public;
grant execute on function public.try_acquire_job_lock(text, int, text) to service_role;

revoke execute on function public.release_job_lock(text, text) from public;
grant execute on function public.release_job_lock(text, text) to service_role;
