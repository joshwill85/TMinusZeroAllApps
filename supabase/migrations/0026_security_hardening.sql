-- Enable RLS on public tables flagged by the linter and lock them down by default.
alter table if exists public.stripe_customers enable row level security;
alter table if exists public.subscriptions enable row level security;
alter table if exists public.api_rate_counters enable row level security;
alter table if exists public.ll2_locations enable row level security;
alter table if exists public.ll2_pads enable row level security;
alter table if exists public.ll2_agencies enable row level security;
alter table if exists public.ll2_rocket_configs enable row level security;
alter table if exists public.launch_updates enable row level security;
alter table if exists public.notifications_outbox enable row level security;
alter table if exists public.notification_usage_monthly enable row level security;
alter table if exists public.ingestion_runs enable row level security;
alter table if exists public.webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'subscriptions' and policyname = 'user reads own subscription'
  ) then
    create policy "user reads own subscription" on public.subscriptions
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'notifications_outbox' and policyname = 'admin read notifications outbox'
  ) then
    create policy "admin read notifications outbox" on public.notifications_outbox
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'notification_usage_monthly' and policyname = 'admin read notification usage'
  ) then
    create policy "admin read notification usage" on public.notification_usage_monthly
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'ingestion_runs' and policyname = 'admin read ingestion runs'
  ) then
    create policy "admin read ingestion runs" on public.ingestion_runs
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'webhook_events' and policyname = 'admin read webhook events'
  ) then
    create policy "admin read webhook events" on public.webhook_events
      for select using (public.is_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'launch_updates' and policyname = 'admin read launch updates'
  ) then
    create policy "admin read launch updates" on public.launch_updates
      for select using (public.is_admin());
  end if;
end;
$$;

-- Lock function search_path to avoid role-mutable lookup.
alter function public.get_launch_filter_options() set search_path = public;
alter function public.log_launch_update() set search_path = public;
alter function public.increment_api_rate(text, timestamptz, int) set search_path = public;
alter function public.try_increment_api_rate(text, timestamptz, int, int) set search_path = public;
alter function public.is_admin() set search_path = public;
alter function public.is_paid_user() set search_path = public;
alter function public.invoke_edge_job(text) set search_path = public;
