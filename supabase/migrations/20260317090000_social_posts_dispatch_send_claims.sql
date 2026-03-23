-- Social posts dispatch reliability hardening:
-- - atomic claim RPC with send locks
-- - `sending` status support
-- - dispatch runtime/claim tuning settings
-- - 30-minute scheduler cadence for social_posts_dispatch

alter table public.social_posts
  add column if not exists send_lock_id text,
  add column if not exists send_locked_at timestamptz;

alter table public.social_posts
  drop constraint if exists social_posts_status_check;

alter table public.social_posts
  add constraint social_posts_status_check
  check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'async'));

create index if not exists social_posts_dispatch_claim_idx
  on public.social_posts(status, platform, post_type, scheduled_for, thread_segment_index, created_at)
  where status in ('pending', 'failed');

create index if not exists social_posts_send_lock_stale_idx
  on public.social_posts(status, send_locked_at)
  where status = 'sending';

create index if not exists social_posts_send_lock_id_idx
  on public.social_posts(send_lock_id)
  where send_lock_id is not null;

create or replace function public.claim_social_posts_for_send(
  p_lock_id text,
  p_platforms text[],
  p_post_types text[],
  p_statuses text[] default array['pending','failed'],
  p_scheduled_before timestamptz default now(),
  p_scheduled_after timestamptz default null,
  p_limit int default 100,
  p_max_attempts int default null,
  p_send_lock_stale_minutes int default 15
)
returns setof public.social_posts
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_stale_minutes int := greatest(1, least(coalesce(p_send_lock_stale_minutes, 15), 240));
  v_stale_cutoff timestamptz := now() - make_interval(mins => v_stale_minutes);
begin
  if p_lock_id is null or length(trim(p_lock_id)) = 0 then
    raise exception 'lock_id_required';
  end if;

  if coalesce(array_length(p_platforms, 1), 0) = 0 then
    return;
  end if;

  if coalesce(array_length(p_post_types, 1), 0) = 0 then
    return;
  end if;

  update public.social_posts
  set status = 'pending',
      send_lock_id = null,
      send_locked_at = null,
      updated_at = now()
  where status = 'sending'
    and send_locked_at is not null
    and send_locked_at <= v_stale_cutoff;

  return query
  with candidates as (
    select sp.id
    from public.social_posts sp
    where sp.platform = any(p_platforms)
      and sp.post_type = any(p_post_types)
      and sp.status = any(coalesce(p_statuses, array['pending','failed']::text[]))
      and (p_scheduled_before is null or sp.scheduled_for <= p_scheduled_before)
      and (p_scheduled_after is null or sp.scheduled_for >= p_scheduled_after)
      and (p_max_attempts is null or sp.attempts < p_max_attempts)
    order by sp.scheduled_for asc nulls first, sp.thread_segment_index asc nulls first, sp.created_at asc
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.social_posts sp
    set status = 'sending',
        send_lock_id = p_lock_id,
        send_locked_at = now(),
        updated_at = now(),
        last_error = null
    from candidates c
    where sp.id = c.id
    returning sp.*
  )
  select * from claimed;
end;
$$;

revoke execute on function public.claim_social_posts_for_send(text, text[], text[], text[], timestamptz, timestamptz, int, int, int) from public;
grant execute on function public.claim_social_posts_for_send(text, text[], text[], text[], timestamptz, timestamptz, int, int, int) to service_role;

insert into public.system_settings (key, value)
values
  ('social_posts_dispatch_runtime_budget_ms', '50000'::jsonb),
  ('social_posts_dispatch_claim_batch_size', '200'::jsonb),
  ('social_posts_send_lock_stale_minutes', '15'::jsonb)
on conflict (key) do nothing;

insert into public.managed_scheduler_jobs (
  cron_job_name,
  edge_job_slug,
  interval_seconds,
  offset_seconds,
  enabled,
  max_attempts,
  next_run_at
)
values (
  'social_posts_dispatch',
  'social-posts-dispatch',
  1800,
  480,
  true,
  3,
  public.managed_scheduler_next_run(now(), 1800, 480)
)
on conflict (cron_job_name) do update
set edge_job_slug = excluded.edge_job_slug,
    interval_seconds = excluded.interval_seconds,
    offset_seconds = excluded.offset_seconds,
    enabled = excluded.enabled,
    max_attempts = excluded.max_attempts,
    next_run_at = public.managed_scheduler_next_run(now(), excluded.interval_seconds, excluded.offset_seconds),
    updated_at = now();

-- Keep legacy pg_cron fallback aligned when that job already exists.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'social_posts_dispatch') then
    perform cron.unschedule('social_posts_dispatch');
    perform cron.schedule(
      'social_posts_dispatch',
      '8,38 * * * *',
      $job$select public.invoke_edge_job('social-posts-dispatch');$job$
    );
  end if;
exception
  when undefined_table then
    null;
end $$;
