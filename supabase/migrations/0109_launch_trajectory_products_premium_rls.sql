-- Harden trajectory products access: premium/admin only.

alter table if exists public.launch_trajectory_products enable row level security;

do $$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_trajectory_products'
      and policyname = 'public read launch trajectory products'
  ) then
    drop policy "public read launch trajectory products" on public.launch_trajectory_products;
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'launch_trajectory_products'
      and policyname = 'paid read launch trajectory products'
  ) then
    create policy "paid read launch trajectory products"
      on public.launch_trajectory_products
      for select
      using (public.is_paid_user() or public.is_admin());
  end if;
end $$;

