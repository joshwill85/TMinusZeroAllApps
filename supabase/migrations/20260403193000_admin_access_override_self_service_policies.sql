-- Allow admins to manage only their own access override rows without requiring
-- a service-role client in the request path.

drop policy if exists "admin writes own access override" on public.admin_access_overrides;
create policy "admin writes own access override"
  on public.admin_access_overrides
  for insert
  with check (auth.uid() = user_id and public.is_admin());

drop policy if exists "admin updates own access override" on public.admin_access_overrides;
create policy "admin updates own access override"
  on public.admin_access_overrides
  for update
  using (auth.uid() = user_id and public.is_admin())
  with check (auth.uid() = user_id and public.is_admin());

drop policy if exists "admin deletes own access override" on public.admin_access_overrides;
create policy "admin deletes own access override"
  on public.admin_access_overrides
  for delete
  using (auth.uid() = user_id and public.is_admin());

drop policy if exists "admin writes own access override events" on public.admin_access_override_events;
create policy "admin writes own access override events"
  on public.admin_access_override_events
  for insert
  with check (
    auth.uid() = user_id
    and auth.uid() = updated_by
    and public.is_admin()
  );
