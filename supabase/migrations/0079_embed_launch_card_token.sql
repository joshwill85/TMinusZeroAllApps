-- Add per-user token to support embedding the "next launch" card on external sites.

alter table public.profiles
  add column if not exists embed_token uuid;

alter table public.profiles
  alter column embed_token set default gen_random_uuid();

update public.profiles
  set embed_token = gen_random_uuid()
  where embed_token is null;

alter table public.profiles
  alter column embed_token set not null;

create unique index if not exists profiles_embed_token_key
  on public.profiles(embed_token);

-- Embed tokens should only grant access for Premium (or admin) accounts.
create or replace function public.validate_embed_token(token_in uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.subscriptions s on s.user_id = p.user_id
    where p.embed_token = token_in
      and (
        p.role = 'admin'
        or lower(coalesce(s.status, '')) in ('active', 'trialing')
      )
  );
$$;

grant execute on function public.validate_embed_token(uuid) to anon, authenticated;

