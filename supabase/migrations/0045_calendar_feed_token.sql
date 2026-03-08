-- Add per-user token to support calendar subscriptions (webcal) outside the browser session.

alter table public.profiles
  add column if not exists calendar_token uuid;

alter table public.profiles
  alter column calendar_token set default gen_random_uuid();

update public.profiles
  set calendar_token = gen_random_uuid()
  where calendar_token is null;

alter table public.profiles
  alter column calendar_token set not null;

create unique index if not exists profiles_calendar_token_key
  on public.profiles(calendar_token);

create or replace function public.validate_calendar_token(token_in uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.calendar_token = token_in
  );
$$;

grant execute on function public.validate_calendar_token(uuid) to anon, authenticated;
