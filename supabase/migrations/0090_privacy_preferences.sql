create table if not exists public.privacy_preferences (
  user_id uuid primary key references public.profiles(user_id) on delete cascade,
  opt_out_sale_share boolean not null default false,
  opt_out_targeted_ads boolean not null default false,
  limit_sensitive boolean not null default false,
  block_third_party_embeds boolean not null default false,
  gpc_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.privacy_preferences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'privacy_preferences' and policyname = 'user owns privacy preferences'
  ) then
    create policy "user owns privacy preferences" on public.privacy_preferences
      for all using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end;
$$;

