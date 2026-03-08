-- Calendar subscription tokens should only grant access for Premium (or admin) accounts.

create or replace function public.validate_calendar_token(token_in uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    left join public.subscriptions s on s.user_id = p.user_id
    where p.calendar_token = token_in
      and (
        p.role = 'admin'
        or lower(coalesce(s.status, '')) in ('active', 'trialing')
      )
  );
$$;

grant execute on function public.validate_calendar_token(uuid) to anon, authenticated;

