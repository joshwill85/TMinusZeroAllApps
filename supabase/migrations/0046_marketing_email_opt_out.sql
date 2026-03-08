-- Marketing email opt-out preference + one-click unsubscribe token.
-- Also ensure calendar_token has a default for new user inserts.

alter table public.profiles
  alter column calendar_token set default gen_random_uuid(),
  add column if not exists marketing_email_opt_in boolean not null default true,
  add column if not exists marketing_email_opt_in_updated_at timestamptz not null default now(),
  add column if not exists marketing_unsubscribe_token uuid not null default gen_random_uuid();

-- Backfill timestamp to something meaningful for existing users.
update public.profiles
  set marketing_email_opt_in_updated_at = created_at;

create unique index if not exists profiles_marketing_unsubscribe_token_key
  on public.profiles(marketing_unsubscribe_token);

create or replace function public.unsubscribe_marketing_emails(token_in uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.marketing_unsubscribe_token = token_in
  ) then
    return false;
  end if;

  update public.profiles
    set marketing_email_opt_in = false,
        marketing_email_opt_in_updated_at = now(),
        updated_at = now()
    where marketing_unsubscribe_token = token_in;

  return true;
end;
$$;

grant execute on function public.unsubscribe_marketing_emails(uuid) to anon, authenticated;
