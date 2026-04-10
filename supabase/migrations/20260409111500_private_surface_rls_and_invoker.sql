-- Harden internal notification and premium-claim tables before revoking
-- direct SQL access, and ensure the public audited-awards view respects
-- caller RLS context.

alter view if exists public.program_usaspending_audited_awards
set (security_invoker = true);

alter table if exists public.notification_push_destinations_v3 enable row level security;
alter table if exists public.notification_rules_v3 enable row level security;
alter table if exists public.premium_claims enable row level security;

drop policy if exists "service role manage notification push destinations v3" on public.notification_push_destinations_v3;
create policy "service role manage notification push destinations v3"
  on public.notification_push_destinations_v3
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manage notification rules v3" on public.notification_rules_v3;
create policy "service role manage notification rules v3"
  on public.notification_rules_v3
  for all
  to service_role
  using (true)
  with check (true);

drop policy if exists "service role manage premium claims" on public.premium_claims;
create policy "service role manage premium claims"
  on public.premium_claims
  for all
  to service_role
  using (true)
  with check (true);

grant all on table public.notification_push_destinations_v3 to service_role;
grant all on table public.notification_rules_v3 to service_role;
grant all on table public.premium_claims to service_role;
