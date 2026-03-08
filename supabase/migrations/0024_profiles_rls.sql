-- Enable RLS on profiles and allow users to read/update their own record.

alter table public.profiles enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles read own'
  ) then
    create policy "profiles read own" on public.profiles
      for select using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles update own'
  ) then
    create policy "profiles update own" on public.profiles
      for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end;
$$;
