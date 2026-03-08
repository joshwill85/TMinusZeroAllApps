-- Use initplan evaluation for auth.uid() in RLS policies.
do $$
begin
  if to_regclass('public.watchlists') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'watchlists'
        and policyname = 'user owns watchlists'
    )
  then
    alter policy "user owns watchlists" on public.watchlists
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.watchlist_rules') is not null
    and to_regclass('public.watchlists') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'watchlist_rules'
        and policyname = 'user owns watchlist rules'
    )
  then
    alter policy "user owns watchlist rules" on public.watchlist_rules
      using (
        exists (
          select 1
          from public.watchlists w
          where w.id = watchlist_id
            and w.user_id = (select auth.uid())
        )
      )
      with check (
        exists (
          select 1
          from public.watchlists w
          where w.id = watchlist_id
            and w.user_id = (select auth.uid())
        )
      );
  end if;

  if to_regclass('public.notification_preferences') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'notification_preferences'
        and policyname = 'user owns prefs'
    )
  then
    alter policy "user owns prefs" on public.notification_preferences
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.push_subscriptions') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'push_subscriptions'
        and policyname = 'user owns push subs'
    )
  then
    alter policy "user owns push subs" on public.push_subscriptions
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.launch_notification_preferences') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'launch_notification_preferences'
        and policyname = 'user owns launch notification prefs'
    )
  then
    alter policy "user owns launch notification prefs" on public.launch_notification_preferences
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.profiles') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and policyname = 'profiles read own'
    )
  then
    alter policy "profiles read own" on public.profiles
      using ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.profiles') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'profiles'
        and policyname = 'profiles update own'
    )
  then
    alter policy "profiles update own" on public.profiles
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.subscriptions') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'subscriptions'
        and policyname = 'user reads own subscription'
    )
  then
    alter policy "user reads own subscription" on public.subscriptions
      using ((select auth.uid()) = user_id);
  end if;
end $$;
