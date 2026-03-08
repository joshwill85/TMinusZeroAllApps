-- Lock down profile role changes to service role only.

revoke update (role) on table public.profiles from authenticated;
revoke update (role) on table public.profiles from anon;
grant update (role) on table public.profiles to service_role;

create or replace function public.block_profile_role_change()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role then
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'role_change_not_allowed';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_block_role_change on public.profiles;
create trigger profiles_block_role_change
  before update on public.profiles
  for each row execute procedure public.block_profile_role_change();
