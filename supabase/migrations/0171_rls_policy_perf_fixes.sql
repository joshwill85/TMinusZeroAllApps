-- RLS performance fixes:
-- - Avoid per-row auth.* re-evaluation in policies by using initplan-friendly patterns.
-- - Restrict service-role management policies to the service_role to eliminate unnecessary policy evaluation.

-- Operational guardrail:
-- If Edge job dispatch is configured, enable LL2 Edge-burst mode to avoid the Postgres sleep-loop.
do $$
declare
  jobs_enabled boolean := false;
  base_url text := '';
  auth_token text := '';
  api_key text := '';
begin
  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '\"' from value::text)) = 'true'
      else false
    end
  into jobs_enabled
  from public.system_settings
  where key = 'jobs_enabled';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '\"' from value::text)
      else ''
    end
  into base_url
  from public.system_settings
  where key = 'jobs_base_url';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '\"' from value::text)
      else ''
    end
  into auth_token
  from public.system_settings
  where key = 'jobs_auth_token';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '\"' from value::text)
      else ''
    end
  into api_key
  from public.system_settings
  where key = 'jobs_apikey';

  if jobs_enabled and base_url <> '' and auth_token <> '' and api_key <> '' then
    insert into public.system_settings (key, value)
    values ('ll2_incremental_use_edge_burst', 'true'::jsonb)
    on conflict (key) do update
      set value = excluded.value,
          updated_at = now();
  end if;
end $$;

-- Artemis: service-role policies should be scoped to `service_role` and not call auth.role().
do $$
begin
  if to_regclass('public.artemis_source_documents') is not null then
    drop policy if exists "service role manage artemis source documents" on public.artemis_source_documents;
    create policy "service role manage artemis source documents"
      on public.artemis_source_documents
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_entities') is not null then
    drop policy if exists "service role manage artemis entities" on public.artemis_entities;
    create policy "service role manage artemis entities"
      on public.artemis_entities
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_timeline_events') is not null then
    drop policy if exists "service role manage artemis timeline events" on public.artemis_timeline_events;
    create policy "service role manage artemis timeline events"
      on public.artemis_timeline_events
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_budget_lines') is not null then
    drop policy if exists "service role manage artemis budget lines" on public.artemis_budget_lines;
    create policy "service role manage artemis budget lines"
      on public.artemis_budget_lines
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_procurement_awards') is not null then
    drop policy if exists "service role manage artemis procurement awards" on public.artemis_procurement_awards;
    create policy "service role manage artemis procurement awards"
      on public.artemis_procurement_awards
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_mission_snapshots') is not null then
    drop policy if exists "service role manage artemis mission snapshots" on public.artemis_mission_snapshots;
    create policy "service role manage artemis mission snapshots"
      on public.artemis_mission_snapshots
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_ingest_checkpoints') is not null then
    drop policy if exists "service role manage artemis ingest checkpoints" on public.artemis_ingest_checkpoints;
    create policy "service role manage artemis ingest checkpoints"
      on public.artemis_ingest_checkpoints
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- User-owned policies: make auth.uid() initplan-friendly.
do $$
begin
  if to_regclass('public.sms_consent_events') is not null then
    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'sms_consent_events'
        and policyname = 'user owns sms consent events'
    ) then
      alter policy "user owns sms consent events" on public.sms_consent_events
        using ((select auth.uid()) = user_id);
    end if;

    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'sms_consent_events'
        and policyname = 'user inserts sms consent events'
    ) then
      alter policy "user inserts sms consent events" on public.sms_consent_events
        with check ((select auth.uid()) = user_id);
    end if;
  end if;

  if to_regclass('public.rss_feeds') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'rss_feeds'
        and policyname = 'user owns rss feeds'
    )
  then
    alter policy "user owns rss feeds" on public.rss_feeds
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.calendar_feeds') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'calendar_feeds'
        and policyname = 'user owns calendar feeds'
    )
  then
    alter policy "user owns calendar feeds" on public.calendar_feeds
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.launch_filter_presets') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'launch_filter_presets'
        and policyname = 'user owns filter presets'
    )
  then
    alter policy "user owns filter presets" on public.launch_filter_presets
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

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

  if to_regclass('public.embed_widgets') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'embed_widgets'
        and policyname = 'user owns embed widgets'
    )
  then
    alter policy "user owns embed widgets" on public.embed_widgets
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;

  if to_regclass('public.tipjar_customers') is not null
    and exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'tipjar_customers'
        and policyname = 'user reads own tipjar customer'
    )
  then
    alter policy "user reads own tipjar customer" on public.tipjar_customers
      using ((select auth.uid()) = user_id);
  end if;
end $$;
