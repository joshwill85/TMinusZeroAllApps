-- Track last time we reconciled a customer's subscription state from Stripe.

alter table public.stripe_customers
  add column if not exists last_subscription_sync_at timestamptz;

create index if not exists stripe_customers_last_subscription_sync_at_idx
  on public.stripe_customers(last_subscription_sync_at);

