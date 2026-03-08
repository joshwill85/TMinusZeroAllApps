-- Allow admins to read trajectory constraints for inspection/debugging.

alter table if exists public.launch_trajectory_constraints enable row level security;

drop policy if exists "admin read launch trajectory constraints" on public.launch_trajectory_constraints;
create policy "admin read launch trajectory constraints"
  on public.launch_trajectory_constraints
  for select
  using (public.is_admin());

