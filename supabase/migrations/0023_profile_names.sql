-- Add first/last name fields to profiles and sync from auth metadata.

alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, email, role, timezone, first_name, last_name, created_at, updated_at)
  values (
    new.id,
    new.email,
    'user',
    'America/New_York',
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    now(),
    now()
  )
  on conflict (user_id) do update
    set email = excluded.email,
        first_name = coalesce(excluded.first_name, profiles.first_name),
        last_name = coalesce(excluded.last_name, profiles.last_name),
        updated_at = now();
  return new;
end;
$$;
