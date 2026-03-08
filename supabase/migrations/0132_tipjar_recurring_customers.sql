-- Tip Jar recurring: store a separate Stripe customer mapping so recurring tips can be managed/canceled
-- without impacting Premium subscription entitlements.

create table if not exists public.tipjar_customers (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  stripe_customer_id text unique not null,
  created_at timestamptz not null default now()
);

alter table public.tipjar_customers enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'tipjar_customers' and policyname = 'user reads own tipjar customer'
  ) then
    create policy "user reads own tipjar customer" on public.tipjar_customers
      for select using (auth.uid() = user_id);
  end if;
end;
$$;

