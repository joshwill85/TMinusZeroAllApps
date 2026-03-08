-- Public read policies for LL2 catalog join tables (used by info pages).

alter table if exists public.ll2_astronaut_launches enable row level security;
alter table if exists public.ll2_launcher_launches enable row level security;

drop policy if exists "public read ll2 astronaut launches" on public.ll2_astronaut_launches;
create policy "public read ll2 astronaut launches"
  on public.ll2_astronaut_launches
  for select
  using (true);

drop policy if exists "public read ll2 launcher launches" on public.ll2_launcher_launches;
create policy "public read ll2 launcher launches"
  on public.ll2_launcher_launches
  for select
  using (true);

