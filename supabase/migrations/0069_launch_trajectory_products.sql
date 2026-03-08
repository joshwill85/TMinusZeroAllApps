-- Store precomputed AR trajectory products per launch.

create table if not exists public.launch_trajectory_products (
  launch_id uuid primary key references public.launches(id) on delete cascade,
  version text not null,
  quality int not null,
  generated_at timestamptz not null default now(),
  product jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists launch_trajectory_products_generated_idx
  on public.launch_trajectory_products (generated_at desc);

alter table if exists public.launch_trajectory_products enable row level security;

drop policy if exists "public read launch trajectory products" on public.launch_trajectory_products;
create policy "public read launch trajectory products"
  on public.launch_trajectory_products
  for select
  using (true);
