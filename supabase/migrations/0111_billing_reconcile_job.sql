-- Schedule Stripe billing reconciliation job (gated by system_settings.jobs_enabled).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'billing_reconcile') then
    perform cron.unschedule('billing_reconcile');
  end if;

  -- Run hourly; per-customer throttling is handled in the function via last_subscription_sync_at.
  perform cron.schedule('billing_reconcile', '17 * * * *', $job$
    select public.invoke_edge_job('billing-reconcile');
  $job$);
end $$;

