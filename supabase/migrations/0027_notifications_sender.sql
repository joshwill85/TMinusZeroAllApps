-- Notifications outbox sender + dispatch scheduling + active-only entitlements.

alter table public.notifications_outbox
  add column if not exists attempts int not null default 0,
  add column if not exists locked_at timestamptz;

alter table public.notifications_outbox
  drop constraint if exists notifications_outbox_status_check;

alter table public.notifications_outbox
  add constraint notifications_outbox_status_check
  check (status in ('queued','sending','sent','failed','skipped'));

create or replace function public.claim_notifications_outbox(
  batch_size int,
  channel_filter text default 'sms',
  max_attempts int default 5
)
returns setof public.notifications_outbox
language plpgsql
security definer
as $$
begin
  return query
  with candidates as (
    select id
    from public.notifications_outbox
    where status = 'queued'
      and channel = channel_filter
      and scheduled_for <= now()
      and attempts < max_attempts
    order by scheduled_for asc
    for update skip locked
    limit batch_size
  )
  update public.notifications_outbox
  set status = 'sending',
      locked_at = now(),
      attempts = attempts + 1,
      error = null
  where id in (select id from candidates)
  returning *;
end;
$$;

alter function public.claim_notifications_outbox(int, text, int) set search_path = public;

create or replace function public.is_paid_user()
returns boolean language sql stable as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = auth.uid()
      and s.status = 'active'
  );
$$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notifications_dispatch') then
    perform cron.unschedule('notifications_dispatch');
  end if;
  perform cron.schedule(
    'notifications_dispatch',
    '*/2 * * * *',
    $job$select public.invoke_edge_job('notifications-dispatch');$job$
  );

  if exists (select 1 from cron.job where jobname = 'notifications_send') then
    perform cron.unschedule('notifications_send');
  end if;
  perform cron.schedule(
    'notifications_send',
    '* * * * *',
    $job$select public.invoke_edge_job('notifications-send');$job$
  );
end $$;
