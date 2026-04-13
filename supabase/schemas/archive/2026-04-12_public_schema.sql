-- WARNING: This schema is for context only and is not meant to be run.
-- It is a checked-in snapshot of the linked Supabase public schema.
-- Pending local migrations are not included until they are applied to the linked database.
-- Refresh with: scripts/export-supabase-public-schema.sh --archive

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.9 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: admin_get_managed_scheduler_stats(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_managed_scheduler_stats(window_hours integer DEFAULT 24) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_window int := greatest(1, least(coalesce(window_hours, 24), 24 * 7));
  result jsonb;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  with
  queue_counts as (
    select
      count(*) filter (where q.status = 'queued')::bigint as queued,
      count(*) filter (where q.status = 'sending')::bigint as sending,
      count(*) filter (where q.status = 'failed')::bigint as failed_total,
      count(*) filter (where q.status = 'sent')::bigint as sent_total
    from public.managed_scheduler_queue q
  ),
  window_counts as (
    select
      count(*) filter (where q.status = 'sent')::bigint as sent_window,
      count(*) filter (where q.status = 'failed')::bigint as failed_window,
      avg(extract(epoch from (coalesce(q.finished_at, q.updated_at, q.created_at) - q.scheduled_for)))
        filter (where q.status = 'sent') as avg_lag_seconds,
      percentile_cont(0.95) within group (order by extract(epoch from (coalesce(q.finished_at, q.updated_at, q.created_at) - q.scheduled_for)))
        filter (where q.status = 'sent') as p95_lag_seconds
    from public.managed_scheduler_queue q
    where q.created_at >= now() - make_interval(hours => v_window)
  ),
  oldest_queued as (
    select q.scheduled_for
    from public.managed_scheduler_queue q
    where q.status = 'queued'
    order by q.scheduled_for asc
    limit 1
  ),
  per_job as (
    select
      j.cron_job_name,
      j.edge_job_slug,
      j.enabled,
      j.next_run_at,
      j.last_enqueued_at,
      j.last_dispatched_at,
      j.last_error,
      coalesce(q.queued, 0)::bigint as queued,
      coalesce(q.sending, 0)::bigint as sending,
      coalesce(q.sent_window, 0)::bigint as sent_window,
      coalesce(q.failed_window, 0)::bigint as failed_window
    from public.managed_scheduler_jobs j
    left join lateral (
      select
        count(*) filter (where mq.status = 'queued') as queued,
        count(*) filter (where mq.status = 'sending') as sending,
        count(*) filter (where mq.status = 'sent' and mq.created_at >= now() - make_interval(hours => v_window)) as sent_window,
        count(*) filter (where mq.status = 'failed' and mq.created_at >= now() - make_interval(hours => v_window)) as failed_window
      from public.managed_scheduler_queue mq
      where mq.cron_job_name = j.cron_job_name
    ) q on true
  )
  select jsonb_build_object(
    'ok', true,
    'windowHours', v_window,
    'summary', jsonb_build_object(
      'jobsTotal', (select count(*)::int from public.managed_scheduler_jobs),
      'jobsEnabled', (select count(*)::int from public.managed_scheduler_jobs where enabled),
      'queued', (select queued from queue_counts),
      'sending', (select sending from queue_counts),
      'sentWindow', (select sent_window from window_counts),
      'failedWindow', (select failed_window from window_counts),
      'sentTotal', (select sent_total from queue_counts),
      'failedTotal', (select failed_total from queue_counts),
      'oldestQueuedAt', (select scheduled_for from oldest_queued),
      'avgLagSeconds', (select round(coalesce(avg_lag_seconds, 0)::numeric, 2) from window_counts),
      'p95LagSeconds', (select round(coalesce(p95_lag_seconds, 0)::numeric, 2) from window_counts)
    ),
    'jobs', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'cronJobName', p.cron_job_name,
            'edgeJobSlug', p.edge_job_slug,
            'enabled', p.enabled,
            'nextRunAt', p.next_run_at,
            'lastEnqueuedAt', p.last_enqueued_at,
            'lastDispatchedAt', p.last_dispatched_at,
            'lastError', p.last_error,
            'queued', p.queued,
            'sending', p.sending,
            'sentWindow', p.sent_window,
            'failedWindow', p.failed_window
          )
          order by p.cron_job_name
        )
        from per_job p
      ),
      '[]'::jsonb
    )
  )
  into result;

  return coalesce(result, jsonb_build_object('ok', true, 'windowHours', v_window, 'summary', '{}'::jsonb, 'jobs', '[]'::jsonb));
end;
$$;


--
-- Name: admin_get_ops_metrics_series(integer, text, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_ops_metrics_series(window_hours integer DEFAULT 24, resolution text DEFAULT '1m'::text, metric_keys text[] DEFAULT NULL::text[]) RETURNS TABLE(sampled_at timestamp with time zone, metric_key text, labels jsonb, value double precision, source text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_window int := greatest(1, least(coalesce(window_hours, 24), 24 * 30));
  v_resolution text := case when lower(coalesce(resolution, '1m')) = '5m' then '5m' else '1m' end;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  if v_resolution = '5m' then
    return query
      select t.sampled_at, t.metric_key, t.labels, t.value, t.source
      from public.ops_metrics_samples_5m t
      where t.sampled_at >= now() - make_interval(hours => v_window)
        and (metric_keys is null or t.metric_key = any(metric_keys))
      order by t.sampled_at asc, t.metric_key asc;
  else
    return query
      select t.sampled_at, t.metric_key, t.labels, t.value, t.source
      from public.ops_metrics_samples_1m t
      where t.sampled_at >= now() - make_interval(hours => v_window)
        and (metric_keys is null or t.metric_key = any(metric_keys))
      order by t.sampled_at asc, t.metric_key asc;
  end if;
end;
$$;


--
-- Name: admin_get_pg_io_outliers(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_pg_io_outliers(limit_n integer DEFAULT 25) RETURNS TABLE(query text, calls bigint, total_exec_time double precision, mean_exec_time double precision, rows bigint, shared_blks_hit bigint, shared_blks_read bigint, shared_blks_dirtied bigint, shared_blks_written bigint, temp_blks_read bigint, temp_blks_written bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_catalog'
    AS $_$
declare
  v_limit int := greatest(1, least(coalesce(limit_n, 25), 200));
  stats_relation text := null;
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  if to_regclass('pg_stat_statements') is not null then
    stats_relation := 'pg_stat_statements';
  elsif to_regclass('extensions.pg_stat_statements') is not null then
    stats_relation := 'extensions.pg_stat_statements';
  else
    return;
  end if;

  return query execute format(
    $sql$
      select
        left(regexp_replace(s.query, '\s+', ' ', 'g'), 500) as query,
        s.calls,
        s.total_exec_time,
        s.mean_exec_time,
        s.rows,
        s.shared_blks_hit,
        s.shared_blks_read,
        s.shared_blks_dirtied,
        s.shared_blks_written,
        s.temp_blks_read,
        s.temp_blks_written
      from %s s
      where s.calls > 0
      order by
        (coalesce(s.temp_blks_written, 0) + coalesce(s.shared_blks_written, 0)) desc,
        s.total_exec_time desc
      limit %s
    $sql$,
    stats_relation,
    v_limit
  );
end;
$_$;


--
-- Name: admin_get_table_write_pressure(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.admin_get_table_write_pressure(limit_n integer DEFAULT 25) RETURNS TABLE(table_name text, total_writes bigint, n_tup_ins bigint, n_tup_upd bigint, n_tup_del bigint, n_tup_hot_upd bigint, n_live_tup bigint, n_dead_tup bigint, dead_ratio double precision, seq_scan bigint, idx_scan bigint, last_autovacuum timestamp with time zone, last_autoanalyze timestamp with time zone)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(1, least(coalesce(limit_n, 25), 200));
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  return query
    select
      st.relname::text as table_name,
      (coalesce(st.n_tup_ins, 0) + coalesce(st.n_tup_upd, 0) + coalesce(st.n_tup_del, 0) + coalesce(st.n_tup_hot_upd, 0))::bigint as total_writes,
      coalesce(st.n_tup_ins, 0)::bigint as n_tup_ins,
      coalesce(st.n_tup_upd, 0)::bigint as n_tup_upd,
      coalesce(st.n_tup_del, 0)::bigint as n_tup_del,
      coalesce(st.n_tup_hot_upd, 0)::bigint as n_tup_hot_upd,
      coalesce(st.n_live_tup, 0)::bigint as n_live_tup,
      coalesce(st.n_dead_tup, 0)::bigint as n_dead_tup,
      case
        when coalesce(st.n_live_tup, 0) + coalesce(st.n_dead_tup, 0) = 0 then 0
        else coalesce(st.n_dead_tup, 0)::double precision / (coalesce(st.n_live_tup, 0) + coalesce(st.n_dead_tup, 0))
      end as dead_ratio,
      coalesce(st.seq_scan, 0)::bigint as seq_scan,
      coalesce(st.idx_scan, 0)::bigint as idx_scan,
      st.last_autovacuum,
      st.last_autoanalyze
    from pg_stat_user_tables st
    order by total_writes desc, coalesce(st.n_dead_tup, 0) desc
    limit v_limit;
end;
$$;


--
-- Name: backfill_rocket_media(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.backfill_rocket_media() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  launches_updated int := 0;
  cache_updated int := 0;
begin
  with rocket_sources as (
    select
      rc.ll2_config_id,
      rc.image_url as config_image_url,
      rc.info_url as config_info_url,
      rc.wiki_url as config_wiki_url,
      rc.variant as config_variant,
      rc.reusable as config_reusable,
      a.logo_url as manufacturer_logo_url,
      a.image_url as manufacturer_image_url
    from public.ll2_rocket_configs rc
    left join public.ll2_agencies a
      on a.ll2_agency_id = rc.manufacturer_id
  )
  update public.launches l
  set
    rocket_image_url = coalesce(l.rocket_image_url, s.config_image_url),
    rocket_info_url = coalesce(l.rocket_info_url, s.config_info_url),
    rocket_wiki_url = coalesce(l.rocket_wiki_url, s.config_wiki_url),
    rocket_variant = coalesce(l.rocket_variant, s.config_variant),
    rocket_reusable = coalesce(l.rocket_reusable, s.config_reusable),
    rocket_manufacturer_logo_url = coalesce(l.rocket_manufacturer_logo_url, s.manufacturer_logo_url),
    rocket_manufacturer_image_url = coalesce(l.rocket_manufacturer_image_url, s.manufacturer_image_url),
    updated_at = now()
  from rocket_sources s
  where l.ll2_rocket_config_id = s.ll2_config_id
    and (
      (l.rocket_image_url is null and s.config_image_url is not null)
      or (l.rocket_info_url is null and s.config_info_url is not null)
      or (l.rocket_wiki_url is null and s.config_wiki_url is not null)
      or (l.rocket_variant is null and s.config_variant is not null)
      or (l.rocket_reusable is null and s.config_reusable is not null)
      or (l.rocket_manufacturer_logo_url is null and s.manufacturer_logo_url is not null)
      or (l.rocket_manufacturer_image_url is null and s.manufacturer_image_url is not null)
    );

  get diagnostics launches_updated = row_count;

  with rocket_sources as (
    select
      rc.ll2_config_id,
      rc.image_url as config_image_url,
      rc.info_url as config_info_url,
      rc.wiki_url as config_wiki_url,
      rc.variant as config_variant,
      rc.reusable as config_reusable,
      a.logo_url as manufacturer_logo_url,
      a.image_url as manufacturer_image_url
    from public.ll2_rocket_configs rc
    left join public.ll2_agencies a
      on a.ll2_agency_id = rc.manufacturer_id
  )
  update public.launches_public_cache c
  set
    rocket_image_url = coalesce(c.rocket_image_url, s.config_image_url),
    rocket_info_url = coalesce(c.rocket_info_url, s.config_info_url),
    rocket_wiki_url = coalesce(c.rocket_wiki_url, s.config_wiki_url),
    rocket_variant = coalesce(c.rocket_variant, s.config_variant),
    rocket_reusable = coalesce(c.rocket_reusable, s.config_reusable),
    rocket_manufacturer_logo_url = coalesce(c.rocket_manufacturer_logo_url, s.manufacturer_logo_url),
    rocket_manufacturer_image_url = coalesce(c.rocket_manufacturer_image_url, s.manufacturer_image_url),
    cache_generated_at = now()
  from rocket_sources s
  where c.ll2_rocket_config_id = s.ll2_config_id
    and (
      (c.rocket_image_url is null and s.config_image_url is not null)
      or (c.rocket_info_url is null and s.config_info_url is not null)
      or (c.rocket_wiki_url is null and s.config_wiki_url is not null)
      or (c.rocket_variant is null and s.config_variant is not null)
      or (c.rocket_reusable is null and s.config_reusable is not null)
      or (c.rocket_manufacturer_logo_url is null and s.manufacturer_logo_url is not null)
      or (c.rocket_manufacturer_image_url is null and s.manufacturer_image_url is not null)
    );

  get diagnostics cache_updated = row_count;

  return jsonb_build_object(
    'launchesUpdated', launches_updated,
    'cacheUpdated', cache_updated
  );
end;
$$;


--
-- Name: block_profile_role_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_profile_role_change() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if new.role is distinct from old.role then
    if current_user not in ('service_role', 'postgres', 'supabase_admin') then
      raise exception 'role_change_not_allowed';
    end if;
  end if;
  return new;
end;
$$;


--
-- Name: broadcast_launch_refresh_state_changes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.broadcast_launch_refresh_state_changes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'realtime'
    AS $$
begin
  perform realtime.broadcast_changes(
    'launch-refresh:' || coalesce(new.cache_key, old.cache_key),
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );

  return null;
end;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: celestrak_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.celestrak_datasets (
    dataset_key text NOT NULL,
    dataset_type text NOT NULL,
    code text NOT NULL,
    label text,
    query jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    min_interval_seconds integer DEFAULT 7200 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_success_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    last_http_status integer,
    last_error text,
    etag text,
    last_modified text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT celestrak_datasets_dataset_type_check CHECK ((dataset_type = ANY (ARRAY['gp'::text, 'satcat'::text, 'supgp'::text])))
);


--
-- Name: claim_celestrak_datasets(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_celestrak_datasets(dataset_type_filter text, batch_size integer) RETURNS SETOF public.celestrak_datasets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select dataset_key
    from public.celestrak_datasets
    where enabled = true
      and dataset_type = dataset_type_filter
      and (
        last_attempt_at is null
        or last_attempt_at <= now() - (min_interval_seconds * interval '1 second')
      )
    order by coalesce(last_attempt_at, '1970-01-01'::timestamptz) asc, dataset_key asc
    for update skip locked
    limit batch_size
  )
  update public.celestrak_datasets d
  set last_attempt_at = now(),
      updated_at = now()
  where d.dataset_key in (select dataset_key from candidates)
  returning d.*;
end;
$$;


--
-- Name: celestrak_intdes_datasets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.celestrak_intdes_datasets (
    launch_designator text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    min_interval_seconds integer DEFAULT 2592000 NOT NULL,
    last_attempt_at timestamp with time zone,
    last_success_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    last_http_status integer,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    latest_snapshot_id bigint,
    latest_snapshot_hash text,
    catalog_state text DEFAULT 'pending'::text NOT NULL,
    last_checked_at timestamp with time zone,
    last_non_empty_at timestamp with time zone,
    CONSTRAINT celestrak_intdes_datasets_catalog_state_check CHECK ((catalog_state = ANY (ARRAY['pending'::text, 'catalog_available'::text, 'catalog_empty'::text, 'error'::text])))
);


--
-- Name: claim_celestrak_intdes_datasets(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_celestrak_intdes_datasets(batch_size integer) RETURNS SETOF public.celestrak_intdes_datasets
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  effective_batch_size int := greatest(1, least(coalesce(batch_size, 25), 200));
begin
  return query
  with settings as (
    select
      coalesce(
        (
          select case
            when jsonb_typeof(s.value) = 'number' then greatest(1, least((s.value::text)::int, 3650))
            when jsonb_typeof(s.value) = 'string'
              and trim(both '"' from s.value::text) ~ '^[0-9]+$'
              then greatest(1, least((trim(both '"' from s.value::text))::int, 3650))
            else null
          end
          from public.system_settings s
          where s.key = 'celestrak_intdes_recent_window_days'
        ),
        180
      ) as recent_window_days,
      coalesce(
        (
          select case
            when jsonb_typeof(s.value) = 'number' then greatest(300, least((s.value::text)::int, 31536000))
            when jsonb_typeof(s.value) = 'string'
              and trim(both '"' from s.value::text) ~ '^[0-9]+$'
              then greatest(300, least((trim(both '"' from s.value::text))::int, 31536000))
            else null
          end
          from public.system_settings s
          where s.key = 'celestrak_intdes_recent_min_interval_seconds'
        ),
        21600
      ) as recent_min_interval_seconds,
      coalesce(
        (
          select case
            when jsonb_typeof(s.value) = 'number' then greatest(300, least((s.value::text)::int, 31536000))
            when jsonb_typeof(s.value) = 'string'
              and trim(both '"' from s.value::text) ~ '^[0-9]+$'
              then greatest(300, least((trim(both '"' from s.value::text))::int, 31536000))
            else null
          end
          from public.system_settings s
          where s.key = 'celestrak_intdes_legacy_min_interval_seconds'
        ),
        2592000
      ) as legacy_min_interval_seconds
  ),
  candidates as (
    select d.launch_designator
    from public.celestrak_intdes_datasets d
    cross join settings st
    left join lateral (
      select l.net
      from public.launches l
      where l.launch_designator = d.launch_designator
      order by l.net desc nulls last
      limit 1
    ) ln on true
    where d.enabled = true
      and (
        d.last_attempt_at is null
        or d.last_attempt_at <= now() - (
          case
            when ln.net is not null
             and ln.net >= now() - (st.recent_window_days * interval '1 day')
              then st.recent_min_interval_seconds
            else st.legacy_min_interval_seconds
          end * interval '1 second'
        )
      )
    order by
      case
        when ln.net is not null
         and ln.net >= now() - (st.recent_window_days * interval '1 day')
         and coalesce(d.catalog_state, 'pending') in ('pending', 'error') then 0
        when ln.net is not null
         and ln.net >= now() - (st.recent_window_days * interval '1 day')
         and coalesce(d.catalog_state, 'pending') = 'catalog_empty' then 1
        when coalesce(d.catalog_state, 'pending') in ('pending', 'error') then 2
        when coalesce(d.catalog_state, 'pending') = 'catalog_empty' then 3
        when ln.net is not null
         and ln.net >= now() - (st.recent_window_days * interval '1 day')
         and coalesce(d.catalog_state, 'pending') = 'catalog_available' then 4
        else 5
      end asc,
      ln.net desc nulls last,
      coalesce(d.last_attempt_at, '1970-01-01'::timestamptz) asc,
      d.launch_designator asc
    for update of d skip locked
    limit effective_batch_size
  )
  update public.celestrak_intdes_datasets d
  set last_attempt_at = now(),
      updated_at = now()
  where d.launch_designator in (select launch_designator from candidates)
  returning d.*;
end;
$_$;


--
-- Name: mobile_push_outbox_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_push_outbox_v2 (
    id bigint NOT NULL,
    owner_kind text NOT NULL,
    user_id uuid,
    installation_id text,
    launch_id uuid,
    channel text DEFAULT 'push'::text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_message_id text,
    error text,
    attempts integer DEFAULT 0 NOT NULL,
    locked_at timestamp with time zone,
    scheduled_for timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mobile_push_outbox_v2_channel_check CHECK ((channel = 'push'::text)),
    CONSTRAINT mobile_push_outbox_v2_owner_check CHECK ((((owner_kind = 'guest'::text) AND (user_id IS NULL) AND (installation_id IS NOT NULL)) OR ((owner_kind = 'user'::text) AND (user_id IS NOT NULL) AND (installation_id IS NULL)))),
    CONSTRAINT mobile_push_outbox_v2_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['guest'::text, 'user'::text]))),
    CONSTRAINT mobile_push_outbox_v2_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: claim_mobile_push_outbox_v2(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_mobile_push_outbox_v2(batch_size integer, max_attempts integer DEFAULT 5) RETURNS SETOF public.mobile_push_outbox_v2
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select id
    from public.mobile_push_outbox_v2
    where status = 'queued'
      and scheduled_for <= now()
      and attempts < max_attempts
    order by scheduled_for asc
    for update skip locked
    limit batch_size
  )
  update public.mobile_push_outbox_v2
  set status = 'sending',
      locked_at = now(),
      attempts = attempts + 1,
      error = null
  where id in (select id from candidates)
  returning *;
end;
$$;


--
-- Name: notifications_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications_outbox (
    id bigint NOT NULL,
    user_id uuid,
    launch_id uuid,
    channel text NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    provider_message_id text,
    error text,
    scheduled_for timestamp with time zone NOT NULL,
    processed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    locked_at timestamp with time zone,
    owner_kind text DEFAULT 'user'::text NOT NULL,
    owner_key text NOT NULL,
    installation_id text,
    push_destination_id uuid,
    CONSTRAINT notifications_outbox_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'push'::text]))),
    CONSTRAINT notifications_outbox_owner_check CHECK ((((owner_kind = 'guest'::text) AND (user_id IS NULL) AND (installation_id IS NOT NULL) AND (owner_key ~~ 'guest:%'::text)) OR ((owner_kind = 'user'::text) AND (user_id IS NOT NULL) AND (owner_key ~~ 'user:%'::text)))),
    CONSTRAINT notifications_outbox_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: claim_notifications_outbox(integer, text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_notifications_outbox(batch_size integer, channel_filter text DEFAULT 'push'::text, max_attempts integer DEFAULT 5) RETURNS SETOF public.notifications_outbox
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  return query
  with candidates as (
    select id
    from public.notifications_outbox
    where status = 'queued'
      and channel = channel_filter
      and scheduled_for <= now()
      and attempts < max_attempts
    order by scheduled_for asc
    for update skip locked
    limit batch_size
  )
  update public.notifications_outbox
  set status = 'sending',
      locked_at = now(),
      attempts = attempts + 1,
      error = null
  where id in (select id from candidates)
  returning *;
end;
$$;


--
-- Name: social_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    launch_id uuid NOT NULL,
    platform text NOT NULL,
    post_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    template_id text,
    reply_template_id text,
    post_text text,
    reply_text text,
    request_id text,
    external_id text,
    platform_results jsonb,
    scheduled_for timestamp with time zone,
    posted_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    launch_update_id bigint,
    question_id text,
    base_day date,
    thread_segment_index integer DEFAULT 1 NOT NULL,
    reply_to_social_post_id uuid,
    send_lock_id text,
    send_locked_at timestamp with time zone,
    CONSTRAINT social_posts_base_day_chk CHECK (((post_type <> ALL (ARRAY['launch_day'::text, 'mission_drop'::text, 'mission_brief'::text, 'no_launch_day'::text])) OR (base_day IS NOT NULL))),
    CONSTRAINT social_posts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text, 'async'::text])))
);


--
-- Name: claim_social_posts_for_send(text, text[], text[], text[], timestamp with time zone, timestamp with time zone, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_social_posts_for_send(p_lock_id text, p_platforms text[], p_post_types text[], p_statuses text[] DEFAULT ARRAY['pending'::text, 'failed'::text], p_scheduled_before timestamp with time zone DEFAULT now(), p_scheduled_after timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_max_attempts integer DEFAULT NULL::integer, p_send_lock_stale_minutes integer DEFAULT 15) RETURNS SETOF public.social_posts
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 500));
  v_stale_minutes int := greatest(1, least(coalesce(p_send_lock_stale_minutes, 15), 240));
  v_stale_cutoff timestamptz := now() - make_interval(mins => v_stale_minutes);
begin
  if p_lock_id is null or length(trim(p_lock_id)) = 0 then
    raise exception 'lock_id_required';
  end if;

  if coalesce(array_length(p_platforms, 1), 0) = 0 then
    return;
  end if;

  if coalesce(array_length(p_post_types, 1), 0) = 0 then
    return;
  end if;

  update public.social_posts
  set status = 'pending',
      send_lock_id = null,
      send_locked_at = null,
      updated_at = now()
  where status = 'sending'
    and send_locked_at is not null
    and send_locked_at <= v_stale_cutoff;

  return query
  with candidates as (
    select sp.id
    from public.social_posts sp
    where sp.platform = any(p_platforms)
      and sp.post_type = any(p_post_types)
      and sp.status = any(coalesce(p_statuses, array['pending','failed']::text[]))
      and (p_scheduled_before is null or sp.scheduled_for <= p_scheduled_before)
      and (p_scheduled_after is null or sp.scheduled_for >= p_scheduled_after)
      and (p_max_attempts is null or sp.attempts < p_max_attempts)
    order by sp.scheduled_for asc nulls first, sp.thread_segment_index asc nulls first, sp.created_at asc
    for update skip locked
    limit v_limit
  ), claimed as (
    update public.social_posts sp
    set status = 'sending',
        send_lock_id = p_lock_id,
        send_locked_at = now(),
        updated_at = now(),
        last_error = null
    from candidates c
    where sp.id = c.id
    returning sp.*
  )
  select * from claimed;
end;
$$;


--
-- Name: claim_system_setting_quota(text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_system_setting_quota(p_state_key text, p_requested integer, p_limit integer, p_reserve integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  v_today text := to_char(current_date, 'YYYY-MM-DD');
  v_requested int := greatest(0, coalesce(p_requested, 0));
  v_limit int := greatest(0, coalesce(p_limit, 0));
  v_reserve int := greatest(0, coalesce(p_reserve, 0));
  v_state_date text := null;
  v_state_used text;
  v_state_limit text;
  v_state_reserve text;
  v_used int := 0;
  v_used_after int := 0;
  v_max_usable int;
  v_available int;
  v_granted int;
  v_remaining int;
  v_effective_limit int;
  v_effective_reserve int;
begin
  insert into public.system_settings (key, value, updated_at)
  values (p_state_key, jsonb_build_object('date', v_today, 'used', 0, 'limit', v_limit, 'reserve', v_reserve), now())
  on conflict (key) do nothing;

  select
    nullif(s.value->>'date', ''),
    s.value->>'used',
    s.value->>'limit',
    s.value->>'reserve'
  into
    v_state_date,
    v_state_used,
    v_state_limit,
    v_state_reserve
  from public.system_settings s
  where s.key = p_state_key
  for update;

  v_effective_limit := case
    when v_state_limit ~ '^-?\\d+(\\.\\d+)?$' then floor(v_state_limit::numeric)::int
    else v_limit
  end;
  v_effective_reserve := case
    when v_state_reserve ~ '^-?\\d+(\\.\\d+)?$' then floor(v_state_reserve::numeric)::int
    else v_reserve
  end;
  v_used := case
    when v_state_used ~ '^-?\\d+(\\.\\d+)?$' then floor(v_state_used::numeric)::int
    else 0
  end;
  if v_state_date is null or v_state_date <> v_today then
    v_used := 0;
  end if;

  v_limit := greatest(0, v_effective_limit);
  v_reserve := greatest(0, v_effective_reserve);
  v_max_usable := greatest(0, v_limit - v_reserve);
  v_available := greatest(0, v_max_usable - v_used);
  v_granted := least(v_requested, v_available);
  v_used_after := v_used + v_granted;
  v_remaining := greatest(0, v_max_usable - v_used_after);

  update public.system_settings
  set
    value = jsonb_build_object(
      'date', v_today,
      'used', v_used_after,
      'limit', v_limit,
      'reserve', v_reserve,
      'updatedAt', now()
    ),
    updated_at = now()
  where key = p_state_key;

  return jsonb_build_object(
    'date', v_today,
    'requested', v_requested,
    'granted', v_granted,
    'used', v_used_after,
    'limit', v_limit,
    'reserve', v_reserve,
    'available', v_available,
    'remaining', v_remaining
  );
end;
$_$;


--
-- Name: cleanup_ar_camera_guide_sessions(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_ar_camera_guide_sessions(retention_days integer DEFAULT 90) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  delete from public.ar_camera_guide_sessions
  where created_at < now() - make_interval(days => retention_days);
$$;


--
-- Name: enqueue_faa_launch_match_dirty_launch(uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_faa_launch_match_dirty_launch(launch_id_in uuid, reasons_in text[] DEFAULT '{}'::text[]) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_now timestamptz := now();
  v_scheduled_for timestamptz := date_trunc('minute', v_now);
begin
  if launch_id_in is null then
    return false;
  end if;

  insert into public.faa_launch_match_dirty_launches (
    launch_id,
    reasons,
    first_queued_at,
    last_queued_at,
    updated_at
  )
  values (
    launch_id_in,
    coalesce(reasons_in, '{}'::text[]),
    v_now,
    v_now,
    v_now
  )
  on conflict (launch_id) do update
    set reasons = (
          select coalesce(array_agg(distinct reason order by reason), '{}'::text[])
          from unnest(
            coalesce(public.faa_launch_match_dirty_launches.reasons, '{}'::text[])
            || coalesce(excluded.reasons, '{}'::text[])
          ) as reason
        ),
        last_queued_at = v_now,
        updated_at = v_now;

  insert into public.managed_scheduler_queue (
    cron_job_name,
    edge_job_slug,
    scheduled_for,
    status,
    attempts,
    max_attempts
  )
  values (
    'faa_launch_match',
    'faa-launch-match',
    v_scheduled_for,
    'queued',
    0,
    3
  )
  on conflict (cron_job_name, scheduled_for) do nothing;

  return true;
end;
$$;


--
-- Name: get_all_cron_jobs(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_all_cron_jobs() RETURNS TABLE(jobname text, schedule text, active boolean, command text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'cron', 'pg_catalog'
    AS $$
begin
  if not (public.is_admin() or auth.role() = 'service_role') then
    return;
  end if;

  return query
  with cron_jobs as (
    select
      j.jobname::text as jobname,
      j.schedule::text as schedule,
      j.active::boolean as active,
      j.command::text as command
    from cron.job j
  ), managed_jobs as (
    select
      m.cron_job_name::text as jobname,
      format('managed/%ss offset %ss', m.interval_seconds, m.offset_seconds)::text as schedule,
      m.enabled::boolean as active,
      format('select public.invoke_edge_job(%L); -- managed_scheduler_tick', m.edge_job_slug)::text as command
    from public.managed_scheduler_jobs m
    where not exists (
      select 1
      from cron_jobs c
      where c.jobname = m.cron_job_name
    )
  )
  select c.jobname, c.schedule, c.active, c.command from cron_jobs c
  union all
  select m.jobname, m.schedule, m.active, m.command from managed_jobs m
  order by jobname;
end;
$$;


--
-- Name: get_canonical_contract_totals_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_canonical_contract_totals_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select jsonb_build_object(
    'all', count(*)::bigint,
    'exact', count(*) filter (where story_status = 'exact'),
    'pending', count(*) filter (where story_status = 'pending'),
    'spacex', count(*) filter (where scope = 'spacex'),
    'blueOrigin', count(*) filter (where scope = 'blue-origin'),
    'artemis', count(*) filter (where scope = 'artemis')
  )
  from public.canonical_contracts_cache;
$$;


--
-- Name: get_cron_jobs(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_cron_jobs(job_names text[]) RETURNS TABLE(jobname text, schedule text, active boolean)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'cron'
    AS $$
  select jobname, schedule, active
  from cron.job
  where jobname = any(job_names)
    and public.is_admin()
  order by jobname;
$$;


--
-- Name: get_ingestion_runs_recent(text[], integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ingestion_runs_recent(job_names text[], per_job integer DEFAULT 20) RETURNS TABLE(job_name text, started_at timestamp with time zone, ended_at timestamp with time zone, success boolean, error text, stats jsonb)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select job_name, started_at, ended_at, success, error, stats
  from (
    select
      ir.job_name,
      ir.started_at,
      ir.ended_at,
      ir.success,
      ir.error,
      ir.stats,
      row_number() over (partition by ir.job_name order by ir.started_at desc) as rn
    from public.ingestion_runs ir
    where ir.job_name = any(job_names)
      and public.is_admin()
  ) ranked
  where rn <= greatest(1, least(per_job, 200))
  order by job_name, started_at desc;
$$;


--
-- Name: get_latest_successful_ingestion_runs_v1(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_latest_successful_ingestion_runs_v1(job_names_in text[]) RETURNS TABLE(job_name text, started_at timestamp with time zone, ended_at timestamp with time zone, success boolean)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select distinct on (ir.job_name)
    ir.job_name,
    ir.started_at,
    ir.ended_at,
    ir.success
  from public.ingestion_runs ir
  where ir.success = true
    and ir.job_name = any(coalesce(job_names_in, array[]::text[]))
  order by ir.job_name, ir.ended_at desc nulls last, ir.started_at desc nulls last;
$$;


--
-- Name: get_launch_expected_satellite_payload(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_expected_satellite_payload(ll2_launch_uuid_in uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select coalesce(
    (
      select jsonb_build_object(
        'll2_launch_uuid', e.ll2_launch_uuid,
        'expected_count', e.expected_count,
        'source_label', e.source_label,
        'source_url', e.source_url,
        'notes', e.notes,
        'updated_at', e.updated_at
      )
      from public.launch_expected_satellite_payloads e
      join public.launches_public_cache c
        on c.ll2_launch_uuid = e.ll2_launch_uuid
      where e.ll2_launch_uuid = ll2_launch_uuid_in
      limit 1
    ),
    '{}'::jsonb
  );
$$;


--
-- Name: get_launch_filter_options(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_filter_options() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider) from (
         select distinct provider
         from public.launches_public_cache
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and provider is not null
           and provider <> ''
      ) s),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state) from (
         select distinct pad_state
         from public.launches_public_cache
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and pad_state is not null
           and pad_state <> ''
      ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name) from (
         select distinct status_name
         from public.launches_public_cache
         where hidden is false
           and pad_country_code in ('USA', 'US')
           and status_name is not null
           and status_name <> ''
      ) s),
      '[]'::jsonb
    )
  );
$$;


--
-- Name: get_launch_filter_options_all(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_filter_options_all() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider) from (
         select distinct provider
         from public.launches_public_cache
         where hidden is false
           and provider is not null
           and provider <> ''
      ) s),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state) from (
         select distinct pad_state
         from public.launches_public_cache
         where hidden is false
           and pad_state is not null
           and pad_state <> ''
      ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name) from (
         select distinct status_name
         from public.launches_public_cache
         where hidden is false
           and status_name is not null
           and status_name <> ''
      ) s),
      '[]'::jsonb
    )
  );
$$;


--
-- Name: get_launch_filter_options_non_us(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_filter_options_non_us() RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select jsonb_build_object(
    'providers', coalesce(
      (select jsonb_agg(provider order by provider) from (
         select distinct provider
         from public.launches_public_cache
         where hidden is false
           and pad_country_code not in ('USA', 'US')
           and provider is not null
           and provider <> ''
      ) s),
      '[]'::jsonb
    ),
    'states', coalesce(
      (select jsonb_agg(pad_state order by pad_state) from (
         select distinct pad_state
         from public.launches_public_cache
         where hidden is false
           and pad_country_code not in ('USA', 'US')
           and pad_state is not null
           and pad_state <> ''
      ) s),
      '[]'::jsonb
    ),
    'statuses', coalesce(
      (select jsonb_agg(status_name order by status_name) from (
         select distinct status_name
         from public.launches_public_cache
         where hidden is false
           and pad_country_code not in ('USA', 'US')
           and status_name is not null
           and status_name <> ''
      ) s),
      '[]'::jsonb
    )
  );
$$;


--
-- Name: get_launch_object_inventory_v1(uuid, boolean, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_object_inventory_v1(ll2_launch_uuid_in uuid, include_orbit boolean DEFAULT true, history_limit integer DEFAULT 5) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with launch_meta as (
    select
      l.ll2_launch_uuid,
      l.launch_designator
    from public.launches l
    where l.ll2_launch_uuid = ll2_launch_uuid_in
    limit 1
  ),
  manifest_counts as (
    select
      count(*)::int as ll2_payload_count
    from public.ll2_payload_flights pf
    where pf.ll2_launch_uuid = ll2_launch_uuid_in
      and pf.active = true
  ),
  dataset as (
    select d.*
    from public.celestrak_intdes_datasets d
    join launch_meta lm on lm.launch_designator = d.launch_designator
    limit 1
  ),
  latest_snapshot as (
    select s.*
    from public.launch_object_inventory_snapshots s
    join launch_meta lm on lm.launch_designator = s.launch_designator
    order by s.captured_at desc
    limit 1
  ),
  snapshot_choice as (
    select
      coalesce(d.latest_snapshot_id, ls.id) as snapshot_id,
      coalesce(d.latest_snapshot_hash, ls.snapshot_hash) as snapshot_hash,
      coalesce(d.catalog_state, case when ls.id is null then 'pending' else 'catalog_available' end) as catalog_state,
      d.last_checked_at,
      d.last_success_at,
      d.last_error,
      d.last_non_empty_at
    from dataset d
    full join latest_snapshot ls on true
    limit 1
  ),
  snapshot_meta as (
    select s.*
    from snapshot_choice sc
    join public.launch_object_inventory_snapshots s
      on s.id = sc.snapshot_id
  ),
  current_items as (
    select i.*
    from snapshot_choice sc
    join public.launch_object_inventory_snapshot_items i
      on i.snapshot_id = sc.snapshot_id
  ),
  orbit_latest as (
    select distinct on (oe.norad_cat_id)
      oe.norad_cat_id,
      oe.source,
      oe.epoch,
      oe.inclination_deg,
      oe.raan_deg,
      oe.eccentricity,
      oe.arg_perigee_deg,
      oe.mean_anomaly_deg,
      oe.mean_motion_rev_per_day,
      oe.bstar,
      oe.fetched_at
    from public.orbit_elements oe
    join current_items ci
      on ci.norad_cat_id is not null
     and ci.norad_cat_id = oe.norad_cat_id
    order by oe.norad_cat_id, oe.epoch desc
  ),
  counts as (
    select
      count(*)::int as satcat_total_count,
      count(*) filter (where object_type = 'PAY')::int as satcat_payload_count,
      count(*) filter (where object_type = 'RB')::int as satcat_rb_count,
      count(*) filter (where object_type = 'DEB')::int as satcat_deb_count,
      count(*) filter (where object_type = 'UNK')::int as satcat_unk_count
    from current_items
  ),
  payload_objects as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'object_id', ci.object_id,
            'norad_cat_id', ci.norad_cat_id,
            'name', ci.object_name,
            'object_type', ci.object_type,
            'ops_status_code', ci.ops_status_code,
            'owner', ci.owner,
            'launch_date', ci.launch_date,
            'launch_site', ci.launch_site,
            'decay_date', ci.decay_date,
            'period_min', ci.period_min,
            'inclination_deg', ci.inclination_deg,
            'apogee_km', ci.apogee_km,
            'perigee_km', ci.perigee_km,
            'rcs_m2', ci.rcs_m2,
            'data_status_code', ci.data_status_code,
            'orbit_center', ci.orbit_center,
            'orbit_type', ci.orbit_type,
            'orbit',
              case
                when include_orbit then (
                  select jsonb_strip_nulls(
                    jsonb_build_object(
                      'source', o.source,
                      'epoch', o.epoch,
                      'inclination_deg', o.inclination_deg,
                      'raan_deg', o.raan_deg,
                      'eccentricity', o.eccentricity,
                      'arg_perigee_deg', o.arg_perigee_deg,
                      'mean_anomaly_deg', o.mean_anomaly_deg,
                      'mean_motion_rev_per_day', o.mean_motion_rev_per_day,
                      'bstar', o.bstar,
                      'fetched_at', o.fetched_at
                    )
                  )
                  from orbit_latest o
                  where o.norad_cat_id = ci.norad_cat_id
                )
                else null
              end
          )
        )
        order by ci.object_id
      ),
      '[]'::jsonb
    ) as payloads_json
    from current_items ci
    where ci.object_type = 'PAY'
  ),
  non_payload_objects as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'object_id', ci.object_id,
            'norad_cat_id', ci.norad_cat_id,
            'name', ci.object_name,
            'object_type', ci.object_type,
            'ops_status_code', ci.ops_status_code,
            'owner', ci.owner,
            'launch_date', ci.launch_date,
            'launch_site', ci.launch_site,
            'decay_date', ci.decay_date,
            'period_min', ci.period_min,
            'inclination_deg', ci.inclination_deg,
            'apogee_km', ci.apogee_km,
            'perigee_km', ci.perigee_km,
            'rcs_m2', ci.rcs_m2,
            'data_status_code', ci.data_status_code,
            'orbit_center', ci.orbit_center,
            'orbit_type', ci.orbit_type,
            'orbit',
              case
                when include_orbit then (
                  select jsonb_strip_nulls(
                    jsonb_build_object(
                      'source', o.source,
                      'epoch', o.epoch,
                      'inclination_deg', o.inclination_deg,
                      'raan_deg', o.raan_deg,
                      'eccentricity', o.eccentricity,
                      'arg_perigee_deg', o.arg_perigee_deg,
                      'mean_anomaly_deg', o.mean_anomaly_deg,
                      'mean_motion_rev_per_day', o.mean_motion_rev_per_day,
                      'bstar', o.bstar,
                      'fetched_at', o.fetched_at
                    )
                  )
                  from orbit_latest o
                  where o.norad_cat_id = ci.norad_cat_id
                )
                else null
              end
          )
        )
        order by ci.object_type, ci.object_id
      ),
      '[]'::jsonb
    ) as non_payloads_json
    from current_items ci
    where ci.object_type <> 'PAY'
  ),
  history as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'launch_designator', s.launch_designator,
          'snapshot_hash', s.snapshot_hash,
          'object_count', s.object_count,
          'payload_count', s.payload_count,
          'rb_count', s.rb_count,
          'deb_count', s.deb_count,
          'unk_count', s.unk_count,
          'payloads_filter_count', s.payloads_filter_count,
          'captured_at', s.captured_at
        )
        order by s.captured_at desc
      ),
      '[]'::jsonb
    ) as history_json
    from (
      select s.*
      from public.launch_object_inventory_snapshots s
      join launch_meta lm on lm.launch_designator = s.launch_designator
      order by s.captured_at desc
      limit greatest(1, least(coalesce(history_limit, 5), 20))
    ) s
  )
  select jsonb_build_object(
    'launch_designator', (select lm.launch_designator from launch_meta lm),
    'inventory_status', jsonb_strip_nulls(
      jsonb_build_object(
        'catalog_state', coalesce((select sc.catalog_state from snapshot_choice sc), 'pending'),
        'last_checked_at', (select sc.last_checked_at from snapshot_choice sc),
        'last_success_at', (select sc.last_success_at from snapshot_choice sc),
        'last_error', (select sc.last_error from snapshot_choice sc),
        'last_non_empty_at', (select sc.last_non_empty_at from snapshot_choice sc),
        'latest_snapshot_hash', (select sc.snapshot_hash from snapshot_choice sc)
      )
    ),
    'reconciliation', jsonb_build_object(
      'll2_manifest_payload_count', coalesce((select mc.ll2_payload_count from manifest_counts mc), 0),
      'satcat_payload_count', coalesce((select c.satcat_payload_count from counts c), 0),
      'satcat_payloads_filter_count', coalesce((select sm.payloads_filter_count from snapshot_meta sm), 0),
      'satcat_total_count', coalesce((select c.satcat_total_count from counts c), 0),
      'satcat_type_counts', jsonb_build_object(
        'PAY', coalesce((select c.satcat_payload_count from counts c), 0),
        'RB', coalesce((select c.satcat_rb_count from counts c), 0),
        'DEB', coalesce((select c.satcat_deb_count from counts c), 0),
        'UNK', coalesce((select c.satcat_unk_count from counts c), 0)
      ),
      'delta_manifest_vs_satcat_payload',
        coalesce((select c.satcat_payload_count from counts c), 0)
        - coalesce((select mc.ll2_payload_count from manifest_counts mc), 0)
    ),
    'satcat_payload_objects', coalesce((select p.payloads_json from payload_objects p), '[]'::jsonb),
    'satcat_non_payload_objects', coalesce((select n.non_payloads_json from non_payload_objects n), '[]'::jsonb),
    'history', coalesce((select h.history_json from history h), '[]'::jsonb)
  );
$$;


--
-- Name: get_launch_payload_manifest(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_payload_manifest(ll2_launch_uuid_in uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with payload_entries as (
    select
      0 as kind_order,
      pf.ll2_payload_flight_id as sort_id,
      jsonb_build_object(
        'kind', 'payload_flight',
        'id', pf.ll2_payload_flight_id,
        'url', pf.url,
        'destination', pf.destination,
        'amount', pf.amount,
        'payload', jsonb_build_object(
          'id', p.ll2_payload_id,
          'name', p.name,
          'description', p.description,
          'mass_kg', p.mass_kg,
          'cost_usd', p.cost_usd,
          'wiki_link', p.wiki_link,
          'info_link', p.info_link,
          'program', p.program,
          'type', case
            when pt.ll2_payload_type_id is null then null
            else jsonb_build_object('id', pt.ll2_payload_type_id, 'name', pt.name)
          end,
          'manufacturer', case
            when m.ll2_agency_id is null then null
            else jsonb_build_object('id', m.ll2_agency_id, 'name', m.name, 'abbrev', m.abbrev)
          end,
          'operator', case
            when o.ll2_agency_id is null then null
            else jsonb_build_object('id', o.ll2_agency_id, 'name', o.name, 'abbrev', o.abbrev)
          end,
          'image', jsonb_build_object(
            'image_url', p.image_url,
            'thumbnail_url', p.thumbnail_url,
            'credit', p.image_credit,
            'license_name', p.image_license_name,
            'license_url', p.image_license_url,
            'single_use', p.image_single_use
          ),
          'raw', p.raw
        ),
        'landing', case
          when l.ll2_landing_id is null then null
          else jsonb_build_object(
            'id', l.ll2_landing_id,
            'attempt', l.attempt,
            'success', l.success,
            'description', l.description,
            'downrange_distance_km', l.downrange_distance_km,
            'landing_location', l.landing_location,
            'landing_type', l.landing_type,
            'raw', l.raw
          )
        end,
        'docking_events', (
          select coalesce(jsonb_agg(de.raw order by de.docking), '[]'::jsonb)
          from public.ll2_payload_flight_docking_events de
          where de.ll2_payload_flight_id = pf.ll2_payload_flight_id
        ),
        'raw', pf.raw
      ) as entry
    from public.ll2_payload_flights pf
    left join public.ll2_payloads p on p.ll2_payload_id = pf.ll2_payload_id
    left join public.ll2_payload_types pt on pt.ll2_payload_type_id = p.payload_type_id
    left join public.ll2_agencies m on m.ll2_agency_id = p.manufacturer_id
    left join public.ll2_agencies o on o.ll2_agency_id = p.operator_id
    left join public.ll2_landings l on l.ll2_landing_id = pf.ll2_landing_id
    where pf.ll2_launch_uuid = ll2_launch_uuid_in
      and pf.active = true
  ),
  spacecraft_entries as (
    select
      1 as kind_order,
      sf.ll2_spacecraft_flight_id as sort_id,
      jsonb_build_object(
        'kind', 'spacecraft_flight',
        'id', -sf.ll2_spacecraft_flight_id,
        'url', sf.url,
        'destination', sf.destination,
        'amount', null,
        'payload', jsonb_build_object(
          'id', sc.ll2_spacecraft_id,
          'name', sc.name,
          'description', sc.description,
          'mass_kg', null,
          'cost_usd', null,
          'wiki_link', null,
          'info_link', null,
          'program', null,
          'type', case
            when sct.ll2_spacecraft_type_id is null then null
            else jsonb_build_object('id', sct.ll2_spacecraft_type_id, 'name', sct.name)
          end,
          'manufacturer', case
            when a.ll2_agency_id is null then null
            else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
          end,
          'operator', case
            when a.ll2_agency_id is null then null
            else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
          end,
          'image', jsonb_build_object(
            'image_url', coalesce(sc.image_url, cfg.image_url),
            'thumbnail_url', coalesce(sc.thumbnail_url, cfg.thumbnail_url),
            'credit', coalesce(sc.image_credit, cfg.image_credit),
            'license_name', coalesce(sc.image_license_name, cfg.image_license_name),
            'license_url', coalesce(sc.image_license_url, cfg.image_license_url),
            'single_use', coalesce(sc.image_single_use, cfg.image_single_use)
          ),
          'raw', sc.raw
        ),
        'landing', case
          when l.ll2_landing_id is null then null
          else jsonb_build_object(
            'id', l.ll2_landing_id,
            'attempt', l.attempt,
            'success', l.success,
            'description', l.description,
            'downrange_distance_km', l.downrange_distance_km,
            'landing_location', l.landing_location,
            'landing_type', l.landing_type,
            'raw', l.raw
          )
        end,
        'docking_events', (
          select coalesce(jsonb_agg(de.raw order by de.docking), '[]'::jsonb)
          from public.ll2_spacecraft_flight_docking_events de
          where de.ll2_spacecraft_flight_id = sf.ll2_spacecraft_flight_id
        ),
        'raw', sf.raw
      ) as entry
    from public.ll2_spacecraft_flights sf
    left join public.ll2_spacecrafts sc on sc.ll2_spacecraft_id = sf.ll2_spacecraft_id
    left join public.ll2_spacecraft_configs cfg on cfg.ll2_spacecraft_config_id = sc.spacecraft_config_id
    left join public.ll2_spacecraft_types sct on sct.ll2_spacecraft_type_id = cfg.spacecraft_type_id
    left join public.ll2_agencies a on a.ll2_agency_id = cfg.agency_id
    left join public.ll2_landings l on l.ll2_landing_id = sf.ll2_landing_id
    where sf.ll2_launch_uuid = ll2_launch_uuid_in
      and sf.active = true
  ),
  combined as (
    select * from payload_entries
    union all
    select * from spacecraft_entries
  )
  select coalesce(
    jsonb_agg(combined.entry order by combined.kind_order, combined.sort_id),
    '[]'::jsonb
  )
  from combined;
$$;


--
-- Name: get_launch_payload_manifest_v2(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_payload_manifest_v2(ll2_launch_uuid_in uuid, include_raw boolean DEFAULT false) RETURNS jsonb
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with meta as (
    select
      max(l.launch_designator) as launch_designator,
      max(l.net) as net,
      lower(coalesce(max(l.status_name), '') || ' ' || coalesce(max(l.status_abbrev), '')) as status_text
    from public.launches l
    where l.ll2_launch_uuid = ll2_launch_uuid_in
  ),
  satcat as (
    select count(*)::int as payload_count
    from meta m
    join public.satellites s
      on m.launch_designator is not null
     and s.intl_des is not null
     and s.object_type = 'PAY'
     and s.intl_des like m.launch_designator || '%'
  ),
  deployment as (
    select
      case
        when m.net is not null and m.net > now() then 'unknown'
        when sc.payload_count > 0 then 'confirmed'
        when m.status_text like '%fail%' or m.status_text like '%anomaly%' or m.status_text like '%partial%' then 'unconfirmed'
        else 'unknown'
      end as deployment_status,
      to_jsonb(
        array_remove(
          array[
            case when sc.payload_count > 0 then 'satcat_payload_match' end,
            case when m.status_text like '%success%' or m.status_text like '%successful%' then 'launch_status_success' end,
            case when m.status_text like '%fail%' or m.status_text like '%anomaly%' or m.status_text like '%partial%' then 'launch_status_failure' end,
            case when m.net is not null and m.net > now() then 'launch_in_future_or_pending' end
          ],
          null::text
        )
      ) as deployment_evidence,
      case
        when m.net is not null and m.net > now() then 'Launch is in the future; deployment is not yet knowable.'
        when sc.payload_count > 0 then format('Confirmed by %s SATCAT payload match(es).', sc.payload_count)
        when m.status_text like '%fail%' or m.status_text like '%anomaly%' or m.status_text like '%partial%' then 'Launch outcome indicates failure/anomaly and no SATCAT deployment match was found.'
        else 'No explicit SATCAT deployment evidence is currently available.'
      end as deployment_notes
    from meta m
    cross join satcat sc
  ),
  payload_entries as (
    select
      0 as kind_order,
      pf.ll2_payload_flight_id as sort_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'kind', 'payload_flight',
          'id', pf.ll2_payload_flight_id,
          'url', pf.url,
          'destination', pf.destination,
          'amount', pf.amount,
          'deployment_status', d.deployment_status,
          'deployment_evidence', d.deployment_evidence,
          'deployment_notes', d.deployment_notes,
          'payload', jsonb_strip_nulls(
            jsonb_build_object(
              'id', p.ll2_payload_id,
              'name', p.name,
              'description', p.description,
              'mass_kg', p.mass_kg,
              'cost_usd', p.cost_usd,
              'wiki_link', p.wiki_link,
              'info_link', p.info_link,
              'program', p.program,
              'type', case
                when pt.ll2_payload_type_id is null then null
                else jsonb_build_object('id', pt.ll2_payload_type_id, 'name', pt.name)
              end,
              'manufacturer', case
                when m.ll2_agency_id is null then null
                else jsonb_build_object('id', m.ll2_agency_id, 'name', m.name, 'abbrev', m.abbrev)
              end,
              'operator', case
                when o.ll2_agency_id is null then null
                else jsonb_build_object('id', o.ll2_agency_id, 'name', o.name, 'abbrev', o.abbrev)
              end,
              'image', jsonb_strip_nulls(
                jsonb_build_object(
                  'image_url', p.image_url,
                  'thumbnail_url', p.thumbnail_url,
                  'credit', p.image_credit,
                  'license_name', p.image_license_name,
                  'license_url', p.image_license_url,
                  'single_use', p.image_single_use
                )
              ),
              'raw', case when include_raw then p.raw else null end
            )
          ),
          'landing', case
            when l.ll2_landing_id is null then null
            else jsonb_strip_nulls(
              jsonb_build_object(
                'id', l.ll2_landing_id,
                'attempt', l.attempt,
                'success', l.success,
                'description', l.description,
                'downrange_distance_km', l.downrange_distance_km,
                'landing_location', l.landing_location,
                'landing_type', l.landing_type,
                'raw', case when include_raw then l.raw else null end
              )
            )
          end,
          'docking_events', (
            select coalesce(
              jsonb_agg(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'id', de.ll2_docking_event_id,
                    'docking', de.docking,
                    'departure', de.departure,
                    'space_station_target', de.space_station,
                    'raw', case when include_raw then de.raw else null end
                  )
                )
                order by de.docking
              ),
              '[]'::jsonb
            )
            from public.ll2_payload_flight_docking_events de
            where de.ll2_payload_flight_id = pf.ll2_payload_flight_id
          ),
          'raw', case when include_raw then pf.raw else null end
        )
      ) as entry
    from public.ll2_payload_flights pf
    left join public.ll2_payloads p on p.ll2_payload_id = pf.ll2_payload_id
    left join public.ll2_payload_types pt on pt.ll2_payload_type_id = p.payload_type_id
    left join public.ll2_agencies m on m.ll2_agency_id = p.manufacturer_id
    left join public.ll2_agencies o on o.ll2_agency_id = p.operator_id
    left join public.ll2_landings l on l.ll2_landing_id = pf.ll2_landing_id
    cross join deployment d
    where pf.ll2_launch_uuid = ll2_launch_uuid_in
      and pf.active = true
  ),
  spacecraft_entries as (
    select
      1 as kind_order,
      sf.ll2_spacecraft_flight_id as sort_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'kind', 'spacecraft_flight',
          'id', -sf.ll2_spacecraft_flight_id,
          'url', sf.url,
          'destination', sf.destination,
          'amount', null,
          'deployment_status', d.deployment_status,
          'deployment_evidence', d.deployment_evidence,
          'deployment_notes', d.deployment_notes,
          'payload', jsonb_strip_nulls(
            jsonb_build_object(
              'id', sc.ll2_spacecraft_id,
              'name', sc.name,
              'description', sc.description,
              'mass_kg', null,
              'cost_usd', null,
              'wiki_link', null,
              'info_link', null,
              'program', null,
              'type', case
                when sct.ll2_spacecraft_type_id is null then null
                else jsonb_build_object('id', sct.ll2_spacecraft_type_id, 'name', sct.name)
              end,
              'manufacturer', case
                when a.ll2_agency_id is null then null
                else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
              end,
              'operator', case
                when a.ll2_agency_id is null then null
                else jsonb_build_object('id', a.ll2_agency_id, 'name', a.name, 'abbrev', a.abbrev)
              end,
              'image', jsonb_strip_nulls(
                jsonb_build_object(
                  'image_url', coalesce(sc.image_url, cfg.image_url),
                  'thumbnail_url', coalesce(sc.thumbnail_url, cfg.thumbnail_url),
                  'credit', coalesce(sc.image_credit, cfg.image_credit),
                  'license_name', coalesce(sc.image_license_name, cfg.image_license_name),
                  'license_url', coalesce(sc.image_license_url, cfg.image_license_url),
                  'single_use', coalesce(sc.image_single_use, cfg.image_single_use)
                )
              ),
              'raw', case when include_raw then sc.raw else null end
            )
          ),
          'landing', case
            when l.ll2_landing_id is null then null
            else jsonb_strip_nulls(
              jsonb_build_object(
                'id', l.ll2_landing_id,
                'attempt', l.attempt,
                'success', l.success,
                'description', l.description,
                'downrange_distance_km', l.downrange_distance_km,
                'landing_location', l.landing_location,
                'landing_type', l.landing_type,
                'raw', case when include_raw then l.raw else null end
              )
            )
          end,
          'docking_events', (
            select coalesce(
              jsonb_agg(
                jsonb_strip_nulls(
                  jsonb_build_object(
                    'id', de.ll2_docking_event_id,
                    'docking', de.docking,
                    'departure', de.departure,
                    'space_station_target', de.space_station,
                    'raw', case when include_raw then de.raw else null end
                  )
                )
                order by de.docking
              ),
              '[]'::jsonb
            )
            from public.ll2_spacecraft_flight_docking_events de
            where de.ll2_spacecraft_flight_id = sf.ll2_spacecraft_flight_id
          ),
          'raw', case when include_raw then sf.raw else null end
        )
      ) as entry
    from public.ll2_spacecraft_flights sf
    left join public.ll2_spacecrafts sc on sc.ll2_spacecraft_id = sf.ll2_spacecraft_id
    left join public.ll2_spacecraft_configs cfg on cfg.ll2_spacecraft_config_id = sc.spacecraft_config_id
    left join public.ll2_spacecraft_types sct on sct.ll2_spacecraft_type_id = cfg.spacecraft_type_id
    left join public.ll2_agencies a on a.ll2_agency_id = cfg.agency_id
    left join public.ll2_landings l on l.ll2_landing_id = sf.ll2_landing_id
    cross join deployment d
    where sf.ll2_launch_uuid = ll2_launch_uuid_in
      and sf.active = true
  ),
  combined as (
    select * from payload_entries
    union all
    select * from spacecraft_entries
  )
  select coalesce(
    jsonb_agg(combined.entry order by combined.kind_order, combined.sort_id),
    '[]'::jsonb
  )
  from combined;
$$;


--
-- Name: get_launch_satellite_payloads(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_satellite_payloads(ll2_launch_uuid_in uuid) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with ld as (
    select launch_designator
    from public.launches
    where ll2_launch_uuid = ll2_launch_uuid_in
    limit 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'norad_cat_id', s.norad_cat_id,
        'intl_des', s.intl_des,
        'name', s.object_name,
        'object_type', s.object_type,
        'ops_status_code', s.ops_status_code,
        'owner', s.owner,
        'launch_date', s.launch_date,
        'launch_site', s.launch_site,
        'period_min', s.period_min,
        'inclination_deg', s.inclination_deg,
        'apogee_km', s.apogee_km,
        'perigee_km', s.perigee_km,
        'raw', s.raw_satcat
      )
      order by s.intl_des
    ),
    '[]'::jsonb
  )
  from ld
  join public.satellites s
    on ld.launch_designator is not null
   and s.intl_des is not null
   and s.object_type = 'PAY'
   and s.intl_des like ld.launch_designator || '%';
$$;


--
-- Name: get_launch_satellite_payloads_v2(uuid, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_launch_satellite_payloads_v2(ll2_launch_uuid_in uuid, include_raw boolean DEFAULT false) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with ld as (
    select launch_designator
    from public.launches
    where ll2_launch_uuid = ll2_launch_uuid_in
    limit 1
  )
  select coalesce(
    jsonb_agg(
      jsonb_strip_nulls(
        jsonb_build_object(
          'norad_cat_id', s.norad_cat_id,
          'intl_des', s.intl_des,
          'name', s.object_name,
          'object_type', s.object_type,
          'ops_status_code', s.ops_status_code,
          'owner', s.owner,
          'launch_date', s.launch_date,
          'launch_site', s.launch_site,
          'period_min', s.period_min,
          'inclination_deg', s.inclination_deg,
          'apogee_km', s.apogee_km,
          'perigee_km', s.perigee_km,
          'raw', case when include_raw then s.raw_satcat else null end
        )
      )
      order by s.intl_des
    ),
    '[]'::jsonb
  )
  from ld
  join public.satellites s
    on ld.launch_designator is not null
   and s.intl_des is not null
   and s.object_type = 'PAY'
   and s.intl_des like ld.launch_designator || '%';
$$;


--
-- Name: get_satellite_detail(bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_satellite_detail(norad_cat_id_in bigint) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  with sat as (
    select
      norad_cat_id,
      intl_des,
      object_name,
      object_type,
      ops_status_code,
      owner,
      launch_date,
      launch_site,
      decay_date,
      period_min,
      inclination_deg,
      apogee_km,
      perigee_km,
      rcs_m2,
      satcat_updated_at
    from public.satellites
    where norad_cat_id = norad_cat_id_in
    limit 1
  ),
  orbit as (
    select
      source,
      epoch,
      inclination_deg,
      raan_deg,
      eccentricity,
      arg_perigee_deg,
      mean_anomaly_deg,
      mean_motion_rev_per_day,
      bstar,
      fetched_at
    from public.orbit_elements
    where norad_cat_id = norad_cat_id_in
    order by epoch desc
    limit 1
  ),
  groups as (
    select array_agg(group_code order by group_code) as group_codes
    from public.satellite_group_memberships
    where norad_cat_id = norad_cat_id_in
  )
  select coalesce(
    (
      select jsonb_build_object(
        'norad_cat_id', sat.norad_cat_id,
        'intl_des', sat.intl_des,
        'name', sat.object_name,
        'object_type', sat.object_type,
        'ops_status_code', sat.ops_status_code,
        'owner', sat.owner,
        'launch_date', sat.launch_date,
        'launch_site', sat.launch_site,
        'decay_date', sat.decay_date,
        'period_min', sat.period_min,
        'inclination_deg', sat.inclination_deg,
        'apogee_km', sat.apogee_km,
        'perigee_km', sat.perigee_km,
        'rcs_m2', sat.rcs_m2,
        'satcat_updated_at', sat.satcat_updated_at,
        'orbit', (
          select jsonb_build_object(
            'source', orbit.source,
            'epoch', orbit.epoch,
            'inclination_deg', orbit.inclination_deg,
            'raan_deg', orbit.raan_deg,
            'eccentricity', orbit.eccentricity,
            'arg_perigee_deg', orbit.arg_perigee_deg,
            'mean_anomaly_deg', orbit.mean_anomaly_deg,
            'mean_motion_rev_per_day', orbit.mean_motion_rev_per_day,
            'bstar', orbit.bstar,
            'fetched_at', orbit.fetched_at
          )
          from orbit
        ),
        'groups', (select group_codes from groups)
      )
      from sat
    ),
    '{}'::jsonb
  );
$$;


--
-- Name: get_satellite_owner_index_v1(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_satellite_owner_index_v1(limit_in integer DEFAULT 500, offset_in integer DEFAULT 0) RETURNS TABLE(owner text, satellite_count integer, last_satcat_updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select
    s.owner,
    count(*)::int as satellite_count,
    max(s.satcat_updated_at) as last_satcat_updated_at
  from public.satellites s
  where s.owner is not null
    and s.owner <> ''
  group by s.owner
  order by count(*) desc, s.owner asc
  limit greatest(1, least(coalesce(limit_in, 500), 5000))
  offset greatest(0, coalesce(offset_in, 0));
$$;


--
-- Name: get_satellite_owner_profile_v1(text, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_satellite_owner_profile_v1(owner_in text, satellites_limit integer DEFAULT 30, satellites_offset integer DEFAULT 0, launches_limit integer DEFAULT 20) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
  with normalized as (
    select upper(trim(coalesce(owner_in, ''))) as owner_code
  ),
  owner_rows as (
    select s.*
    from public.satellites s
    join normalized n on s.owner = n.owner_code
    where n.owner_code <> ''
  ),
  totals as (
    select
      count(*)::int as owner_satellite_count,
      max(orow.satcat_updated_at) as last_satcat_updated_at,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'PAY')::int as pay_count,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'RB')::int as rb_count,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'DEB')::int as deb_count,
      count(*) filter (where coalesce(orow.object_type, 'UNK') = 'UNK')::int as unk_count
    from owner_rows orow
  ),
  selected_satellites as (
    select
      orow.norad_cat_id,
      orow.intl_des,
      orow.object_name,
      orow.object_type,
      orow.satcat_updated_at,
      orow.apogee_km,
      orow.perigee_km,
      orow.inclination_deg
    from owner_rows orow
    order by orow.satcat_updated_at desc nulls last, orow.norad_cat_id desc
    limit greatest(1, least(coalesce(satellites_limit, 30), 200))
    offset greatest(0, coalesce(satellites_offset, 0))
  ),
  satellites_json as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'norad_cat_id', ss.norad_cat_id,
            'intl_des', ss.intl_des,
            'name', ss.object_name,
            'object_type', ss.object_type,
            'satcat_updated_at', ss.satcat_updated_at,
            'apogee_km', ss.apogee_km,
            'perigee_km', ss.perigee_km,
            'inclination_deg', ss.inclination_deg
          )
        )
        order by ss.satcat_updated_at desc nulls last, ss.norad_cat_id desc
      ),
      '[]'::jsonb
    ) as payload
    from selected_satellites ss
  ),
  launch_designators as (
    select distinct regexp_replace(orow.intl_des, '[A-Z]+$', '') as launch_designator
    from owner_rows orow
    where orow.intl_des is not null
      and orow.intl_des <> ''
  ),
  related_launches as (
    select
      l.id as launch_id,
      l.name as launch_name,
      l.slug as launch_slug,
      l.net as launch_net,
      l.provider as launch_provider,
      l.vehicle as launch_vehicle
    from public.launches l
    join launch_designators ld on ld.launch_designator = l.launch_designator
    where l.hidden = false
    order by l.net desc nulls last, l.id asc
    limit greatest(1, least(coalesce(launches_limit, 20), 100))
  ),
  launches_json as (
    select coalesce(
      jsonb_agg(
        jsonb_strip_nulls(
          jsonb_build_object(
            'launch_id', rl.launch_id,
            'launch_name', rl.launch_name,
            'launch_slug', rl.launch_slug,
            'launch_net', rl.launch_net,
            'launch_provider', rl.launch_provider,
            'launch_vehicle', rl.launch_vehicle
          )
        )
        order by rl.launch_net desc nulls last, rl.launch_id asc
      ),
      '[]'::jsonb
    ) as payload
    from related_launches rl
  ),
  present as (
    select exists(select 1 from owner_rows) as has_rows
  )
  select
    case
      when not (select has_rows from present) then '{}'::jsonb
      else jsonb_build_object(
        'owner', (select owner_code from normalized),
        'owner_satellite_count', coalesce((select t.owner_satellite_count from totals t), 0),
        'last_satcat_updated_at', (select t.last_satcat_updated_at from totals t),
        'type_counts', jsonb_build_object(
          'PAY', coalesce((select t.pay_count from totals t), 0),
          'RB', coalesce((select t.rb_count from totals t), 0),
          'DEB', coalesce((select t.deb_count from totals t), 0),
          'UNK', coalesce((select t.unk_count from totals t), 0)
        ),
        'satellites', coalesce((select s.payload from satellites_json s), '[]'::jsonb),
        'related_launches', coalesce((select l.payload from launches_json l), '[]'::jsonb)
      )
    end;
$_$;


--
-- Name: get_satellite_preview_batch_v1(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_satellite_preview_batch_v1(limit_in integer DEFAULT 100, offset_in integer DEFAULT 0) RETURNS TABLE(norad_cat_id bigint, intl_des text, object_name text, object_type text, owner text, satcat_updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select
    s.norad_cat_id,
    s.intl_des,
    s.object_name,
    s.object_type,
    s.owner,
    s.satcat_updated_at
  from public.satellites s
  where s.norad_cat_id is not null
  order by s.satcat_updated_at desc nulls last, s.norad_cat_id desc
  limit greatest(1, least(coalesce(limit_in, 100), 1000))
  offset greatest(0, coalesce(offset_in, 0));
$$;


--
-- Name: get_satellite_sitemap_batch_v1(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_satellite_sitemap_batch_v1(limit_in integer DEFAULT 1000, offset_in integer DEFAULT 0) RETURNS TABLE(norad_cat_id bigint, satcat_updated_at timestamp with time zone)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select
    s.norad_cat_id,
    s.satcat_updated_at
  from public.satellites s
  where s.norad_cat_id is not null
  order by s.satcat_updated_at desc nulls last, s.norad_cat_id desc
  limit greatest(1, least(coalesce(limit_in, 1000), 50000))
  offset greatest(0, coalesce(offset_in, 0));
$$;


--
-- Name: get_spacex_contract_by_slug_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_spacex_contract_by_slug_v1(contract_slug_in text) RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select coalesce(
    (
      select to_jsonb(s)
      from public.spacex_contracts s
      where public.normalize_spacex_contract_slug_v1(s.contract_key) =
            public.normalize_spacex_contract_slug_v1(contract_slug_in)
      order by
        s.awarded_on desc nulls last,
        s.updated_at desc nulls last,
        s.contract_key desc nulls last,
        s.id desc
      limit 1
    ),
    'null'::jsonb
  );
$$;


--
-- Name: get_spacex_contract_metrics_v1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_spacex_contract_metrics_v1() RETURNS jsonb
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select jsonb_build_object(
    'total_contract_count',
    count(*)::bigint,
    'total_amount',
    coalesce(sum(amount), 0)
  )
  from public.spacex_contracts;
$$;


--
-- Name: get_spacex_drone_ship_ingest_candidates(integer, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_spacex_drone_ship_ingest_candidates(limit_n integer DEFAULT 12, lookback_days integer DEFAULT 2, lookahead_days integer DEFAULT 7, stale_hours integer DEFAULT 48) RETURNS TABLE(launch_id uuid, ll2_launch_uuid uuid, net timestamp with time zone, assignment_last_verified timestamp with time zone)
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  with filtered as (
    select
      lpc.launch_id,
      lpc.ll2_launch_uuid,
      lpc.net,
      a.launch_id as assignment_launch_id,
      a.ship_slug,
      a.last_verified_at
    from public.launches_public_cache lpc
    left join public.spacex_drone_ship_assignments a
      on a.launch_id = lpc.launch_id
    where lpc.ll2_launch_uuid is not null
      and lpc.net is not null
      and lpc.net >= now() - make_interval(days => greatest(1, lookback_days))
      and lpc.net <= now() + make_interval(days => greatest(1, lookahead_days))
      and (
        lpc.provider ilike '%SpaceX%'
        or lpc.provider ilike '%Space X%'
        or lpc.name ilike '%Starship%'
        or lpc.name ilike '%Super Heavy%'
        or lpc.name ilike '%Falcon 9%'
        or lpc.name ilike '%Falcon Heavy%'
        or lpc.name ilike '%Crew Dragon%'
        or lpc.name ilike '%Cargo Dragon%'
        or lpc.mission_name ilike '%Starship%'
        or lpc.mission_name ilike '%Falcon%'
        or lpc.mission_name ilike '%Dragon%'
        or lpc.vehicle ilike '%Starship%'
        or lpc.vehicle ilike '%Falcon%'
        or lpc.vehicle ilike '%Dragon%'
        or lpc.rocket_full_name ilike '%Starship%'
        or lpc.rocket_full_name ilike '%Falcon%'
        or lpc.rocket_full_name ilike '%Dragon%'
      )
  ),
  prioritized as (
    select
      f.launch_id,
      f.ll2_launch_uuid,
      f.net,
      f.last_verified_at,
      case when f.assignment_launch_id is null then 0 else 1 end as row_presence_rank,
      case
        when f.assignment_launch_id is null then 0
        when f.ship_slug is null then 1
        else 2
      end as assignment_quality_rank,
      case when f.net >= now() then 0 else 1 end as temporal_rank,
      abs(extract(epoch from (f.net - now()))) as distance_seconds
    from filtered f
    where f.assignment_launch_id is null
       or f.last_verified_at is null
       or f.last_verified_at <= now() - make_interval(hours => greatest(1, stale_hours))
       or (f.ship_slug is null and f.net >= now() - make_interval(days => greatest(1, lookback_days)))
  )
  select
    p.launch_id,
    p.ll2_launch_uuid,
    p.net,
    p.last_verified_at as assignment_last_verified
  from prioritized p
  order by
    p.row_presence_rank asc,
    p.assignment_quality_rank asc,
    p.temporal_rank asc,
    p.distance_seconds asc,
    p.net desc
  limit least(greatest(limit_n, 1), 200);
$$;


--
-- Name: handle_launch_refresh_state_from_live_launches(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_live_launches() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  current_launch_id uuid := coalesce(new.id, old.id);
  should_touch boolean := false;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_touch := new.hidden is not true;
  elsif tg_op = 'DELETE' then
    should_touch := old.hidden is not true;
  else
    should_touch := old.hidden is not true or new.hidden is not true;
  end if;

  if should_touch and current_launch_id is not null then
    perform public.touch_launch_refresh_state('feed:live', 'feed_live', null);
    perform public.touch_launch_refresh_state('detail:live:' || current_launch_id::text, 'detail_live', current_launch_id);
  end if;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_launch_refresh_state_from_ll2_events(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_ll2_events() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  current_event_id bigint := null;
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    current_event_id := old.ll2_event_id;
  else
    current_event_id := coalesce(new.ll2_event_id, old.ll2_event_id);
  end if;
  if current_event_id is null then
    return coalesce(new, old);
  end if;

  for launch_row in
    select distinct launch_id
    from public.ll2_event_launches
    where ll2_event_id = current_event_id
      and launch_id is not null
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.launch_id);
  end loop;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_launch_refresh_state_from_manifest_tables(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_manifest_tables() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  current_launch_id uuid := coalesce(new.launch_id, old.launch_id);
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if current_launch_id is not null then
    perform public.touch_launch_refresh_state('detail:public:' || current_launch_id::text, 'detail_public', current_launch_id);
    perform public.touch_launch_refresh_state('detail:live:' || current_launch_id::text, 'detail_live', current_launch_id);
  end if;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_launch_refresh_state_from_named_launch_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_named_launch_column() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $_$
declare
  launch_id_text text := null;
  current_launch_id uuid := null;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_nargs < 1 then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    launch_id_text := to_jsonb(old) ->> tg_argv[0];
  else
    launch_id_text := coalesce(to_jsonb(new) ->> tg_argv[0], to_jsonb(old) ->> tg_argv[0]);
  end if;

  if launch_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    current_launch_id := launch_id_text::uuid;
  end if;

  perform public.touch_launch_detail_refresh_state(current_launch_id);
  return coalesce(new, old);
end;
$_$;


--
-- Name: handle_launch_refresh_state_from_public_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_public_cache() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  current_launch_id uuid := coalesce(new.launch_id, old.launch_id);
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if current_launch_id is not null then
    perform public.touch_launch_refresh_state('feed:public', 'feed_public', null);
    perform public.touch_launch_refresh_state('detail:public:' || current_launch_id::text, 'detail_public', current_launch_id);
  end if;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_launch_refresh_state_from_snapi_items(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_snapi_items() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  current_snapi_uid text := null;
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if tg_op = 'DELETE' then
    current_snapi_uid := trim(coalesce(old.snapi_uid, ''));
  else
    current_snapi_uid := trim(coalesce(new.snapi_uid, old.snapi_uid, ''));
  end if;
  if current_snapi_uid = '' then
    return coalesce(new, old);
  end if;

  for launch_row in
    select distinct launch_id
    from public.snapi_item_launches
    where snapi_uid = current_snapi_uid
      and launch_id is not null
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.launch_id);
  end loop;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_launch_refresh_state_from_ws45_live_weather(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_ws45_live_weather() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if to_regprocedure('public.touch_launch_detail_refresh_state(uuid)') is null then
    return coalesce(new, old);
  end if;

  for launch_row in
    select l.id
    from public.launches l
    where l.hidden is not true
      and upper(coalesce(l.pad_state, '')) = 'FL'
      and coalesce(l.window_end, l.window_start, l.net) >= now() - interval '6 hours'
      and coalesce(l.window_start, l.net) <= now() + interval '24 hours'
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.id);
  end loop;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_launch_refresh_state_from_ws45_planning(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_launch_refresh_state_from_ws45_planning() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  effective_start timestamptz := coalesce(new.valid_start, old.valid_start);
  effective_end timestamptz := coalesce(new.valid_end, old.valid_end);
  launch_row record;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) = to_jsonb(old) then
    return new;
  end if;

  if to_regprocedure('public.touch_launch_detail_refresh_state(uuid)') is null then
    return coalesce(new, old);
  end if;

  if effective_start is null or effective_end is null or effective_end <= effective_start then
    effective_start := now() - interval '6 hours';
    effective_end := now() + interval '7 days';
  end if;

  for launch_row in
    select l.id
    from public.launches l
    where l.hidden is not true
      and upper(coalesce(l.pad_state, '')) = 'FL'
      and coalesce(l.window_start, l.net) <= effective_end
      and coalesce(l.window_end, l.window_start, l.net) >= effective_start
      and coalesce(l.window_end, l.window_start, l.net) >= now() - interval '6 hours'
      and coalesce(l.window_start, l.net) <= now() + interval '7 days'
  loop
    perform public.touch_launch_detail_refresh_state(launch_row.id);
  end loop;

  return coalesce(new, old);
end;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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

  if to_regclass('public.privacy_preferences') is not null then
    insert into public.privacy_preferences (user_id, created_at, updated_at)
    values (new.id, now(), now())
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;


--
-- Name: increment_api_rate(text, timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_api_rate(provider_name text, window_start_in timestamp with time zone, window_seconds_in integer) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
begin
  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (provider_name, window_start_in, window_seconds_in, 1)
  on conflict (provider, window_start) do update set count = public.api_rate_counters.count + 1;
end;
$$;


--
-- Name: invoke_edge_job(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_edge_job(job_slug text) RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  enabled boolean := false;
  job_enabled boolean := true;
  job_enabled_key text := null;
  base_url text := '';
  auth_token text := '';
  api_key text := '';
  headers jsonb;
begin
  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into enabled
  from public.system_settings
  where key = 'jobs_enabled';

  if not enabled then
    return;
  end if;

  job_enabled_key := case job_slug
    when 'artemis-contracts-ingest' then 'artemis_contracts_job_enabled'
    when 'artemis-procurement-ingest' then 'artemis_procurement_job_enabled'
    when 'blue-origin-social-ingest' then 'blue_origin_social_job_enabled'
    when 'celestrak-gp-groups-sync' then 'celestrak_gp_groups_sync_enabled'
    when 'celestrak-gp-ingest' then 'celestrak_gp_job_enabled'
    when 'celestrak-satcat-ingest' then 'celestrak_satcat_job_enabled'
    when 'celestrak-intdes-ingest' then 'celestrak_intdes_job_enabled'
    when 'celestrak-supgp-sync' then 'celestrak_supgp_sync_enabled'
    when 'celestrak-supgp-ingest' then 'celestrak_supgp_job_enabled'
    when 'celestrak-retention-cleanup' then 'celestrak_retention_cleanup_enabled'
    when 'celestrak-ingest' then 'celestrak_ingest_job_enabled'
    when 'launch-social-link-backfill' then 'launch_social_link_backfill_enabled'
    when 'll2-catalog' then 'll2_catalog_job_enabled'
    when 'll2-catalog-agencies' then 'll2_catalog_agencies_job_enabled'
    when 'll2-future-launch-sync' then 'll2_future_launch_sync_job_enabled'
    when 'navcen-bnm-ingest' then 'navcen_bnm_job_enabled'
    when 'rocket-media-backfill' then 'rocket_media_backfill_job_enabled'
    when 'spacex-infographics-ingest' then 'spacex_infographics_job_enabled'
    when 'trajectory-orbit-ingest' then 'trajectory_orbit_job_enabled'
    when 'trajectory-constraints-ingest' then 'trajectory_constraints_job_enabled'
    when 'trajectory-products-generate' then 'trajectory_products_job_enabled'
    when 'trajectory-templates-generate' then 'trajectory_templates_job_enabled'
    when 'll2-backfill' then 'll2_backfill_job_enabled'
    when 'll2-payload-backfill' then 'll2_payload_backfill_job_enabled'
    when 'jep-score-refresh' then 'jep_score_job_enabled'
    when 'faa-tfr-ingest' then 'faa_job_enabled'
    when 'faa-notam-detail-ingest' then 'faa_notam_detail_job_enabled'
    when 'faa-launch-match' then 'faa_match_job_enabled'
    when 'faa-trajectory-hazard-ingest' then 'faa_trajectory_hazard_job_enabled'
    when 'ws45-live-weather-ingest' then 'ws45_live_weather_job_enabled'
    when 'ws45-planning-forecast-ingest' then 'ws45_planning_forecast_job_enabled'
    when 'ws45-weather-retention-cleanup' then 'ws45_weather_retention_cleanup_enabled'
    else null
  end;

  if job_enabled_key is not null then
    select
      case
        when jsonb_typeof(value) = 'boolean' then (value::boolean)
        when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
        else false
      end
    into job_enabled
    from public.system_settings
    where key = job_enabled_key;

    if not job_enabled then
      return;
    end if;
  end if;

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into base_url
  from public.system_settings
  where key = 'jobs_base_url';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into auth_token
  from public.system_settings
  where key = 'jobs_auth_token';

  select
    case
      when jsonb_typeof(value) = 'string' then trim(both '"' from value::text)
      else ''
    end
  into api_key
  from public.system_settings
  where key = 'jobs_apikey';

  if base_url = '' then
    raise notice 'jobs_base_url not set';
    return;
  end if;

  if api_key = '' then
    raise notice 'jobs_apikey not set';
    return;
  end if;

  if auth_token = '' then
    raise notice 'jobs_auth_token not set';
    return;
  end if;

  headers := jsonb_build_object(
    'Authorization', format('Bearer %s', api_key),
    'apikey', api_key,
    'x-job-token', auth_token,
    'Content-Type', 'application/json'
  );

  perform net.http_post(
    url := base_url || '/' || job_slug,
    headers := headers,
    body := '{}'::jsonb
  );
end;
$$;


--
-- Name: invoke_ll2_incremental_burst(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invoke_ll2_incremental_burst() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  enabled boolean := true;
  use_edge boolean := false;
  calls int := 4;
  interval_seconds int := 15;
  i int := 0;
begin
  -- Prevent overlap if a prior burst is still running.
  if not pg_try_advisory_xact_lock(hashtext('ll2_incremental_burst')::bigint) then
    return;
  end if;

  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else true
    end
  into enabled
  from public.system_settings
  where key = 'll2_incremental_job_enabled';

  if not enabled then
    return;
  end if;

  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into use_edge
  from public.system_settings
  where key = 'll2_incremental_use_edge_burst';

  if use_edge then
    perform public.invoke_edge_job('ll2-incremental-burst');
    return;
  end if;

  -- Legacy behavior: burst 4 calls spaced by interval_seconds inside Postgres.
  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else 4
    end
  into calls
  from public.system_settings
  where key = 'll2_incremental_calls_per_minute';

  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else 15
    end
  into interval_seconds
  from public.system_settings
  where key = 'll2_incremental_interval_seconds';

  calls := greatest(1, least(20, coalesce(calls, 4)));
  interval_seconds := greatest(1, least(60, coalesce(interval_seconds, 15)));
  calls := least(calls, (55 / interval_seconds) + 1);

  for i in 1..calls loop
    perform public.invoke_edge_job('ll2-incremental');
    if i < calls then
      perform pg_sleep(interval_seconds);
    end if;
  end loop;
end;
$$;


--
-- Name: is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'admin'
  );
$$;


--
-- Name: is_paid_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_paid_user() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = auth.uid()
      and s.status = 'active'
  );
$$;


--
-- Name: ll2_incremental_burst_guarded(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ll2_incremental_burst_guarded() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  begin
    if not pg_try_advisory_lock(hashtext('ll2_incremental_burst')::bigint) then
      return;
    end if;

    begin
      perform public.invoke_ll2_incremental_burst();
    exception when others then
      perform pg_advisory_unlock(hashtext('ll2_incremental_burst')::bigint);
      raise;
    end;

    perform pg_advisory_unlock(hashtext('ll2_incremental_burst')::bigint);
  end;
  $$;


--
-- Name: log_launch_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.log_launch_update() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  changed text[] := '{}';
  old_values jsonb := '{}'::jsonb;
  new_values jsonb := '{}'::jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Identity + schedule/status.
  if new.name is distinct from old.name then
    changed := array_append(changed, 'name');
    old_values := old_values || jsonb_build_object('name', old.name);
    new_values := new_values || jsonb_build_object('name', new.name);
  end if;

  if new.status_id is distinct from old.status_id then
    changed := array_append(changed, 'status_id');
    old_values := old_values || jsonb_build_object('status_id', old.status_id);
    new_values := new_values || jsonb_build_object('status_id', new.status_id);
  end if;

  if new.status_name is distinct from old.status_name then
    changed := array_append(changed, 'status_name');
    old_values := old_values || jsonb_build_object('status_name', old.status_name);
    new_values := new_values || jsonb_build_object('status_name', new.status_name);
  end if;

  if new.status_abbrev is distinct from old.status_abbrev then
    changed := array_append(changed, 'status_abbrev');
    old_values := old_values || jsonb_build_object('status_abbrev', old.status_abbrev);
    new_values := new_values || jsonb_build_object('status_abbrev', new.status_abbrev);
  end if;

  if new.net is distinct from old.net then
    changed := array_append(changed, 'net');
    old_values := old_values || jsonb_build_object('net', old.net);
    new_values := new_values || jsonb_build_object('net', new.net);
  end if;

  if new.net_precision is distinct from old.net_precision then
    changed := array_append(changed, 'net_precision');
    old_values := old_values || jsonb_build_object('net_precision', old.net_precision);
    new_values := new_values || jsonb_build_object('net_precision', new.net_precision);
  end if;

  if new.window_start is distinct from old.window_start then
    changed := array_append(changed, 'window_start');
    old_values := old_values || jsonb_build_object('window_start', old.window_start);
    new_values := new_values || jsonb_build_object('window_start', new.window_start);
  end if;

  if new.window_end is distinct from old.window_end then
    changed := array_append(changed, 'window_end');
    old_values := old_values || jsonb_build_object('window_end', old.window_end);
    new_values := new_values || jsonb_build_object('window_end', new.window_end);
  end if;

  -- Provider + vehicle.
  if new.provider is distinct from old.provider then
    changed := array_append(changed, 'provider');
    old_values := old_values || jsonb_build_object('provider', old.provider);
    new_values := new_values || jsonb_build_object('provider', new.provider);
  end if;

  if new.provider_type is distinct from old.provider_type then
    changed := array_append(changed, 'provider_type');
    old_values := old_values || jsonb_build_object('provider_type', old.provider_type);
    new_values := new_values || jsonb_build_object('provider_type', new.provider_type);
  end if;

  if new.provider_country_code is distinct from old.provider_country_code then
    changed := array_append(changed, 'provider_country_code');
    old_values := old_values || jsonb_build_object('provider_country_code', old.provider_country_code);
    new_values := new_values || jsonb_build_object('provider_country_code', new.provider_country_code);
  end if;

  if new.provider_description is distinct from old.provider_description then
    changed := array_append(changed, 'provider_description');
    old_values := old_values || jsonb_build_object('provider_description', old.provider_description);
    new_values := new_values || jsonb_build_object('provider_description', new.provider_description);
  end if;

  if new.provider_logo_url is distinct from old.provider_logo_url then
    changed := array_append(changed, 'provider_logo_url');
    old_values := old_values || jsonb_build_object('provider_logo_url', old.provider_logo_url);
    new_values := new_values || jsonb_build_object('provider_logo_url', new.provider_logo_url);
  end if;

  if new.provider_image_url is distinct from old.provider_image_url then
    changed := array_append(changed, 'provider_image_url');
    old_values := old_values || jsonb_build_object('provider_image_url', old.provider_image_url);
    new_values := new_values || jsonb_build_object('provider_image_url', new.provider_image_url);
  end if;

  if new.vehicle is distinct from old.vehicle then
    changed := array_append(changed, 'vehicle');
    old_values := old_values || jsonb_build_object('vehicle', old.vehicle);
    new_values := new_values || jsonb_build_object('vehicle', new.vehicle);
  end if;

  -- Pad / site.
  if new.pad_name is distinct from old.pad_name then
    changed := array_append(changed, 'pad_name');
    old_values := old_values || jsonb_build_object('pad_name', old.pad_name);
    new_values := new_values || jsonb_build_object('pad_name', new.pad_name);
  end if;

  if new.pad_short_code is distinct from old.pad_short_code then
    changed := array_append(changed, 'pad_short_code');
    old_values := old_values || jsonb_build_object('pad_short_code', old.pad_short_code);
    new_values := new_values || jsonb_build_object('pad_short_code', new.pad_short_code);
  end if;

  if new.pad_state is distinct from old.pad_state then
    changed := array_append(changed, 'pad_state');
    old_values := old_values || jsonb_build_object('pad_state', old.pad_state);
    new_values := new_values || jsonb_build_object('pad_state', new.pad_state);
  end if;

  if new.pad_timezone is distinct from old.pad_timezone then
    changed := array_append(changed, 'pad_timezone');
    old_values := old_values || jsonb_build_object('pad_timezone', old.pad_timezone);
    new_values := new_values || jsonb_build_object('pad_timezone', new.pad_timezone);
  end if;

  if new.pad_location_name is distinct from old.pad_location_name then
    changed := array_append(changed, 'pad_location_name');
    old_values := old_values || jsonb_build_object('pad_location_name', old.pad_location_name);
    new_values := new_values || jsonb_build_object('pad_location_name', new.pad_location_name);
  end if;

  if new.pad_map_url is distinct from old.pad_map_url then
    changed := array_append(changed, 'pad_map_url');
    old_values := old_values || jsonb_build_object('pad_map_url', old.pad_map_url);
    new_values := new_values || jsonb_build_object('pad_map_url', new.pad_map_url);
  end if;

  -- Mission.
  if new.mission_name is distinct from old.mission_name then
    changed := array_append(changed, 'mission_name');
    old_values := old_values || jsonb_build_object('mission_name', old.mission_name);
    new_values := new_values || jsonb_build_object('mission_name', new.mission_name);
  end if;

  if new.mission_description is distinct from old.mission_description then
    changed := array_append(changed, 'mission_description');
    old_values := old_values || jsonb_build_object('mission_description', old.mission_description);
    new_values := new_values || jsonb_build_object('mission_description', new.mission_description);
  end if;

  if new.mission_type is distinct from old.mission_type then
    changed := array_append(changed, 'mission_type');
    old_values := old_values || jsonb_build_object('mission_type', old.mission_type);
    new_values := new_values || jsonb_build_object('mission_type', new.mission_type);
  end if;

  if new.mission_orbit is distinct from old.mission_orbit then
    changed := array_append(changed, 'mission_orbit');
    old_values := old_values || jsonb_build_object('mission_orbit', old.mission_orbit);
    new_values := new_values || jsonb_build_object('mission_orbit', new.mission_orbit);
  end if;

  if new.mission_agencies is distinct from old.mission_agencies then
    changed := array_append(changed, 'mission_agencies');
    old_values := old_values || jsonb_build_object('mission_agencies', old.mission_agencies);
    new_values := new_values || jsonb_build_object('mission_agencies', new.mission_agencies);
  end if;

  if new.mission_info_urls is distinct from old.mission_info_urls then
    changed := array_append(changed, 'mission_info_urls');
    old_values := old_values || jsonb_build_object('mission_info_urls', old.mission_info_urls);
    new_values := new_values || jsonb_build_object('mission_info_urls', new.mission_info_urls);
  end if;

  if new.mission_vid_urls is distinct from old.mission_vid_urls then
    changed := array_append(changed, 'mission_vid_urls');
    old_values := old_values || jsonb_build_object('mission_vid_urls', old.mission_vid_urls);
    new_values := new_values || jsonb_build_object('mission_vid_urls', new.mission_vid_urls);
  end if;

  -- Rocket.
  if new.rocket_full_name is distinct from old.rocket_full_name then
    changed := array_append(changed, 'rocket_full_name');
    old_values := old_values || jsonb_build_object('rocket_full_name', old.rocket_full_name);
    new_values := new_values || jsonb_build_object('rocket_full_name', new.rocket_full_name);
  end if;

  if new.rocket_manufacturer is distinct from old.rocket_manufacturer then
    changed := array_append(changed, 'rocket_manufacturer');
    old_values := old_values || jsonb_build_object('rocket_manufacturer', old.rocket_manufacturer);
    new_values := new_values || jsonb_build_object('rocket_manufacturer', new.rocket_manufacturer);
  end if;

  if new.rocket_description is distinct from old.rocket_description then
    changed := array_append(changed, 'rocket_description');
    old_values := old_values || jsonb_build_object('rocket_description', old.rocket_description);
    new_values := new_values || jsonb_build_object('rocket_description', new.rocket_description);
  end if;

  if new.rocket_image_url is distinct from old.rocket_image_url then
    changed := array_append(changed, 'rocket_image_url');
    old_values := old_values || jsonb_build_object('rocket_image_url', old.rocket_image_url);
    new_values := new_values || jsonb_build_object('rocket_image_url', new.rocket_image_url);
  end if;

  if new.rocket_variant is distinct from old.rocket_variant then
    changed := array_append(changed, 'rocket_variant');
    old_values := old_values || jsonb_build_object('rocket_variant', old.rocket_variant);
    new_values := new_values || jsonb_build_object('rocket_variant', new.rocket_variant);
  end if;

  if new.rocket_length_m is distinct from old.rocket_length_m then
    changed := array_append(changed, 'rocket_length_m');
    old_values := old_values || jsonb_build_object('rocket_length_m', old.rocket_length_m);
    new_values := new_values || jsonb_build_object('rocket_length_m', new.rocket_length_m);
  end if;

  if new.rocket_diameter_m is distinct from old.rocket_diameter_m then
    changed := array_append(changed, 'rocket_diameter_m');
    old_values := old_values || jsonb_build_object('rocket_diameter_m', old.rocket_diameter_m);
    new_values := new_values || jsonb_build_object('rocket_diameter_m', new.rocket_diameter_m);
  end if;

  if new.rocket_reusable is distinct from old.rocket_reusable then
    changed := array_append(changed, 'rocket_reusable');
    old_values := old_values || jsonb_build_object('rocket_reusable', old.rocket_reusable);
    new_values := new_values || jsonb_build_object('rocket_reusable', new.rocket_reusable);
  end if;

  if new.rocket_maiden_flight is distinct from old.rocket_maiden_flight then
    changed := array_append(changed, 'rocket_maiden_flight');
    old_values := old_values || jsonb_build_object('rocket_maiden_flight', old.rocket_maiden_flight);
    new_values := new_values || jsonb_build_object('rocket_maiden_flight', new.rocket_maiden_flight);
  end if;

  if new.rocket_leo_capacity is distinct from old.rocket_leo_capacity then
    changed := array_append(changed, 'rocket_leo_capacity');
    old_values := old_values || jsonb_build_object('rocket_leo_capacity', old.rocket_leo_capacity);
    new_values := new_values || jsonb_build_object('rocket_leo_capacity', new.rocket_leo_capacity);
  end if;

  if new.rocket_gto_capacity is distinct from old.rocket_gto_capacity then
    changed := array_append(changed, 'rocket_gto_capacity');
    old_values := old_values || jsonb_build_object('rocket_gto_capacity', old.rocket_gto_capacity);
    new_values := new_values || jsonb_build_object('rocket_gto_capacity', new.rocket_gto_capacity);
  end if;

  if new.rocket_launch_mass is distinct from old.rocket_launch_mass then
    changed := array_append(changed, 'rocket_launch_mass');
    old_values := old_values || jsonb_build_object('rocket_launch_mass', old.rocket_launch_mass);
    new_values := new_values || jsonb_build_object('rocket_launch_mass', new.rocket_launch_mass);
  end if;

  if new.rocket_launch_cost is distinct from old.rocket_launch_cost then
    changed := array_append(changed, 'rocket_launch_cost');
    old_values := old_values || jsonb_build_object('rocket_launch_cost', old.rocket_launch_cost);
    new_values := new_values || jsonb_build_object('rocket_launch_cost', new.rocket_launch_cost);
  end if;

  if new.rocket_info_url is distinct from old.rocket_info_url then
    changed := array_append(changed, 'rocket_info_url');
    old_values := old_values || jsonb_build_object('rocket_info_url', old.rocket_info_url);
    new_values := new_values || jsonb_build_object('rocket_info_url', new.rocket_info_url);
  end if;

  if new.rocket_wiki_url is distinct from old.rocket_wiki_url then
    changed := array_append(changed, 'rocket_wiki_url');
    old_values := old_values || jsonb_build_object('rocket_wiki_url', old.rocket_wiki_url);
    new_values := new_values || jsonb_build_object('rocket_wiki_url', new.rocket_wiki_url);
  end if;

  if new.rocket_manufacturer_logo_url is distinct from old.rocket_manufacturer_logo_url then
    changed := array_append(changed, 'rocket_manufacturer_logo_url');
    old_values := old_values || jsonb_build_object('rocket_manufacturer_logo_url', old.rocket_manufacturer_logo_url);
    new_values := new_values || jsonb_build_object('rocket_manufacturer_logo_url', new.rocket_manufacturer_logo_url);
  end if;

  if new.rocket_manufacturer_image_url is distinct from old.rocket_manufacturer_image_url then
    changed := array_append(changed, 'rocket_manufacturer_image_url');
    old_values := old_values || jsonb_build_object('rocket_manufacturer_image_url', old.rocket_manufacturer_image_url);
    new_values := new_values || jsonb_build_object('rocket_manufacturer_image_url', new.rocket_manufacturer_image_url);
  end if;

  -- Links.
  if new.video_url is distinct from old.video_url then
    changed := array_append(changed, 'video_url');
    old_values := old_values || jsonb_build_object('video_url', old.video_url);
    new_values := new_values || jsonb_build_object('video_url', new.video_url);
  end if;

  if new.webcast_live is distinct from old.webcast_live then
    changed := array_append(changed, 'webcast_live');
    old_values := old_values || jsonb_build_object('webcast_live', old.webcast_live);
    new_values := new_values || jsonb_build_object('webcast_live', new.webcast_live);
  end if;

  if new.launch_info_urls is distinct from old.launch_info_urls then
    changed := array_append(changed, 'launch_info_urls');
    old_values := old_values || jsonb_build_object('launch_info_urls', old.launch_info_urls);
    new_values := new_values || jsonb_build_object('launch_info_urls', new.launch_info_urls);
  end if;

  if new.launch_vid_urls is distinct from old.launch_vid_urls then
    changed := array_append(changed, 'launch_vid_urls');
    old_values := old_values || jsonb_build_object('launch_vid_urls', old.launch_vid_urls);
    new_values := new_values || jsonb_build_object('launch_vid_urls', new.launch_vid_urls);
  end if;

  if new.flightclub_url is distinct from old.flightclub_url then
    changed := array_append(changed, 'flightclub_url');
    old_values := old_values || jsonb_build_object('flightclub_url', old.flightclub_url);
    new_values := new_values || jsonb_build_object('flightclub_url', new.flightclub_url);
  end if;

  if new.hashtag is distinct from old.hashtag then
    changed := array_append(changed, 'hashtag');
    old_values := old_values || jsonb_build_object('hashtag', old.hashtag);
    new_values := new_values || jsonb_build_object('hashtag', new.hashtag);
  end if;

  -- Operational fields displayed in detail.
  if new.probability is distinct from old.probability then
    changed := array_append(changed, 'probability');
    old_values := old_values || jsonb_build_object('probability', old.probability);
    new_values := new_values || jsonb_build_object('probability', new.probability);
  end if;

  if new.hold_reason is distinct from old.hold_reason then
    changed := array_append(changed, 'hold_reason');
    old_values := old_values || jsonb_build_object('hold_reason', old.hold_reason);
    new_values := new_values || jsonb_build_object('hold_reason', new.hold_reason);
  end if;

  if new.fail_reason is distinct from old.fail_reason then
    changed := array_append(changed, 'fail_reason');
    old_values := old_values || jsonb_build_object('fail_reason', old.fail_reason);
    new_values := new_values || jsonb_build_object('fail_reason', new.fail_reason);
  end if;

  -- Detail sections backed by JSON blobs.
  if new.programs is distinct from old.programs then
    changed := array_append(changed, 'programs');
    old_values := old_values || jsonb_build_object('programs', old.programs);
    new_values := new_values || jsonb_build_object('programs', new.programs);
  end if;

  if new.crew is distinct from old.crew then
    changed := array_append(changed, 'crew');
    old_values := old_values || jsonb_build_object('crew', old.crew);
    new_values := new_values || jsonb_build_object('crew', new.crew);
  end if;

  if new.payloads is distinct from old.payloads then
    changed := array_append(changed, 'payloads');
    old_values := old_values || jsonb_build_object('payloads', old.payloads);
    new_values := new_values || jsonb_build_object('payloads', new.payloads);
  end if;

  if new.timeline is distinct from old.timeline then
    changed := array_append(changed, 'timeline');
    old_values := old_values || jsonb_build_object('timeline', old.timeline);
    new_values := new_values || jsonb_build_object('timeline', new.timeline);
  end if;

  -- User-visible tier and admin overrides.
  if new.tier_auto is distinct from old.tier_auto then
    changed := array_append(changed, 'tier_auto');
    old_values := old_values || jsonb_build_object('tier_auto', old.tier_auto);
    new_values := new_values || jsonb_build_object('tier_auto', new.tier_auto);
  end if;

  if new.tier_override is distinct from old.tier_override then
    changed := array_append(changed, 'tier_override');
    old_values := old_values || jsonb_build_object('tier_override', old.tier_override);
    new_values := new_values || jsonb_build_object('tier_override', new.tier_override);
  end if;

  if new.featured is distinct from old.featured then
    changed := array_append(changed, 'featured');
    old_values := old_values || jsonb_build_object('featured', old.featured);
    new_values := new_values || jsonb_build_object('featured', new.featured);
  end if;

  if new.hidden is distinct from old.hidden then
    changed := array_append(changed, 'hidden');
    old_values := old_values || jsonb_build_object('hidden', old.hidden);
    new_values := new_values || jsonb_build_object('hidden', new.hidden);
  end if;

  -- Images (hero + credits/licenses surfaced via UI).
  if new.image_url is distinct from old.image_url then
    changed := array_append(changed, 'image_url');
    old_values := old_values || jsonb_build_object('image_url', old.image_url);
    new_values := new_values || jsonb_build_object('image_url', new.image_url);
  end if;

  if new.image_thumbnail_url is distinct from old.image_thumbnail_url then
    changed := array_append(changed, 'image_thumbnail_url');
    old_values := old_values || jsonb_build_object('image_thumbnail_url', old.image_thumbnail_url);
    new_values := new_values || jsonb_build_object('image_thumbnail_url', new.image_thumbnail_url);
  end if;

  if new.image_credit is distinct from old.image_credit then
    changed := array_append(changed, 'image_credit');
    old_values := old_values || jsonb_build_object('image_credit', old.image_credit);
    new_values := new_values || jsonb_build_object('image_credit', new.image_credit);
  end if;

  if new.image_license_name is distinct from old.image_license_name then
    changed := array_append(changed, 'image_license_name');
    old_values := old_values || jsonb_build_object('image_license_name', old.image_license_name);
    new_values := new_values || jsonb_build_object('image_license_name', new.image_license_name);
  end if;

  if new.image_license_url is distinct from old.image_license_url then
    changed := array_append(changed, 'image_license_url');
    old_values := old_values || jsonb_build_object('image_license_url', old.image_license_url);
    new_values := new_values || jsonb_build_object('image_license_url', new.image_license_url);
  end if;

  if new.image_single_use is distinct from old.image_single_use then
    changed := array_append(changed, 'image_single_use');
    old_values := old_values || jsonb_build_object('image_single_use', old.image_single_use);
    new_values := new_values || jsonb_build_object('image_single_use', new.image_single_use);
  end if;

  if array_length(changed, 1) is null then
    return new;
  end if;

  insert into public.launch_updates(launch_id, changed_fields, old_values, new_values, detected_at)
  values (new.id, changed, old_values, new_values, now());

  return new;
end;
$$;


--
-- Name: managed_scheduler_enqueue_due(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.managed_scheduler_enqueue_due(limit_n integer DEFAULT 100) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(1, least(coalesce(limit_n, 100), 1000));
  v_count int := 0;
begin
  with due as (
    select
      j.cron_job_name,
      j.edge_job_slug,
      j.next_run_at,
      j.max_attempts,
      public.managed_scheduler_next_run(now(), j.interval_seconds, j.offset_seconds) as next_due
    from public.managed_scheduler_jobs j
    where j.enabled = true
      and j.next_run_at <= now()
    order by j.next_run_at asc
    for update skip locked
    limit v_limit
  ), advanced as (
    update public.managed_scheduler_jobs j
    set next_run_at = due.next_due,
        last_enqueued_at = now(),
        updated_at = now()
    from due
    where j.cron_job_name = due.cron_job_name
    returning due.cron_job_name, due.edge_job_slug, due.next_run_at as scheduled_for, due.max_attempts
  ), ins as (
    insert into public.managed_scheduler_queue (
      cron_job_name,
      edge_job_slug,
      scheduled_for,
      status,
      attempts,
      max_attempts
    )
    select
      a.cron_job_name,
      a.edge_job_slug,
      a.scheduled_for,
      'queued',
      0,
      a.max_attempts
    from advanced a
    on conflict (cron_job_name, scheduled_for) do nothing
    returning 1
  )
  select count(*) into v_count from ins;

  return v_count;
end;
$$;


--
-- Name: managed_scheduler_next_run(timestamp with time zone, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.managed_scheduler_next_run(at_ts timestamp with time zone, interval_seconds integer, offset_seconds integer) RETURNS timestamp with time zone
    LANGUAGE sql IMMUTABLE STRICT
    SET search_path TO 'pg_catalog'
    AS $$
  select to_timestamp(
    (
      (
        floor(
          (
            extract(epoch from at_ts)::numeric
            - greatest(0, offset_seconds)::numeric
          ) / greatest(1, interval_seconds)::numeric
        ) + 1
      ) * greatest(1, interval_seconds)::numeric
      + greatest(0, offset_seconds)::numeric
    )::double precision
  )
$$;


--
-- Name: managed_scheduler_tick(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.managed_scheduler_tick(enqueue_limit integer DEFAULT NULL::integer, process_limit integer DEFAULT NULL::integer) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  v_enqueue_limit int := 200;
  v_process_limit int := 100;
  v_retry_delay_seconds int := 120;
  v_max_queue_depth int := 2500;
  v_retain_hours int := 168;

  v_enqueued int := 0;
  v_sent int := 0;
  v_failed int := 0;
  v_requeued int := 0;
  v_pruned int := 0;

  v_managed_enabled boolean := true;
  v_jobs_enabled boolean := false;
  v_queue_depth_before int := 0;
  v_queue_depth_after int := 0;
  v_enqueue_skipped boolean := false;
  v_now timestamptz := now();
  item record;
begin
  if not pg_try_advisory_xact_lock(hashtext('managed_scheduler_tick')::bigint) then
    return jsonb_build_object('ok', true, 'skipped', 'locked');
  end if;

  select
    coalesce(
      (
        select case
          when jsonb_typeof(s.value) = 'boolean' then (s.value::boolean)
          when jsonb_typeof(s.value) = 'string' then lower(trim(both '"' from s.value::text)) = 'true'
          else true
        end
        from public.system_settings s
        where s.key = 'managed_scheduler_enabled'
      ),
      true
    )
  into v_managed_enabled;

  if not v_managed_enabled then
    return jsonb_build_object('ok', true, 'skipped', 'managed_scheduler_disabled');
  end if;

  select
    coalesce(
      (
        select case
          when jsonb_typeof(s.value) = 'boolean' then (s.value::boolean)
          when jsonb_typeof(s.value) = 'string' then lower(trim(both '"' from s.value::text)) = 'true'
          else false
        end
        from public.system_settings s
        where s.key = 'jobs_enabled'
      ),
      false
    )
  into v_jobs_enabled;

  if not v_jobs_enabled then
    return jsonb_build_object('ok', true, 'skipped', 'jobs_disabled');
  end if;

  if enqueue_limit is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(1, least((s.value::text)::int, 1000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(1, least((trim(both '"' from s.value::text))::int, 1000))
        else null
      end
    into v_enqueue_limit
    from public.system_settings s
    where s.key = 'managed_scheduler_enqueue_limit';
  else
    v_enqueue_limit := greatest(1, least(enqueue_limit, 1000));
  end if;

  if process_limit is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(1, least((s.value::text)::int, 500))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(1, least((trim(both '"' from s.value::text))::int, 500))
        else null
      end
    into v_process_limit
    from public.system_settings s
    where s.key = 'managed_scheduler_process_limit';
  else
    v_process_limit := greatest(1, least(process_limit, 500));
  end if;

  select
    case
      when jsonb_typeof(s.value) = 'number' then greatest(30, least((s.value::text)::int, 3600))
      when jsonb_typeof(s.value) = 'string'
        and trim(both '"' from s.value::text) ~ '^-?\\d+$'
        then greatest(30, least((trim(both '"' from s.value::text))::int, 3600))
      else null
    end
  into v_retry_delay_seconds
  from public.system_settings s
  where s.key = 'managed_scheduler_retry_delay_seconds';

  select
    case
      when jsonb_typeof(s.value) = 'number' then greatest(100, least((s.value::text)::int, 20000))
      when jsonb_typeof(s.value) = 'string'
        and trim(both '"' from s.value::text) ~ '^-?\\d+$'
        then greatest(100, least((trim(both '"' from s.value::text))::int, 20000))
      else null
    end
  into v_max_queue_depth
  from public.system_settings s
  where s.key = 'managed_scheduler_max_queue_depth';

  select
    case
      when jsonb_typeof(s.value) = 'number' then greatest(24, least((s.value::text)::int, 24 * 30))
      when jsonb_typeof(s.value) = 'string'
        and trim(both '"' from s.value::text) ~ '^-?\\d+$'
        then greatest(24, least((trim(both '"' from s.value::text))::int, 24 * 30))
      else null
    end
  into v_retain_hours
  from public.system_settings s
  where s.key = 'managed_scheduler_queue_retain_hours';

  v_enqueue_limit := coalesce(v_enqueue_limit, 200);
  v_process_limit := coalesce(v_process_limit, 100);
  v_retry_delay_seconds := coalesce(v_retry_delay_seconds, 120);
  v_max_queue_depth := coalesce(v_max_queue_depth, 2500);
  v_retain_hours := coalesce(v_retain_hours, 168);

  select count(*)::int
  into v_queue_depth_before
  from public.managed_scheduler_queue q
  where q.status in ('queued', 'sending');

  if v_queue_depth_before >= v_max_queue_depth then
    v_enqueue_skipped := true;
    v_enqueued := 0;
  else
    v_enqueued := public.managed_scheduler_enqueue_due(v_enqueue_limit);
  end if;

  for item in
    with claim as (
      select q.id
      from public.managed_scheduler_queue q
      where q.status = 'queued'
        and q.scheduled_for <= now()
      order by q.scheduled_for asc, q.id asc
      limit v_process_limit
      for update skip locked
    ), sending as (
      update public.managed_scheduler_queue q
      set status = 'sending',
          attempts = q.attempts + 1,
          locked_at = now(),
          started_at = now(),
          error = null,
          updated_at = now()
      from claim
      where q.id = claim.id
      returning
        q.id,
        q.cron_job_name,
        q.edge_job_slug,
        q.attempts,
        q.max_attempts
    )
    select * from sending
  loop
    begin
      perform public.invoke_edge_job(item.edge_job_slug);

      update public.managed_scheduler_queue
      set status = 'sent',
          finished_at = now(),
          locked_at = null,
          updated_at = now()
      where id = item.id;

      update public.managed_scheduler_jobs
      set last_dispatched_at = now(),
          last_error = null,
          updated_at = now()
      where cron_job_name = item.cron_job_name;

      v_sent := v_sent + 1;
    exception when others then
      if item.attempts < item.max_attempts then
        update public.managed_scheduler_queue
        set status = 'queued',
            scheduled_for = now() + make_interval(secs => v_retry_delay_seconds),
            error = left(sqlerrm, 900),
            locked_at = null,
            started_at = null,
            updated_at = now()
        where id = item.id;

        v_requeued := v_requeued + 1;
      else
        update public.managed_scheduler_queue
        set status = 'failed',
            error = left(sqlerrm, 900),
            finished_at = now(),
            locked_at = null,
            updated_at = now()
        where id = item.id;

        v_failed := v_failed + 1;
      end if;

      update public.managed_scheduler_jobs
      set last_error = left(sqlerrm, 900),
          updated_at = now()
      where cron_job_name = item.cron_job_name;
    end;
  end loop;

  if extract(minute from v_now)::int = 0 then
    v_pruned := public.prune_managed_scheduler_queue(make_interval(hours => v_retain_hours), 5000);
  end if;

  select count(*)::int
  into v_queue_depth_after
  from public.managed_scheduler_queue q
  where q.status in ('queued', 'sending');

  return jsonb_build_object(
    'ok', true,
    'enqueued', v_enqueued,
    'sent', v_sent,
    'failed', v_failed,
    'requeued', v_requeued,
    'pruned', v_pruned,
    'queueDepthBefore', v_queue_depth_before,
    'queueDepthAfter', v_queue_depth_after,
    'enqueueSkipped', v_enqueue_skipped,
    'limits', jsonb_build_object(
      'enqueueLimit', v_enqueue_limit,
      'processLimit', v_process_limit,
      'maxQueueDepth', v_max_queue_depth,
      'retryDelaySeconds', v_retry_delay_seconds,
      'retainHours', v_retain_hours
    )
  );
end;
$_$;


--
-- Name: mark_launch_dirty_for_faa_match(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_launch_dirty_for_faa_match() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  reasons text[] := '{}'::text[];
begin
  if tg_op = 'UPDATE' and new.hidden = true then
    delete from public.faa_launch_match_dirty_launches where launch_id = new.id;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.hidden = false then
      perform public.enqueue_faa_launch_match_dirty_launch(new.id, array['launch_insert']);
    end if;
    return new;
  end if;

  if new.hidden = true then
    return new;
  end if;

  if new.net is distinct from old.net then
    reasons := array_append(reasons, 'net');
  end if;

  if new.window_start is distinct from old.window_start then
    reasons := array_append(reasons, 'window_start');
  end if;

  if new.window_end is distinct from old.window_end then
    reasons := array_append(reasons, 'window_end');
  end if;

  if new.pad_latitude is distinct from old.pad_latitude then
    reasons := array_append(reasons, 'pad_latitude');
  end if;

  if new.pad_longitude is distinct from old.pad_longitude then
    reasons := array_append(reasons, 'pad_longitude');
  end if;

  if new.hidden is distinct from old.hidden and new.hidden = false then
    reasons := array_append(reasons, 'hidden');
  end if;

  if array_length(reasons, 1) is not null then
    perform public.enqueue_faa_launch_match_dirty_launch(new.id, reasons);
  end if;

  return new;
end;
$$;


--
-- Name: mark_launch_trajectory_constraint_dirty_for_faa_match(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_launch_trajectory_constraint_dirty_for_faa_match() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_launch_id uuid := coalesce(new.launch_id, old.launch_id);
  v_constraint_type text := coalesce(new.constraint_type, old.constraint_type, '');
  v_source text := coalesce(new.source, old.source, '');
  v_orbit_type text := coalesce(new.data ->> 'orbitType', old.data ->> 'orbitType', '');
  v_reason text := null;
begin
  if v_launch_id is null then
    return coalesce(new, old);
  end if;

  if v_constraint_type = 'landing' then
    if v_source <> 'll2' then
      return coalesce(new, old);
    end if;
    v_reason := 'trajectory_landing';
  elsif v_constraint_type = 'target_orbit' then
    if v_source in ('faa_tfr', 'navcen_bnm', 'trajectory_templates_v1') then
      return coalesce(new, old);
    end if;
    if v_orbit_type = 'hazard_azimuth_estimate' then
      return coalesce(new, old);
    end if;
    v_reason := 'trajectory_target_orbit';
  else
    return coalesce(new, old);
  end if;

  perform public.enqueue_faa_launch_match_dirty_launch(v_launch_id, array[v_reason]);
  return coalesce(new, old);
end;
$$;


--
-- Name: normalize_spacex_contract_slug_v1(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_spacex_contract_slug_v1(value_in text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'pg_catalog'
    AS $_$
  select left(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(value_in, ''))), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    ),
    128
  );
$_$;


--
-- Name: ops_metrics_prune(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_metrics_prune() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  raw_days int := 7;
  rollup_days int := 30;
  raw_deleted bigint := 0;
  rollup_deleted bigint := 0;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else raw_days
    end
  into raw_days
  from public.system_settings
  where key = 'ops_metrics_retention_raw_days';

  select
    case
      when jsonb_typeof(value) = 'number' then (value::text)::int
      when jsonb_typeof(value) = 'string' then nullif(trim(both '"' from value::text), '')::int
      else rollup_days
    end
  into rollup_days
  from public.system_settings
  where key = 'ops_metrics_retention_rollup_days';

  raw_days := greatest(1, least(coalesce(raw_days, 7), 90));
  rollup_days := greatest(raw_days, least(coalesce(rollup_days, 30), 365));

  with raw_del as (
    delete from public.ops_metrics_samples_1m
    where sampled_at < now() - make_interval(days => raw_days)
    returning 1
  )
  select count(*) into raw_deleted from raw_del;

  with rollup_del as (
    delete from public.ops_metrics_samples_5m
    where sampled_at < now() - make_interval(days => rollup_days)
    returning 1
  )
  select count(*) into rollup_deleted from rollup_del;

  return jsonb_build_object(
    'ok', true,
    'rawDays', raw_days,
    'rollupDays', rollup_days,
    'rawDeleted', raw_deleted,
    'rollupDeleted', rollup_deleted
  );
end;
$$;


--
-- Name: ops_metrics_rollup_5m(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ops_metrics_rollup_5m() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  upserted_count bigint := 0;
begin
  if auth.role() <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  with agg as (
    select
      to_timestamp(floor(extract(epoch from t.sampled_at) / 300) * 300)::timestamptz as sampled_at,
      t.metric_key,
      t.labels,
      avg(t.value)::double precision as value
    from public.ops_metrics_samples_1m t
    where t.sampled_at >= now() - interval '3 days'
    group by 1, 2, 3
  ), upserted as (
    insert into public.ops_metrics_samples_5m(sampled_at, metric_key, labels, value, source, collected_at)
    select sampled_at, metric_key, labels, value, 'rollup_5m', now()
    from agg
    on conflict (sampled_at, metric_key, labels) do update
      set value = excluded.value,
          source = excluded.source,
          collected_at = excluded.collected_at
    returning 1
  )
  select count(*) into upserted_count from upserted;

  return jsonb_build_object('ok', true, 'upserted', upserted_count);
end;
$$;


--
-- Name: pick_launch_on_this_day(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pick_launch_on_this_day(p_month integer, p_day integer) RETURNS TABLE(id uuid, name text, slug text, net timestamp with time zone, net_precision text, window_start timestamp with time zone, window_end timestamp with time zone, provider text, vehicle text, mission_name text, mission_description text, rocket_full_name text, pad_name text, pad_short_code text, pad_location_name text, pad_timezone text, pad_state text, pad_country_code text, status_name text, status_abbrev text, hidden boolean)
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select
    l.id,
    l.name,
    l.slug,
    l.net,
    l.net_precision,
    l.window_start,
    l.window_end,
    l.provider,
    l.vehicle,
    l.mission_name,
    l.mission_description,
    l.rocket_full_name,
    l.pad_name,
    l.pad_short_code,
    l.pad_location_name,
    l.pad_timezone,
    l.pad_state,
    l.pad_country_code,
    l.status_name,
    l.status_abbrev,
    l.hidden
  from public.launches l
  left join pg_catalog.pg_timezone_names tz on tz.name = l.pad_timezone
  where l.hidden is false
    and l.pad_country_code in ('USA', 'US')
    and l.net is not null
    and l.net < now()
    and l.mission_description is not null
    and btrim(l.mission_description) <> ''
    and extract(month from (l.net at time zone coalesce(tz.name, 'America/New_York')))::int = p_month
    and extract(day from (l.net at time zone coalesce(tz.name, 'America/New_York')))::int = p_day
    and lower(coalesce(l.status_name,'') || ' ' || coalesce(l.status_abbrev,'')) not like '%scrub%'
    and lower(coalesce(l.status_name,'') || ' ' || coalesce(l.status_abbrev,'')) not like '%cancel%'
  order by l.net desc
  limit 1;
$$;


--
-- Name: premium_onboarding_before_user_created(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.premium_onboarding_before_user_created(event jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  provider_raw text;
  normalized_provider text;
  normalized_email text;
  matched_claim_id uuid;
begin
  provider_raw := lower(coalesce(event->'user'->'app_metadata'->>'provider', ''));
  normalized_email := lower(btrim(coalesce(event->'user'->>'email', '')));

  if provider_raw = 'google' then
    normalized_provider := 'google';
  elsif provider_raw = 'apple' then
    normalized_provider := 'apple';
  else
    normalized_provider := 'email_password';
  end if;

  if normalized_provider = 'email_password' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'message', 'Complete Premium purchase verification before creating a new account.',
        'http_code', 403,
        'code', 'premium_onboarding_required'
      )
    );
  end if;

  if normalized_email = '' then
    return jsonb_build_object(
      'error',
      jsonb_build_object(
        'message', 'Complete Premium purchase verification before creating a new account.',
        'http_code', 403,
        'code', 'premium_onboarding_required'
      )
    );
  end if;

  update public.premium_onboarding_allow_creates
  set
    used_at = timezone('utc', now()),
    updated_at = timezone('utc', now())
  where provider = normalized_provider
    and email_normalized = normalized_email
    and claim_id is not null
    and used_at is null
    and expires_at > timezone('utc', now())
    and exists (
      select 1
      from public.premium_claims c
      where c.id = public.premium_onboarding_allow_creates.claim_id
        and c.status = 'verified'
        and c.user_id is null
    )
  returning claim_id into matched_claim_id;

  if matched_claim_id is not null then
    update public.premium_claims
    set
      metadata = jsonb_set(
        coalesce(metadata, '{}'::jsonb),
        '{provider_create}',
        jsonb_build_object(
          'provider', normalized_provider,
          'email', normalized_email,
          'usedAt', timezone('utc', now())
        ),
        true
      ),
      updated_at = timezone('utc', now())
    where id = matched_claim_id
      and status = 'verified'
      and user_id is null;

    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error',
    jsonb_build_object(
      'message', 'Complete Premium purchase verification before creating a new account.',
      'http_code', 403,
      'code', 'premium_onboarding_required'
    )
  );
end;
$$;


--
-- Name: program_usaspending_award_identity_key(text, text, text, date, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.program_usaspending_award_identity_key(usaspending_award_id text, award_title text, recipient text, awarded_on date, metadata jsonb DEFAULT '{}'::jsonb) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select case
    when public.program_usaspending_normalize_identity_component(usaspending_award_id, 256) <> '' then
      'award:' || public.program_usaspending_normalize_identity_component(usaspending_award_id, 256)
    else
      'fallback:' || coalesce(
        nullif(
          concat_ws(
            '|',
            nullif(public.program_usaspending_normalize_identity_component(award_title, 160), ''),
            nullif(public.program_usaspending_normalize_identity_component(recipient, 120), ''),
            nullif(left(coalesce(awarded_on::text, ''), 10), ''),
            nullif(
              public.program_usaspending_normalize_identity_component(
                coalesce(
                  metadata->>'awardPageUrl',
                  metadata->>'sourceUrl',
                  metadata->>'awardApiUrl',
                  ''
                ),
                240
              ),
              ''
            )
          ),
          ''
        ),
        'unknown'
      )
  end;
$$;


--
-- Name: program_usaspending_normalize_identity_component(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.program_usaspending_normalize_identity_component(value text, max_length integer DEFAULT 256) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  select left(
    regexp_replace(
      replace(lower(trim(coalesce(value, ''))), '|', ' '),
      '\s+',
      ' ',
      'g'
    ),
    greatest(1, coalesce(max_length, 256))
  );
$$;


--
-- Name: provider_counts_us(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.provider_counts_us(lookback_days integer DEFAULT 365) RETURNS TABLE(provider text, launch_count integer)
    LANGUAGE sql STABLE
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  select
    provider,
    count(*)::int as launch_count
  from public.launches_public_cache
  where provider is not null
    and provider <> ''
    and lower(provider) <> 'unknown'
    and pad_country_code in ('USA', 'US')
    and net >= now() - make_interval(days => greatest(1, least(lookback_days, 3650)))
  group by provider
  order by launch_count desc, provider asc;
$$;


--
-- Name: prune_cron_job_run_details(interval, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_cron_job_run_details(retain interval DEFAULT '48:00:00'::interval, batch_limit integer DEFAULT 50000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'cron', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(100, least(coalesce(batch_limit, 50000), 500000));
  v_deleted int := 0;
begin
  with doomed as (
    select ctid
    from cron.job_run_details
    where coalesce(end_time, start_time) < now() - retain
    order by coalesce(end_time, start_time) asc
    limit v_limit
  ), deleted_rows as (
    delete from cron.job_run_details d
    using doomed
    where d.ctid = doomed.ctid
    returning 1
  )
  select count(*) into v_deleted from deleted_rows;

  return v_deleted;
end;
$$;


--
-- Name: prune_managed_scheduler_queue(interval, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_managed_scheduler_queue(retain interval DEFAULT '7 days'::interval, batch_limit integer DEFAULT 5000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(100, least(coalesce(batch_limit, 5000), 50000));
  v_deleted int := 0;
begin
  with doomed as (
    select ctid
    from public.managed_scheduler_queue
    where status in ('sent', 'failed')
      and coalesce(finished_at, created_at) < now() - retain
    order by coalesce(finished_at, created_at) asc
    limit v_limit
  ), deleted_rows as (
    delete from public.managed_scheduler_queue q
    using doomed
    where q.ctid = doomed.ctid
    returning 1
  )
  select count(*) into v_deleted from deleted_rows;

  return v_deleted;
end;
$$;


--
-- Name: prune_net_http_response(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_net_http_response(retain_hours_in integer DEFAULT NULL::integer, batch_limit_in integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  v_retain_hours int := 24;
  v_batch_limit int := 50000;
  v_deleted int := 0;
  v_sql text;
begin
  if to_regclass('net._http_response') is null then
    return 0;
  end if;

  if retain_hours_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(1, least((s.value::text)::int, 24 * 30))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(1, least((trim(both '"' from s.value::text))::int, 24 * 30))
        else null
      end
    into v_retain_hours
    from public.system_settings s
    where s.key = 'net_http_response_retention_hours';
  else
    v_retain_hours := greatest(1, least(retain_hours_in, 24 * 30));
  end if;

  if batch_limit_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(1000, least((s.value::text)::int, 500000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(1000, least((trim(both '"' from s.value::text))::int, 500000))
        else null
      end
    into v_batch_limit
    from public.system_settings s
    where s.key = 'net_http_response_prune_batch_limit';
  else
    v_batch_limit := greatest(1000, least(batch_limit_in, 500000));
  end if;

  v_retain_hours := coalesce(v_retain_hours, 24);
  v_batch_limit := coalesce(v_batch_limit, 50000);

  v_sql := format(
    $qry$
      with doomed as (
        select ctid
        from net._http_response
        where created < now() - make_interval(hours => %s)
        order by created asc
        limit %s
      ), deleted_rows as (
        delete from net._http_response r
        using doomed
        where r.ctid = doomed.ctid
        returning 1
      )
      select count(*)::int from deleted_rows
    $qry$,
    v_retain_hours,
    v_batch_limit
  );

  execute v_sql into v_deleted;
  return coalesce(v_deleted, 0);
end;
$_$;


--
-- Name: prune_ws45_live_weather_snapshots(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_ws45_live_weather_snapshots(retain_hours_in integer DEFAULT NULL::integer, batch_limit_in integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  v_retain_hours int := 72;
  v_batch_limit int := 5000;
  v_deleted int := 0;
begin
  if retain_hours_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(24, least((s.value::text)::int, 24 * 30))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(24, least((trim(both '"' from s.value::text))::int, 24 * 30))
        else null
      end
    into v_retain_hours
    from public.system_settings s
    where s.key = 'ws45_live_weather_retention_hours';
  else
    v_retain_hours := greatest(24, least(retain_hours_in, 24 * 30));
  end if;

  if batch_limit_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(100, least((s.value::text)::int, 50000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(100, least((trim(both '"' from s.value::text))::int, 50000))
        else null
      end
    into v_batch_limit
    from public.system_settings s
    where s.key = 'ws45_weather_retention_cleanup_batch_limit';
  else
    v_batch_limit := greatest(100, least(batch_limit_in, 50000));
  end if;

  with keep_row as (
    select id
    from public.ws45_live_weather_snapshots
    order by fetched_at desc, created_at desc
    limit 1
  ), doomed as (
    select ctid
    from public.ws45_live_weather_snapshots
    where fetched_at < now() - make_interval(hours => coalesce(v_retain_hours, 72))
      and id not in (select id from keep_row)
    order by fetched_at asc, created_at asc
    limit coalesce(v_batch_limit, 5000)
  ), deleted_rows as (
    delete from public.ws45_live_weather_snapshots t
    using doomed
    where t.ctid = doomed.ctid
    returning 1
  )
  select count(*)::int into v_deleted from deleted_rows;

  return coalesce(v_deleted, 0);
end;
$_$;


--
-- Name: prune_ws45_planning_forecasts(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prune_ws45_planning_forecasts(retain_days_in integer DEFAULT NULL::integer, batch_limit_in integer DEFAULT NULL::integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  v_retain_days int := 30;
  v_batch_limit int := 5000;
  v_deleted int := 0;
begin
  if retain_days_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(7, least((s.value::text)::int, 365))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(7, least((trim(both '"' from s.value::text))::int, 365))
        else null
      end
    into v_retain_days
    from public.system_settings s
    where s.key = 'ws45_planning_forecast_retention_days';
  else
    v_retain_days := greatest(7, least(retain_days_in, 365));
  end if;

  if batch_limit_in is null then
    select
      case
        when jsonb_typeof(s.value) = 'number' then greatest(100, least((s.value::text)::int, 50000))
        when jsonb_typeof(s.value) = 'string'
          and trim(both '"' from s.value::text) ~ '^-?\\d+$'
          then greatest(100, least((trim(both '"' from s.value::text))::int, 50000))
        else null
      end
    into v_batch_limit
    from public.system_settings s
    where s.key = 'ws45_weather_retention_cleanup_batch_limit';
  else
    v_batch_limit := greatest(100, least(batch_limit_in, 50000));
  end if;

  with keep_rows as (
    select distinct on (product_kind) id
    from public.ws45_planning_forecasts
    order by product_kind, fetched_at desc, updated_at desc, created_at desc
  ), doomed as (
    select ctid
    from public.ws45_planning_forecasts
    where fetched_at < now() - make_interval(days => coalesce(v_retain_days, 30))
      and id not in (select id from keep_rows)
    order by fetched_at asc, created_at asc
    limit coalesce(v_batch_limit, 5000)
  ), deleted_rows as (
    delete from public.ws45_planning_forecasts t
    using doomed
    where t.ctid = doomed.ctid
    returning 1
  )
  select count(*)::int into v_deleted from deleted_rows;

  return coalesce(v_deleted, 0);
end;
$_$;


--
-- Name: purge_orbit_elements_before(timestamp with time zone, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.purge_orbit_elements_before(cutoff_in timestamp with time zone, batch_size integer DEFAULT 50000) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  deleted_count int := 0;
begin
  with candidates as (
    select id
    from public.orbit_elements
    where epoch < cutoff_in
    order by epoch asc
    limit batch_size
  )
  delete from public.orbit_elements
  where id in (select id from candidates);

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;


--
-- Name: refresh_artemis_program_procurement_cache(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_artemis_program_procurement_cache(contract_ids_in uuid[] DEFAULT NULL::uuid[]) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  refreshed_count integer := 0;
begin
  if contract_ids_in is null or coalesce(array_length(contract_ids_in, 1), 0) = 0 then
    delete from public.artemis_program_procurement_cache;
  else
    delete from public.artemis_program_procurement_cache
    where contract_id = any(contract_ids_in);
  end if;

  with latest_action as (
    select distinct on (a.contract_id)
      a.contract_id,
      a.solicitation_id,
      a.mod_number,
      a.source_document_id,
      a.updated_at
    from public.artemis_contract_actions a
    where contract_ids_in is null
       or a.contract_id = any(contract_ids_in)
    order by
      a.contract_id,
      a.updated_at desc nulls last,
      a.action_date desc nulls last,
      a.mod_number desc nulls last
  ),
  action_rollup as (
    select
      a.contract_id,
      sum(coalesce(a.obligation_delta, 0)) as obligated_amount,
      max(a.action_date) as awarded_on,
      count(*)::integer as action_count,
      max(a.updated_at) as latest_action_updated_at
    from public.artemis_contract_actions a
    where contract_ids_in is null
       or a.contract_id = any(contract_ids_in)
    group by a.contract_id
  ),
  rows_to_upsert as (
    select
      c.id as contract_id,
      c.piid as usaspending_award_id,
      c.contract_key,
      coalesce(c.mission_key, 'program') as mission_key,
      c.awardee_name as recipient,
      c.description as award_title,
      ar.obligated_amount,
      ar.awarded_on,
      la.solicitation_id,
      ar.action_count,
      la.mod_number as latest_mod_number,
      coalesce(la.source_document_id, c.source_document_id) as source_document_id,
      greatest(
        coalesce(c.updated_at, 'epoch'::timestamptz),
        coalesce(ar.latest_action_updated_at, 'epoch'::timestamptz)
      ) as updated_at,
      jsonb_strip_nulls(
        jsonb_build_object(
          'contractKey', c.contract_key,
          'solicitationId', la.solicitation_id,
          'latestModNumber', la.mod_number,
          'actionCount', ar.action_count,
          'awardFamily', 'contracts',
          'sourceModel', 'normalized-contracts',
          'programScope', 'artemis'
        )
      ) as metadata
    from public.artemis_contracts c
    join action_rollup ar
      on ar.contract_id = c.id
    left join latest_action la
      on la.contract_id = c.id
    where contract_ids_in is null
       or c.id = any(contract_ids_in)
  )
  insert into public.artemis_program_procurement_cache (
    contract_id,
    usaspending_award_id,
    contract_key,
    mission_key,
    recipient,
    award_title,
    obligated_amount,
    awarded_on,
    solicitation_id,
    action_count,
    latest_mod_number,
    source_document_id,
    updated_at,
    metadata
  )
  select
    contract_id,
    usaspending_award_id,
    contract_key,
    mission_key,
    recipient,
    award_title,
    obligated_amount,
    awarded_on,
    solicitation_id,
    action_count,
    latest_mod_number,
    source_document_id,
    updated_at,
    metadata
  from rows_to_upsert
  on conflict (contract_id) do update
  set
    usaspending_award_id = excluded.usaspending_award_id,
    contract_key = excluded.contract_key,
    mission_key = excluded.mission_key,
    recipient = excluded.recipient,
    award_title = excluded.award_title,
    obligated_amount = excluded.obligated_amount,
    awarded_on = excluded.awarded_on,
    solicitation_id = excluded.solicitation_id,
    action_count = excluded.action_count,
    latest_mod_number = excluded.latest_mod_number,
    source_document_id = excluded.source_document_id,
    updated_at = excluded.updated_at,
    metadata = excluded.metadata;

  get diagnostics refreshed_count = row_count;
  return refreshed_count;
end;
$$;


--
-- Name: refresh_providers_public_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_providers_public_cache() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
begin
  return public.refresh_providers_public_cache_for_keys(null);
end;
$$;


--
-- Name: refresh_providers_public_cache_for_keys(text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_providers_public_cache_for_keys(provider_keys_in text[] DEFAULT NULL::text[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
  v_full_refresh boolean := provider_keys_in is null or coalesce(array_length(provider_keys_in, 1), 0) = 0;
begin
  with normalized_keys as (
    select distinct lower(btrim(k)) as provider_key
    from unnest(coalesce(provider_keys_in, array[]::text[])) as k
    where k is not null
      and btrim(k) <> ''
      and lower(btrim(k)) <> 'unknown'
  ),
  src as (
    select
      lower(btrim(c.provider)) as provider_key,
      btrim(c.provider) as provider_name,
      nullif(btrim(c.provider_type), '') as provider_type,
      nullif(btrim(c.provider_country_code), '') as provider_country_code,
      nullif(btrim(c.provider_description), '') as provider_description,
      nullif(btrim(c.provider_logo_url), '') as provider_logo_url,
      nullif(btrim(c.provider_image_url), '') as provider_image_url,
      c.cache_generated_at
    from public.launches_public_cache c
    where c.provider is not null
      and btrim(c.provider) <> ''
      and lower(btrim(c.provider)) <> 'unknown'
      and (
        v_full_refresh
        or lower(btrim(c.provider)) in (select provider_key from normalized_keys)
      )
  ),
  dedup as (
    select
      s.provider_key,
      (array_agg(s.provider_name order by s.cache_generated_at desc nulls last, s.provider_name desc))[1] as name,
      (array_agg(s.provider_type order by (s.provider_type is null), s.cache_generated_at desc nulls last))[1] as provider_type,
      (array_agg(s.provider_country_code order by (s.provider_country_code is null), s.cache_generated_at desc nulls last))[1] as provider_country_code,
      (array_agg(s.provider_description order by (s.provider_description is null), s.cache_generated_at desc nulls last))[1] as provider_description,
      (array_agg(s.provider_logo_url order by (s.provider_logo_url is null), s.cache_generated_at desc nulls last))[1] as provider_logo_url,
      (array_agg(s.provider_image_url order by (s.provider_image_url is null), s.cache_generated_at desc nulls last))[1] as provider_image_url
    from src s
    group by s.provider_key
  ),
  upserted as (
    insert into public.providers_public_cache (
      provider_key,
      name,
      provider_type,
      provider_country_code,
      provider_description,
      provider_logo_url,
      provider_image_url,
      updated_at
    )
    select
      d.provider_key,
      d.name,
      d.provider_type,
      d.provider_country_code,
      d.provider_description,
      d.provider_logo_url,
      d.provider_image_url,
      now()
    from dedup d
    on conflict (provider_key) do update
      set name = excluded.name,
          provider_type = excluded.provider_type,
          provider_country_code = excluded.provider_country_code,
          provider_description = excluded.provider_description,
          provider_logo_url = excluded.provider_logo_url,
          provider_image_url = excluded.provider_image_url,
          updated_at = excluded.updated_at
      where
        providers_public_cache.name is distinct from excluded.name
        or providers_public_cache.provider_type is distinct from excluded.provider_type
        or providers_public_cache.provider_country_code is distinct from excluded.provider_country_code
        or providers_public_cache.provider_description is distinct from excluded.provider_description
        or providers_public_cache.provider_logo_url is distinct from excluded.provider_logo_url
        or providers_public_cache.provider_image_url is distinct from excluded.provider_image_url
    returning (xmax = 0) as inserted
  ),
  deleted as (
    delete from public.providers_public_cache p
    where
      (
        v_full_refresh
        or p.provider_key in (select provider_key from normalized_keys)
      )
      and not exists (select 1 from dedup d where d.provider_key = p.provider_key)
    returning 1
  )
  select jsonb_build_object(
    'mode', case when v_full_refresh then 'full' else 'incremental' end,
    'targetedKeys', case when v_full_refresh then null else (select count(*) from normalized_keys) end,
    'input', (select count(*) from dedup),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'removed', (select count(*) from deleted)
  )
  into result;

  return coalesce(
    result,
    jsonb_build_object(
      'mode', case when v_full_refresh then 'full' else 'incremental' end,
      'targetedKeys', case when v_full_refresh then null else 0 end,
      'input', 0,
      'inserted', 0,
      'updated', 0,
      'removed', 0
    )
  );
end;
$$;


--
-- Name: refresh_search_documents_db_sources(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_search_documents_db_sources() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  launch_result jsonb;
  news_result jsonb;
  catalog_result jsonb;
begin
  select public.replace_search_documents_for_source(
    'launch',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'doc_id', 'launch:' || l.launch_id::text,
            'doc_type', 'launch',
            'url', public.search_build_launch_href(coalesce(nullif(l.slug, ''), l.name), l.launch_id),
            'title', l.name,
            'subtitle', concat_ws(' • ', nullif(l.provider, ''), nullif(l.vehicle, ''), nullif(coalesce(l.pad_name, l.pad_location_name, l.location_name), ''), case when l.net is not null then to_char(l.net at time zone 'UTC', 'Mon DD, YYYY HH24:MI "UTC"') else null end),
            'summary', coalesce(nullif(l.mission_description, ''), concat_ws(' • ', nullif(l.mission_name, ''), nullif(l.mission_type, ''), nullif(l.mission_orbit, ''))),
            'body_preview', trim(
              both ' ' from concat_ws(
                ' ',
                nullif(l.mission_description, ''),
                nullif(l.provider_description, ''),
                nullif(l.hold_reason, ''),
                nullif(l.fail_reason, ''),
                nullif(l.hashtag, ''),
                (
                  select string_agg(trim(coalesce(c.value->>'astronaut', c.value->>'name', c.value->>'role', '')), ' ')
                  from jsonb_array_elements(coalesce(l.crew, '[]'::jsonb)) as c(value)
                  where trim(coalesce(c.value->>'astronaut', c.value->>'name', c.value->>'role', '')) <> ''
                ),
                (
                  select string_agg(trim(coalesce(p.value->>'name', p.value->>'payload', p.value->>'payload_name', p.value->>'type', '')), ' ')
                  from jsonb_array_elements(coalesce(l.payloads, '[]'::jsonb)) as p(value)
                  where trim(coalesce(p.value->>'name', p.value->>'payload', p.value->>'payload_name', p.value->>'type', '')) <> ''
                )
              )
            ),
            'aliases', to_jsonb(array_remove(array[
              nullif(l.slug, ''),
              nullif(l.rocket_full_name, ''),
              nullif(l.rocket_family, ''),
              nullif(l.mission_name, ''),
              nullif(l.launch_designator, ''),
              nullif(l.hashtag, '')
            ], null)),
            'keywords', to_jsonb(array_remove(array[
              'launch',
              'launch detail',
              'countdown',
              nullif(l.provider, ''),
              nullif(l.vehicle, ''),
              nullif(l.rocket_full_name, ''),
              nullif(l.rocket_family, ''),
              nullif(l.mission_type, ''),
              nullif(l.mission_orbit, ''),
              nullif(l.pad_name, ''),
              nullif(l.pad_location_name, ''),
              nullif(l.pad_state, ''),
              nullif(l.status_name, ''),
              nullif(l.status_abbrev, '')
            ], null)),
            'badge', 'Launch',
            'image_url', coalesce(nullif(l.image_thumbnail_url, ''), nullif(l.rocket_image_url, '')),
            'published_at', l.net,
            'source_updated_at', l.cache_generated_at,
            'boost', case when l.featured then 56 else 44 end,
            'metadata', jsonb_build_object(
              'launchId', l.launch_id,
              'll2LaunchUuid', l.ll2_launch_uuid,
              'provider', l.provider,
              'vehicle', l.vehicle
            ),
            'content_hash', md5(
              concat_ws(
                '|',
                l.name,
                l.slug,
                l.provider,
                l.vehicle,
                l.net::text,
                l.status_name,
                l.status_abbrev,
                l.mission_name,
                l.mission_description,
                l.rocket_full_name,
                l.pad_name,
                l.pad_location_name,
                l.cache_generated_at::text
              )
            )
          )
          order by l.net asc nulls last, l.name asc
        )
        from public.launches_public_cache l
        where coalesce(l.hidden, false) is false
      ),
      '[]'::jsonb
    )
  )
    into launch_result;

  select public.replace_search_documents_for_source(
    'news',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'doc_id', 'news:' || n.snapi_uid,
            'doc_type', 'news',
            'url', n.url,
            'title', n.title,
            'subtitle', concat_ws(' • ', initcap(n.item_type), coalesce(nullif(n.news_site, ''), 'Spaceflight News')),
            'summary', nullif(n.summary, ''),
            'body_preview', nullif(n.summary, ''),
            'aliases', to_jsonb(array_remove(array[
              nullif(n.news_site, '')
            ], null)),
            'keywords', to_jsonb(array_remove(array[
              'news',
              'space news',
              nullif(n.item_type, ''),
              nullif(n.news_site, '')
            ], null)),
            'badge', 'News',
            'image_url', nullif(n.image_url, ''),
            'published_at', coalesce(n.published_at, n.updated_at, n.fetched_at),
            'source_updated_at', greatest(coalesce(n.updated_at, n.fetched_at), coalesce(n.published_at, n.fetched_at)),
            'boost', case when coalesce(n.featured, false) then 28 else 18 end,
            'metadata', jsonb_build_object(
              'snapiUid', n.snapi_uid,
              'itemType', n.item_type,
              'newsSite', n.news_site
            ),
            'content_hash', md5(
              concat_ws('|', n.title, n.url, n.news_site, n.summary, n.published_at::text, n.updated_at::text)
            )
          )
          order by coalesce(n.published_at, n.updated_at, n.fetched_at) desc nulls last, n.title asc
        )
        from public.snapi_items n
      ),
      '[]'::jsonb
    )
  )
    into news_result;

  select public.replace_search_documents_for_source(
    'catalog',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'doc_id', 'catalog:' || c.entity_type || ':' || c.entity_id,
            'doc_type', 'catalog',
            'url', '/catalog/' || c.entity_type || '/' || c.entity_id,
            'title', c.name,
            'subtitle', initcap(replace(c.entity_type, '_', ' ')),
            'summary', nullif(c.description, ''),
            'body_preview', trim(
              both ' ' from concat_ws(
                ' ',
                nullif(c.description, ''),
                nullif(c.slug, ''),
                (
                  select string_agg(code, ' ')
                  from unnest(coalesce(c.country_codes, '{}'::text[])) as code
                ),
                coalesce(c.data->>'abbrev', ''),
                coalesce(c.data->>'description', '')
              )
            ),
            'aliases', to_jsonb(array_remove(array[
              nullif(c.slug, ''),
              nullif(c.data->>'abbrev', '')
            ], null)),
            'keywords', to_jsonb(array_cat(array['catalog', c.entity_type], coalesce(c.country_codes, '{}'::text[]))),
            'badge', 'Catalog',
            'image_url', nullif(c.image_url, ''),
            'published_at', null,
            'source_updated_at', coalesce(c.updated_at, c.fetched_at),
            'boost', case
              when c.entity_type = 'agencies' then 26
              when c.entity_type = 'astronauts' then 24
              when c.entity_type = 'pads' then 23
              when c.entity_type = 'launcher_configurations' then 23
              else 20
            end,
            'metadata', jsonb_build_object(
              'entityType', c.entity_type,
              'entityId', c.entity_id
            ),
            'content_hash', md5(
              concat_ws('|', c.entity_type, c.entity_id, c.name, c.slug, c.description, c.updated_at::text, c.image_url)
            )
          )
          order by c.entity_type asc, c.name asc
        )
        from public.ll2_catalog_public_cache c
      ),
      '[]'::jsonb
    )
  )
    into catalog_result;

  return jsonb_build_object(
    'launch', launch_result,
    'news', news_result,
    'catalog', catalog_result
  );
end;
$$;


--
-- Name: release_job_lock(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.release_job_lock(lock_name_in text, locked_by_in text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  released boolean := false;
  affected_rows int := 0;
begin
  if lock_name_in is null or length(lock_name_in) = 0 then
    raise exception 'lock_name_required';
  end if;
  if locked_by_in is null or length(locked_by_in) = 0 then
    raise exception 'locked_by_required';
  end if;

  update public.job_locks
  set locked_until = now(),
      updated_at = now()
  where lock_name = lock_name_in
    and locked_by = locked_by_in;

  get diagnostics affected_rows = row_count;
  released := affected_rows > 0;
  return released;
end;
$$;


--
-- Name: replace_canonical_contracts_cache_v1(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_canonical_contracts_cache_v1(rows_in jsonb) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  refreshed_at timestamptz := now();
  inserted_count integer := 0;
begin
  delete from public.canonical_contracts_cache;

  if rows_in is null
     or jsonb_typeof(rows_in) <> 'array'
     or jsonb_array_length(rows_in) = 0 then
    return 0;
  end if;

  insert into public.canonical_contracts_cache (
    uid,
    scope,
    story_status,
    story_key,
    match_confidence,
    has_full_story,
    action_count,
    notice_count,
    spending_count,
    bidder_count,
    title,
    description,
    contract_key,
    piid,
    usaspending_award_id,
    mission_key,
    mission_label,
    agency,
    customer,
    recipient,
    amount,
    awarded_on,
    source_url,
    source_label,
    status,
    updated_at,
    canonical_path,
    program_path,
    keywords,
    search_text,
    sort_exact_rank,
    sort_date,
    cache_refreshed_at
  )
  select
    row.uid,
    row.scope,
    coalesce(row.story_status, 'pending'),
    row.story_key,
    row.match_confidence,
    coalesce(row.has_full_story, false),
    coalesce(row.action_count, 0),
    coalesce(row.notice_count, 0),
    coalesce(row.spending_count, 0),
    coalesce(row.bidder_count, 0),
    row.title,
    row.description,
    row.contract_key,
    row.piid,
    row.usaspending_award_id,
    row.mission_key,
    row.mission_label,
    row.agency,
    row.customer,
    row.recipient,
    row.amount,
    row.awarded_on,
    row.source_url,
    row.source_label,
    row.status,
    row.updated_at,
    row.canonical_path,
    row.program_path,
    coalesce(row.keywords, array[]::text[]),
    coalesce(row.search_text, ''),
    coalesce(row.sort_exact_rank, case when coalesce(row.story_status, 'pending') = 'exact' then 0 else 1 end),
    row.sort_date,
    refreshed_at
  from jsonb_to_recordset(rows_in) as row(
    uid text,
    scope text,
    story_status text,
    story_key text,
    match_confidence numeric,
    has_full_story boolean,
    action_count integer,
    notice_count integer,
    spending_count integer,
    bidder_count integer,
    title text,
    description text,
    contract_key text,
    piid text,
    usaspending_award_id text,
    mission_key text,
    mission_label text,
    agency text,
    customer text,
    recipient text,
    amount numeric,
    awarded_on date,
    source_url text,
    source_label text,
    status text,
    updated_at timestamptz,
    canonical_path text,
    program_path text,
    keywords text[],
    search_text text,
    sort_exact_rank smallint,
    sort_date timestamptz
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;


--
-- Name: replace_search_documents_for_source(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.replace_search_documents_for_source(source_type_in text, rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
declare
  safe_rows jsonb := case
    when rows_in is not null and jsonb_typeof(rows_in) = 'array' then rows_in
    else '[]'::jsonb
  end;
  normalized_source_type text := nullif(btrim(source_type_in), '');
  result jsonb;
begin
  if normalized_source_type is null then
    raise exception 'source_type_in is required';
  end if;

  with input as (
    select distinct on (doc_id)
      doc_id,
      normalized_source_type as source_type,
      doc_type,
      url,
      title,
      subtitle,
      summary,
      body_preview,
      aliases,
      keywords,
      badge,
      image_url,
      published_at,
      source_updated_at,
      boost,
      metadata,
      content_hash
    from (
      select
        nullif(btrim(r.doc_id), '') as doc_id,
        lower(nullif(btrim(r.doc_type), '')) as doc_type,
        nullif(btrim(r.url), '') as url,
        nullif(btrim(r.title), '') as title,
        nullif(btrim(r.subtitle), '') as subtitle,
        nullif(btrim(r.summary), '') as summary,
        nullif(btrim(r.body_preview), '') as body_preview,
        case
          when r.aliases is null then '{}'::text[]
          when jsonb_typeof(r.aliases) = 'array' then coalesce((
            select array_agg(value order by ordinality)
            from (
              select nullif(btrim(value), '') as value, ordinality
              from jsonb_array_elements_text(r.aliases) with ordinality as v(value, ordinality)
            ) cleaned
            where value is not null
          ), '{}'::text[])
          else '{}'::text[]
        end as aliases,
        case
          when r.keywords is null then '{}'::text[]
          when jsonb_typeof(r.keywords) = 'array' then coalesce((
            select array_agg(value order by ordinality)
            from (
              select nullif(btrim(value), '') as value, ordinality
              from jsonb_array_elements_text(r.keywords) with ordinality as v(value, ordinality)
            ) cleaned
            where value is not null
          ), '{}'::text[])
          else '{}'::text[]
        end as keywords,
        nullif(btrim(r.badge), '') as badge,
        nullif(btrim(r.image_url), '') as image_url,
        r.published_at,
        r.source_updated_at,
        coalesce(r.boost, 0) as boost,
        coalesce(r.metadata, '{}'::jsonb) as metadata,
        coalesce(nullif(btrim(r.content_hash), ''), md5(coalesce(r.title, '') || '|' || coalesce(r.url, ''))) as content_hash
      from jsonb_to_recordset(safe_rows) as r(
        doc_id text,
        doc_type text,
        url text,
        title text,
        subtitle text,
        summary text,
        body_preview text,
        aliases jsonb,
        keywords jsonb,
        badge text,
        image_url text,
        published_at timestamptz,
        source_updated_at timestamptz,
        boost double precision,
        metadata jsonb,
        content_hash text
      )
    ) prepared
    where doc_id is not null
      and doc_type in ('launch', 'hub', 'guide', 'news', 'contract', 'person', 'recovery', 'catalog', 'page')
      and url is not null
      and title is not null
  ),
  deleted as (
    delete from public.search_documents d
    where d.source_type = normalized_source_type
      and not exists (
        select 1
        from input i
        where i.doc_id = d.doc_id
      )
    returning 1
  ),
  upserted as (
    insert into public.search_documents (
      doc_id,
      source_type,
      doc_type,
      url,
      title,
      subtitle,
      summary,
      body_preview,
      aliases,
      keywords,
      badge,
      image_url,
      published_at,
      source_updated_at,
      boost,
      metadata,
      content_hash
    )
    select
      doc_id,
      source_type,
      doc_type,
      url,
      title,
      subtitle,
      summary,
      body_preview,
      aliases,
      keywords,
      badge,
      image_url,
      published_at,
      source_updated_at,
      boost,
      metadata,
      content_hash
    from input
    on conflict (doc_id) do update
      set source_type = excluded.source_type,
          doc_type = excluded.doc_type,
          url = excluded.url,
          title = excluded.title,
          subtitle = excluded.subtitle,
          summary = excluded.summary,
          body_preview = excluded.body_preview,
          aliases = excluded.aliases,
          keywords = excluded.keywords,
          badge = excluded.badge,
          image_url = excluded.image_url,
          published_at = excluded.published_at,
          source_updated_at = excluded.source_updated_at,
          boost = excluded.boost,
          metadata = excluded.metadata,
          content_hash = excluded.content_hash,
          updated_at = now()
      where search_documents.content_hash is distinct from excluded.content_hash
         or search_documents.source_type is distinct from excluded.source_type
         or search_documents.doc_type is distinct from excluded.doc_type
         or search_documents.url is distinct from excluded.url
         or search_documents.title is distinct from excluded.title
         or search_documents.subtitle is distinct from excluded.subtitle
         or search_documents.summary is distinct from excluded.summary
         or search_documents.body_preview is distinct from excluded.body_preview
         or search_documents.aliases is distinct from excluded.aliases
         or search_documents.keywords is distinct from excluded.keywords
         or search_documents.badge is distinct from excluded.badge
         or search_documents.image_url is distinct from excluded.image_url
         or search_documents.published_at is distinct from excluded.published_at
         or search_documents.source_updated_at is distinct from excluded.source_updated_at
         or search_documents.boost is distinct from excluded.boost
         or search_documents.metadata is distinct from excluded.metadata
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'source', normalized_source_type,
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'deleted', (select count(*) from deleted)
  )
    into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;


--
-- Name: schedule_faa_launch_match_followup(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.schedule_faa_launch_match_followup() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  cooldown_seconds int := 120;
  lock_id text := gen_random_uuid()::text;
begin
  select
    case
      when jsonb_typeof(value) = 'number' then greatest(15, least(3600, (value::text)::int))
      when jsonb_typeof(value) = 'string'
        and trim(both '"' from value::text) ~ '^\d+$'
        then greatest(15, least(3600, trim(both '"' from value::text)::int))
      else 120
    end
  into cooldown_seconds
  from public.system_settings
  where key = 'faa_launch_match_followup_cooldown_seconds';

  cooldown_seconds := coalesce(cooldown_seconds, 120);

  if public.try_acquire_job_lock('faa_launch_match_followup_trigger', cooldown_seconds, lock_id) then
    perform public.invoke_edge_job('faa-launch-match');
  end if;

  return new;
end;
$_$;


--
-- Name: search_build_launch_href(text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_build_launch_href(slug_source text, launch_id uuid) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select '/launches/' || case
    when public.search_slugify_text(slug_source, 64) <> '' then public.search_slugify_text(slug_source, 64) || '-' || launch_id::text
    else launch_id::text
  end;
$$;


--
-- Name: search_documents_update_generated_fields(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_documents_update_generated_fields() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.title_alias_text := left(
    public.search_normalize_text(
      concat_ws(
        ' ',
        new.title,
        new.subtitle,
        array_to_string(new.aliases, ' '),
        array_to_string(new.keywords, ' ')
      )
    ),
    512
  );

  new.search_vector := (
    setweight(to_tsvector('english', left(coalesce(new.title, ''), 256)), 'A') ||
    setweight(to_tsvector('english', left(coalesce(array_to_string(new.aliases, ' '), ''), 256)), 'A') ||
    setweight(to_tsvector('english', left(coalesce(new.subtitle, ''), 256)), 'B') ||
    setweight(to_tsvector('english', left(coalesce(new.summary, ''), 600)), 'B') ||
    setweight(to_tsvector('english', left(coalesce(array_to_string(new.keywords, ' '), ''), 400)), 'B') ||
    setweight(to_tsvector('english', left(coalesce(new.body_preview, ''), 1500)), 'C') ||
    setweight(to_tsvector('simple', left(coalesce(new.title, ''), 256)), 'A') ||
    setweight(to_tsvector('simple', left(coalesce(array_to_string(new.aliases, ' '), ''), 256)), 'A') ||
    setweight(to_tsvector('simple', left(coalesce(new.subtitle, ''), 256)), 'B') ||
    setweight(to_tsvector('simple', left(coalesce(array_to_string(new.keywords, ' '), ''), 400)), 'B')
  );

  return new;
end;
$$;


--
-- Name: search_extract_query_terms(text, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_extract_query_terms(query_text text, include_negated boolean DEFAULT false) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $_$
  select nullif(
    trim(
      both ' '
      from coalesce(
        (
          select string_agg(token, ' ' order by ordinality)
          from (
            select match_parts[1] as token, ordinality
            from regexp_matches(coalesce(query_text, ''), $search_terms$(-?"[^"]+"|-?[^[:space:]]+)$search_terms$, 'g')
              with ordinality as matches(match_parts, ordinality)
          ) tokens
          where case
            when include_negated then left(token, 1) = '-' and btrim(substr(token, 2)) <> ''
            else left(token, 1) <> '-'
          end
        ),
        ''
      )
    ),
    ''
  );
$_$;


--
-- Name: search_normalize_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_normalize_text(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select trim(both ' ' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;


--
-- Name: search_prefix_tsquery(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_prefix_tsquery(query_text text) RETURNS tsquery
    LANGUAGE plpgsql STABLE PARALLEL SAFE
    AS $$
declare
  normalized text;
  tsquery_text text;
begin
  normalized := public.search_normalize_text(query_text);
  if normalized = '' then
    return null;
  end if;

  select string_agg(token || ':*', ' & ' order by ordinality)
    into tsquery_text
  from regexp_split_to_table(normalized, '\s+') with ordinality as t(token, ordinality)
  where token <> '';

  if tsquery_text is null or tsquery_text = '' then
    return null;
  end if;

  return to_tsquery('simple', tsquery_text);
exception
  when others then
    return null;
end;
$$;


--
-- Name: search_public_documents(text, integer, integer, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_public_documents(q_in text, limit_n integer DEFAULT 8, offset_n integer DEFAULT 0, types_in text[] DEFAULT NULL::text[]) RETURNS TABLE(id text, type text, title text, subtitle text, summary text, url text, image_url text, published_at timestamp with time zone, badge text, score double precision)
    LANGUAGE sql STABLE
    AS $$
  with raw_params as (
    select
      greatest(1, least(coalesce(limit_n, 8), 50)) as limit_n,
      greatest(0, coalesce(offset_n, 0)) as offset_n,
      nullif(btrim(q_in), '') as raw_query,
      public.search_extract_query_terms(q_in, false) as positive_query,
      public.search_extract_query_terms(q_in, true) as negated_query,
      case
        when types_in is null or cardinality(types_in) = 0 then null::text[]
        else (
          select coalesce(array_agg(distinct lower(btrim(value))), '{}'::text[])
          from unnest(types_in) as value
          where lower(btrim(value)) in ('launch', 'hub', 'guide', 'news', 'contract', 'person', 'recovery', 'catalog', 'page')
        )
      end as types
  ),
  params as (
    select
      p.limit_n,
      p.offset_n,
      p.raw_query,
      p.positive_query,
      p.negated_query,
      public.search_normalize_text(p.positive_query) as query_text,
      public.search_websearch_to_tsquery(p.raw_query) as tsq,
      public.search_websearch_to_tsquery(p.negated_query) as negated_tsq,
      public.search_prefix_tsquery(p.positive_query) as prefix_tsq,
      p.types
    from raw_params p
  ),
  scoped as (
    select d.*, p.query_text, p.tsq, p.negated_tsq, p.prefix_tsq
    from public.search_documents d
    cross join params p
    where p.raw_query is not null
      and coalesce(p.positive_query, '') <> ''
      and p.query_text <> ''
      and (
        p.types is null
        or cardinality(p.types) = 0
        or d.doc_type = any (p.types)
      )
  ),
  fts_candidates as (
    select s.doc_id
    from scoped s
    where s.tsq is not null
      and s.tsq @@ s.search_vector
    order by ts_rank_cd(s.search_vector, s.tsq) desc nulls last, s.published_at desc nulls last
    limit (select greatest(40, (limit_n + offset_n) * 8) from params)
  ),
  prefix_candidates as (
    select s.doc_id
    from scoped s
    where s.prefix_tsq is not null
      and s.prefix_tsq @@ s.search_vector
    order by
      case when s.title_alias_text like s.query_text || '%' then 1 else 0 end desc,
      s.published_at desc nulls last
    limit (select greatest(40, (limit_n + offset_n) * 6) from params)
  ),
  trigram_candidates as (
    select s.doc_id
    from scoped s
    where length(s.query_text) >= 3
      and (
        extensions.similarity(s.title_alias_text, s.query_text) > 0.3
        or s.title_alias_text like '%' || s.query_text || '%'
      )
    order by extensions.similarity(s.title_alias_text, s.query_text) desc nulls last, s.published_at desc nulls last
    limit (select greatest(30, (limit_n + offset_n) * 5) from params)
  ),
  candidate_ids as (
    select doc_id from fts_candidates
    union
    select doc_id from prefix_candidates
    union
    select doc_id from trigram_candidates
  ),
  ranked as (
    select
      d.doc_id as id,
      d.doc_type as type,
      d.title,
      d.subtitle,
      d.summary,
      d.url,
      d.image_url,
      d.published_at,
      d.badge,
      (
        case when public.search_normalize_text(d.title) = p.query_text then 8 else 0 end +
        case when exists (
          select 1
          from unnest(d.aliases) as alias
          where public.search_normalize_text(alias) = p.query_text
        ) then 7 else 0 end +
        case when d.title_alias_text like p.query_text || '%' then 4 else 0 end +
        case when position(p.query_text in d.title_alias_text) > 0 then 1.5 else 0 end +
        case when p.tsq is not null then ts_rank_cd(d.search_vector, p.tsq) * 6 else 0 end +
        case when p.prefix_tsq is not null and p.prefix_tsq @@ d.search_vector then 1.5 else 0 end +
        case when length(p.query_text) >= 3 then greatest(extensions.similarity(d.title_alias_text, p.query_text), 0) * 3.5 else 0 end +
        least(greatest(d.boost, 0), 200) / 20.0 +
        case
          when d.published_at is null then 0
          else greatest(0, 45 - extract(epoch from (now() - d.published_at)) / 86400.0) / 30.0
        end
      ) as score
    from candidate_ids c
    join public.search_documents d on d.doc_id = c.doc_id
    cross join params p
    where p.negated_tsq is null
      or p.negated_tsq @@ d.search_vector
  )
  select
    r.id,
    r.type,
    r.title,
    r.subtitle,
    r.summary,
    r.url,
    r.image_url,
    r.published_at,
    r.badge,
    r.score
  from ranked r
  order by r.score desc, r.published_at desc nulls last, r.title asc
  limit (select limit_n from params)
  offset (select offset_n from params);
$$;


--
-- Name: search_slugify_text(text, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_slugify_text(value text, max_length integer DEFAULT 64) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    AS $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')), greatest(coalesce(max_length, 64), 1));
$$;


--
-- Name: search_websearch_to_tsquery(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.search_websearch_to_tsquery(query_text text) RETURNS tsquery
    LANGUAGE plpgsql STABLE PARALLEL SAFE
    AS $$
begin
  if query_text is null or btrim(query_text) = '' then
    return null;
  end if;

  return websearch_to_tsquery('english', query_text);
exception
  when others then
    return null;
end;
$$;


--
-- Name: sync_ops_metrics_collect_schedule(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_ops_metrics_collect_schedule() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'cron', 'pg_catalog'
    AS $_$
declare
  enabled boolean := false;
begin
  select
    case
      when jsonb_typeof(value) = 'boolean' then (value::boolean)
      when jsonb_typeof(value) = 'string' then lower(trim(both '"' from value::text)) = 'true'
      else false
    end
  into enabled
  from public.system_settings
  where key = 'ops_metrics_collection_enabled';

  if exists (select 1 from cron.job where jobname = 'ops_metrics_collect') then
    perform cron.unschedule('ops_metrics_collect');
  end if;

  if enabled then
    -- 5-minute cadence is sufficient for operational trend visibility while cutting scheduler churn.
    perform cron.schedule(
      'ops_metrics_collect',
      '*/5 * * * *',
      $job$select public.invoke_edge_job('ops-metrics-collect');$job$
    );
  end if;
end;
$_$;


--
-- Name: touch_launch_detail_refresh_state(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_launch_detail_refresh_state(p_launch_id uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  if p_launch_id is null then
    return;
  end if;

  perform public.touch_launch_refresh_state('detail:public:' || p_launch_id::text, 'detail_public', p_launch_id);
  perform public.touch_launch_refresh_state('detail:live:' || p_launch_id::text, 'detail_live', p_launch_id);
end;
$$;


--
-- Name: touch_launch_refresh_state(text, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_launch_refresh_state(p_cache_key text, p_scope text, p_launch_id uuid DEFAULT NULL::uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
begin
  insert into public.launch_refresh_state (
    cache_key,
    scope,
    launch_id,
    updated_at,
    revision
  )
  values (
    p_cache_key,
    p_scope,
    p_launch_id,
    now(),
    1
  )
  on conflict (cache_key)
  do update
  set
    scope = excluded.scope,
    launch_id = excluded.launch_id,
    updated_at = now(),
    revision = public.launch_refresh_state.revision + 1;
end;
$$;


--
-- Name: trg_sync_ops_metrics_collect_schedule(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sync_ops_metrics_collect_schedule() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.key = 'ops_metrics_collection_enabled' then
    perform public.sync_ops_metrics_collect_schedule();
  end if;
  return new;
end;
$$;


--
-- Name: try_acquire_job_lock(text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_acquire_job_lock(lock_name_in text, ttl_seconds_in integer, locked_by_in text) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
declare
  ttl_seconds int := ttl_seconds_in;
  acquired boolean := false;
  affected_rows int := 0;
begin
  if lock_name_in is null or length(lock_name_in) = 0 then
    raise exception 'lock_name_required';
  end if;
  if locked_by_in is null or length(locked_by_in) = 0 then
    raise exception 'locked_by_required';
  end if;

  ttl_seconds := greatest(1, least(coalesce(ttl_seconds, 60), 3600));

  insert into public.job_locks(lock_name, locked_until, locked_by, locked_at, updated_at)
  values (
    lock_name_in,
    now() + make_interval(secs => ttl_seconds),
    locked_by_in,
    now(),
    now()
  )
  on conflict (lock_name) do update
    set locked_until = excluded.locked_until,
        locked_by = excluded.locked_by,
        locked_at = excluded.locked_at,
        updated_at = excluded.updated_at
    where public.job_locks.locked_until < now();

  get diagnostics affected_rows = row_count;
  acquired := affected_rows > 0;
  return acquired;
end;
$$;


--
-- Name: try_increment_api_rate(text, timestamp with time zone, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_increment_api_rate(provider_name text, window_start_in timestamp with time zone, window_seconds_in integer, limit_in integer) RETURNS boolean
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
declare
  new_count int;
begin
  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (provider_name, window_start_in, window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1,
        window_seconds = excluded.window_seconds
  where public.api_rate_counters.count < limit_in
  returning count into new_count;

  if new_count is null then
    return false;
  end if;

  return new_count <= limit_in;
end;
$$;


--
-- Name: try_increment_map_budget(text, timestamp with time zone, integer, integer, timestamp with time zone, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.try_increment_map_budget(provider_base text, day_window_start_in timestamp with time zone, day_window_seconds_in integer, day_limit_in integer, month_window_start_in timestamp with time zone, month_window_seconds_in integer, month_limit_in integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  day_provider text := trim(provider_base) || ':day';
  month_provider text := trim(provider_base) || ':month';
begin
  if trim(provider_base) = '' then
    return false;
  end if;

  if day_provider <= month_provider then
    perform pg_advisory_xact_lock(hashtext(day_provider));
    perform pg_advisory_xact_lock(hashtext(month_provider));
  else
    perform pg_advisory_xact_lock(hashtext(month_provider));
    perform pg_advisory_xact_lock(hashtext(day_provider));
  end if;

  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (day_provider, day_window_start_in, day_window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1,
        window_seconds = excluded.window_seconds
  where public.api_rate_counters.count < day_limit_in;

  if not found then
    return false;
  end if;

  insert into public.api_rate_counters(provider, window_start, window_seconds, count)
  values (month_provider, month_window_start_in, month_window_seconds_in, 1)
  on conflict (provider, window_start) do update
    set count = public.api_rate_counters.count + 1,
        window_seconds = excluded.window_seconds
  where public.api_rate_counters.count < month_limit_in;

  if found then
    return true;
  end if;

  update public.api_rate_counters
  set count = greatest(public.api_rate_counters.count - 1, 0)
  where provider = day_provider
    and window_start = day_window_start_in;

  return false;
end;
$$;


--
-- Name: unsubscribe_marketing_emails(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.unsubscribe_marketing_emails(token_in uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: upsert_faa_launch_matches_auto_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_faa_launch_matches_auto_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'dedupDeleted', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.launch_id,
      r.faa_tfr_record_id,
      r.faa_tfr_shape_id,
      coalesce(nullif(btrim(r.match_status), ''), 'unmatched') as match_status,
      r.match_confidence,
      r.match_score,
      r.match_strategy,
      coalesce(r.match_meta, '{}'::jsonb) as match_meta,
      coalesce(r.matched_at, now()) as matched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      launch_id uuid,
      faa_tfr_record_id uuid,
      faa_tfr_shape_id uuid,
      match_status text,
      match_confidence int,
      match_score double precision,
      match_strategy text,
      match_meta jsonb,
      matched_at timestamptz,
      updated_at timestamptz
    )
    where r.faa_tfr_record_id is not null
  ),
  input as (
    select distinct on (i.faa_tfr_record_id)
      i.launch_id,
      i.faa_tfr_record_id,
      i.faa_tfr_shape_id,
      case
        when i.match_status in ('matched', 'ambiguous', 'unmatched', 'manual') then i.match_status
        else 'unmatched'
      end as match_status,
      i.match_confidence,
      i.match_score,
      i.match_strategy,
      i.match_meta,
      i.matched_at,
      i.updated_at
    from input_raw i
    order by i.faa_tfr_record_id, i.matched_at desc nulls last, i.updated_at desc nulls last
  ),
  existing_ranked as (
    select
      m.id,
      m.faa_tfr_record_id,
      row_number() over (partition by m.faa_tfr_record_id order by m.updated_at desc nulls last, m.id desc) as rn
    from public.faa_launch_matches m
    join input i
      on i.faa_tfr_record_id = m.faa_tfr_record_id
    where m.match_origin = 'auto'
  ),
  primary_existing as (
    select e.id, e.faa_tfr_record_id
    from existing_ranked e
    where e.rn = 1
  ),
  updated as (
    update public.faa_launch_matches m
    set launch_id = i.launch_id,
        faa_tfr_shape_id = i.faa_tfr_shape_id,
        match_status = i.match_status,
        match_confidence = i.match_confidence,
        match_score = i.match_score,
        match_strategy = i.match_strategy,
        match_meta = i.match_meta,
        matched_at = i.matched_at,
        updated_at = i.updated_at
    from input i
    join primary_existing p
      on p.faa_tfr_record_id = i.faa_tfr_record_id
    where m.id = p.id
      and (
        m.launch_id is distinct from i.launch_id
        or m.faa_tfr_shape_id is distinct from i.faa_tfr_shape_id
        or m.match_status is distinct from i.match_status
        or m.match_confidence is distinct from i.match_confidence
        or m.match_score is distinct from i.match_score
        or m.match_strategy is distinct from i.match_strategy
        or m.match_meta is distinct from i.match_meta
      )
    returning m.faa_tfr_record_id
  ),
  inserted as (
    insert into public.faa_launch_matches (
      launch_id,
      faa_tfr_record_id,
      faa_tfr_shape_id,
      match_status,
      match_confidence,
      match_score,
      match_strategy,
      match_meta,
      match_origin,
      matched_at,
      updated_at
    )
    select
      i.launch_id,
      i.faa_tfr_record_id,
      i.faa_tfr_shape_id,
      i.match_status,
      i.match_confidence,
      i.match_score,
      i.match_strategy,
      i.match_meta,
      'auto',
      i.matched_at,
      i.updated_at
    from input i
    where not exists (
      select 1
      from primary_existing p
      where p.faa_tfr_record_id = i.faa_tfr_record_id
    )
    returning faa_tfr_record_id
  ),
  dedup_deleted as (
    delete from public.faa_launch_matches m
    using existing_ranked e
    where m.id = e.id
      and e.rn > 1
    returning 1
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from inserted),
    'updated', (select count(*) from updated),
    'dedupDeleted', (select count(*) from dedup_deleted),
    'skipped', (select count(*) from input) - (select count(*) from inserted) - (select count(*) from updated)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'dedupDeleted', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_faa_tfr_records_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_faa_tfr_records_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      coalesce(nullif(btrim(r.source), ''), 'faa_tfr') as source,
      nullif(btrim(r.source_key), '') as source_key,
      nullif(btrim(r.notam_id), '') as notam_id,
      nullif(btrim(r.notam_key), '') as notam_key,
      nullif(btrim(r.gid), '') as gid,
      nullif(btrim(r.facility), '') as facility,
      nullif(btrim(r.state), '') as state,
      nullif(btrim(r.type), '') as type,
      nullif(btrim(r.legal), '') as legal,
      nullif(btrim(r.title), '') as title,
      nullif(btrim(r.description), '') as description,
      r.is_new,
      nullif(btrim(r.mod_date), '') as mod_date,
      nullif(btrim(r.mod_abs_time), '') as mod_abs_time,
      r.mod_at,
      r.valid_start,
      r.valid_end,
      coalesce(r.has_shape, false) as has_shape,
      case
        when r.status in ('active', 'expired', 'manual') then r.status
        else 'active'
      end as status,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      source text,
      source_key text,
      notam_id text,
      notam_key text,
      gid text,
      facility text,
      state text,
      type text,
      legal text,
      title text,
      description text,
      is_new boolean,
      mod_date text,
      mod_abs_time text,
      mod_at timestamptz,
      valid_start timestamptz,
      valid_end timestamptz,
      has_shape boolean,
      status text,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
  ),
  input as (
    select distinct on (i.source, i.source_key)
      i.source,
      i.source_key,
      i.notam_id,
      i.notam_key,
      i.gid,
      i.facility,
      i.state,
      i.type,
      i.legal,
      i.title,
      i.description,
      i.is_new,
      i.mod_date,
      i.mod_abs_time,
      i.mod_at,
      i.valid_start,
      i.valid_end,
      i.has_shape,
      i.status,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source_key is not null
    order by i.source, i.source_key, i.updated_at desc, i.fetched_at desc
  ),
  upserted as (
    insert into public.faa_tfr_records (
      source,
      source_key,
      notam_id,
      notam_key,
      gid,
      facility,
      state,
      type,
      legal,
      title,
      description,
      is_new,
      mod_date,
      mod_abs_time,
      mod_at,
      valid_start,
      valid_end,
      has_shape,
      status,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.source,
      i.source_key,
      i.notam_id,
      i.notam_key,
      i.gid,
      i.facility,
      i.state,
      i.type,
      i.legal,
      i.title,
      i.description,
      i.is_new,
      i.mod_date,
      i.mod_abs_time,
      i.mod_at,
      i.valid_start,
      i.valid_end,
      i.has_shape,
      i.status,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (source, source_key) do update
      set notam_id = excluded.notam_id,
          notam_key = excluded.notam_key,
          gid = excluded.gid,
          facility = excluded.facility,
          state = excluded.state,
          type = excluded.type,
          legal = excluded.legal,
          title = excluded.title,
          description = excluded.description,
          is_new = excluded.is_new,
          mod_date = excluded.mod_date,
          mod_abs_time = excluded.mod_abs_time,
          mod_at = excluded.mod_at,
          valid_start = excluded.valid_start,
          valid_end = excluded.valid_end,
          has_shape = excluded.has_shape,
          status = excluded.status,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where faa_tfr_records.notam_id is distinct from excluded.notam_id
        or faa_tfr_records.notam_key is distinct from excluded.notam_key
        or faa_tfr_records.gid is distinct from excluded.gid
        or faa_tfr_records.facility is distinct from excluded.facility
        or faa_tfr_records.state is distinct from excluded.state
        or faa_tfr_records.type is distinct from excluded.type
        or faa_tfr_records.legal is distinct from excluded.legal
        or faa_tfr_records.title is distinct from excluded.title
        or faa_tfr_records.description is distinct from excluded.description
        or faa_tfr_records.is_new is distinct from excluded.is_new
        or faa_tfr_records.mod_date is distinct from excluded.mod_date
        or faa_tfr_records.mod_abs_time is distinct from excluded.mod_abs_time
        or faa_tfr_records.mod_at is distinct from excluded.mod_at
        or faa_tfr_records.valid_start is distinct from excluded.valid_start
        or faa_tfr_records.valid_end is distinct from excluded.valid_end
        or faa_tfr_records.has_shape is distinct from excluded.has_shape
        or faa_tfr_records.status is distinct from excluded.status
        or faa_tfr_records.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_faa_tfr_shapes_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_faa_tfr_shapes_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.faa_tfr_record_id,
      nullif(btrim(r.source_shape_id), '') as source_shape_id,
      r.geometry,
      r.bbox_min_lat,
      r.bbox_min_lon,
      r.bbox_max_lat,
      r.bbox_max_lon,
      r.point_count,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      faa_tfr_record_id uuid,
      source_shape_id text,
      geometry jsonb,
      bbox_min_lat double precision,
      bbox_min_lon double precision,
      bbox_max_lat double precision,
      bbox_max_lon double precision,
      point_count int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.faa_tfr_record_id is not null
  ),
  input as (
    select distinct on (i.faa_tfr_record_id, i.source_shape_id)
      i.faa_tfr_record_id,
      i.source_shape_id,
      i.geometry,
      i.bbox_min_lat,
      i.bbox_min_lon,
      i.bbox_max_lat,
      i.bbox_max_lon,
      i.point_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source_shape_id is not null
    order by i.faa_tfr_record_id, i.source_shape_id, i.updated_at desc, i.fetched_at desc
  ),
  upserted as (
    insert into public.faa_tfr_shapes (
      faa_tfr_record_id,
      source_shape_id,
      geometry,
      bbox_min_lat,
      bbox_min_lon,
      bbox_max_lat,
      bbox_max_lon,
      point_count,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.faa_tfr_record_id,
      i.source_shape_id,
      i.geometry,
      i.bbox_min_lat,
      i.bbox_min_lon,
      i.bbox_max_lat,
      i.bbox_max_lon,
      i.point_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (faa_tfr_record_id, source_shape_id) do update
      set geometry = excluded.geometry,
          bbox_min_lat = excluded.bbox_min_lat,
          bbox_min_lon = excluded.bbox_min_lon,
          bbox_max_lat = excluded.bbox_max_lat,
          bbox_max_lon = excluded.bbox_max_lon,
          point_count = excluded.point_count,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where faa_tfr_shapes.geometry is distinct from excluded.geometry
        or faa_tfr_shapes.bbox_min_lat is distinct from excluded.bbox_min_lat
        or faa_tfr_shapes.bbox_min_lon is distinct from excluded.bbox_min_lon
        or faa_tfr_shapes.bbox_max_lat is distinct from excluded.bbox_max_lat
        or faa_tfr_shapes.bbox_max_lon is distinct from excluded.bbox_max_lon
        or faa_tfr_shapes.point_count is distinct from excluded.point_count
        or faa_tfr_shapes.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_launch_external_resources_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_launch_external_resources_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.launch_id,
      nullif(btrim(r.source), '') as source,
      nullif(btrim(r.content_type), '') as content_type,
      nullif(btrim(r.source_id), '') as source_id,
      r.confidence,
      nullif(btrim(r.source_hash), '') as source_hash,
      coalesce(r.data, '{}'::jsonb) as data,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      launch_id uuid,
      source text,
      content_type text,
      source_id text,
      confidence double precision,
      source_hash text,
      data jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.launch_id is not null
  ),
  input as (
    select distinct on (i.launch_id, i.source, i.content_type, i.source_id)
      i.launch_id,
      i.source,
      i.content_type,
      i.source_id,
      i.confidence,
      i.source_hash,
      i.data,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source is not null
      and i.content_type is not null
      and i.source_id is not null
    order by i.launch_id, i.source, i.content_type, i.source_id, i.fetched_at desc, i.updated_at desc
  ),
  upserted as (
    insert into public.launch_external_resources (
      launch_id,
      source,
      content_type,
      source_id,
      confidence,
      source_hash,
      data,
      fetched_at,
      updated_at
    )
    select
      i.launch_id,
      i.source,
      i.content_type,
      i.source_id,
      i.confidence,
      i.source_hash,
      i.data,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (launch_id, source, content_type, source_id) do update
      set confidence = excluded.confidence,
          source_hash = excluded.source_hash,
          data = excluded.data,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where launch_external_resources.confidence is distinct from excluded.confidence
        or launch_external_resources.source_hash is distinct from excluded.source_hash
        or launch_external_resources.data is distinct from excluded.data
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_launch_trajectory_constraints_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_launch_trajectory_constraints_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input_raw as (
    select
      r.launch_id,
      nullif(btrim(r.source), '') as source,
      nullif(btrim(r.source_id), '') as source_id,
      nullif(btrim(r.constraint_type), '') as constraint_type,
      coalesce(r.data, '{}'::jsonb) as data,
      r.geometry,
      r.confidence,
      r.ingestion_run_id,
      nullif(btrim(r.source_hash), '') as source_hash,
      coalesce(r.extracted_field_map, '{}'::jsonb) as extracted_field_map,
      nullif(btrim(r.parse_rule_id), '') as parse_rule_id,
      nullif(btrim(r.parser_version), '') as parser_version,
      nullif(btrim(r.license_class), '') as license_class,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      launch_id uuid,
      source text,
      source_id text,
      constraint_type text,
      data jsonb,
      geometry jsonb,
      confidence double precision,
      ingestion_run_id bigint,
      source_hash text,
      extracted_field_map jsonb,
      parse_rule_id text,
      parser_version text,
      license_class text,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.launch_id is not null
  ),
  input as (
    select distinct on (i.launch_id, i.source, i.constraint_type, i.source_id)
      i.launch_id,
      i.source,
      i.source_id,
      i.constraint_type,
      i.data,
      i.geometry,
      i.confidence,
      i.ingestion_run_id,
      i.source_hash,
      i.extracted_field_map,
      i.parse_rule_id,
      i.parser_version,
      i.license_class,
      i.fetched_at,
      i.updated_at
    from input_raw i
    where i.source is not null
      and i.constraint_type is not null
      and i.source_id is not null
    order by i.launch_id, i.source, i.constraint_type, i.source_id, i.fetched_at desc, i.updated_at desc
  ),
  upserted as (
    insert into public.launch_trajectory_constraints (
      launch_id,
      source,
      source_id,
      constraint_type,
      data,
      geometry,
      confidence,
      ingestion_run_id,
      source_hash,
      extracted_field_map,
      parse_rule_id,
      parser_version,
      license_class,
      fetched_at,
      updated_at
    )
    select
      i.launch_id,
      i.source,
      i.source_id,
      i.constraint_type,
      i.data,
      i.geometry,
      i.confidence,
      i.ingestion_run_id,
      i.source_hash,
      i.extracted_field_map,
      i.parse_rule_id,
      i.parser_version,
      i.license_class,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (launch_id, source, constraint_type, source_id) do update
      set data = excluded.data,
          geometry = excluded.geometry,
          confidence = excluded.confidence,
          ingestion_run_id = excluded.ingestion_run_id,
          source_hash = excluded.source_hash,
          extracted_field_map = excluded.extracted_field_map,
          parse_rule_id = excluded.parse_rule_id,
          parser_version = excluded.parser_version,
          license_class = excluded.license_class,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where launch_trajectory_constraints.data is distinct from excluded.data
        or launch_trajectory_constraints.geometry is distinct from excluded.geometry
        or launch_trajectory_constraints.confidence is distinct from excluded.confidence
        or launch_trajectory_constraints.source_hash is distinct from excluded.source_hash
        or launch_trajectory_constraints.extracted_field_map is distinct from excluded.extracted_field_map
        or launch_trajectory_constraints.parse_rule_id is distinct from excluded.parse_rule_id
        or launch_trajectory_constraints.parser_version is distinct from excluded.parser_version
        or launch_trajectory_constraints.license_class is distinct from excluded.license_class
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_ll2_astronauts_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ll2_astronauts_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_astronaut_id,
      r.name,
      r.status,
      r.type,
      r.agency_id,
      r.agency_name,
      r.nationality,
      r.in_space,
      r.time_in_space,
      r.eva_time,
      r.age,
      r.date_of_birth,
      r.date_of_death,
      r.bio,
      r.profile_image,
      r.profile_image_thumbnail,
      r.twitter,
      r.instagram,
      r.wiki,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_astronaut_id int,
      name text,
      status text,
      type text,
      agency_id int,
      agency_name text,
      nationality text,
      in_space boolean,
      time_in_space text,
      eva_time text,
      age int,
      date_of_birth date,
      date_of_death date,
      bio text,
      profile_image text,
      profile_image_thumbnail text,
      twitter text,
      instagram text,
      wiki text,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_astronaut_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_astronauts (
      ll2_astronaut_id,
      name,
      status,
      type,
      agency_id,
      agency_name,
      nationality,
      in_space,
      time_in_space,
      eva_time,
      age,
      date_of_birth,
      date_of_death,
      bio,
      profile_image,
      profile_image_thumbnail,
      twitter,
      instagram,
      wiki,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_astronaut_id,
      i.name,
      i.status,
      i.type,
      i.agency_id,
      i.agency_name,
      i.nationality,
      i.in_space,
      i.time_in_space,
      i.eva_time,
      i.age,
      i.date_of_birth,
      i.date_of_death,
      i.bio,
      i.profile_image,
      i.profile_image_thumbnail,
      i.twitter,
      i.instagram,
      i.wiki,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_astronaut_id) do update
      set name = excluded.name,
          status = excluded.status,
          type = excluded.type,
          agency_id = excluded.agency_id,
          agency_name = excluded.agency_name,
          nationality = excluded.nationality,
          in_space = excluded.in_space,
          time_in_space = excluded.time_in_space,
          eva_time = excluded.eva_time,
          age = excluded.age,
          date_of_birth = excluded.date_of_birth,
          date_of_death = excluded.date_of_death,
          bio = excluded.bio,
          profile_image = excluded.profile_image,
          profile_image_thumbnail = excluded.profile_image_thumbnail,
          twitter = excluded.twitter,
          instagram = excluded.instagram,
          wiki = excluded.wiki,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_astronauts.name is distinct from excluded.name
        or ll2_astronauts.status is distinct from excluded.status
        or ll2_astronauts.type is distinct from excluded.type
        or ll2_astronauts.agency_id is distinct from excluded.agency_id
        or ll2_astronauts.agency_name is distinct from excluded.agency_name
        or ll2_astronauts.nationality is distinct from excluded.nationality
        or ll2_astronauts.in_space is distinct from excluded.in_space
        or ll2_astronauts.time_in_space is distinct from excluded.time_in_space
        or ll2_astronauts.eva_time is distinct from excluded.eva_time
        or ll2_astronauts.age is distinct from excluded.age
        or ll2_astronauts.date_of_birth is distinct from excluded.date_of_birth
        or ll2_astronauts.date_of_death is distinct from excluded.date_of_death
        or ll2_astronauts.bio is distinct from excluded.bio
        or ll2_astronauts.profile_image is distinct from excluded.profile_image
        or ll2_astronauts.profile_image_thumbnail is distinct from excluded.profile_image_thumbnail
        or ll2_astronauts.twitter is distinct from excluded.twitter
        or ll2_astronauts.instagram is distinct from excluded.instagram
        or ll2_astronauts.wiki is distinct from excluded.wiki
        or ll2_astronauts.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_ll2_catalog_public_cache_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ll2_catalog_public_cache_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      nullif(btrim(r.entity_type), '') as entity_type,
      nullif(btrim(r.entity_id), '') as entity_id,
      nullif(btrim(r.name), '') as name,
      nullif(btrim(r.slug), '') as slug,
      nullif(btrim(r.description), '') as description,
      case
        when r.country_codes is null then null
        when jsonb_typeof(r.country_codes) = 'array' then (
          select array_agg(value)
          from jsonb_array_elements_text(r.country_codes) as value
        )
        else null
      end as country_codes,
      nullif(btrim(r.image_url), '') as image_url,
      r.data as data,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      entity_type text,
      entity_id text,
      name text,
      slug text,
      description text,
      country_codes jsonb,
      image_url text,
      data jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.entity_type is not null
      and btrim(r.entity_type) <> ''
      and r.entity_id is not null
      and btrim(r.entity_id) <> ''
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_catalog_public_cache (
      entity_type,
      entity_id,
      name,
      slug,
      description,
      country_codes,
      image_url,
      data,
      fetched_at,
      updated_at
    )
    select
      entity_type,
      entity_id,
      name,
      slug,
      description,
      country_codes,
      image_url,
      data,
      fetched_at,
      updated_at
    from input
    on conflict (entity_type, entity_id) do update
      set name = excluded.name,
          slug = excluded.slug,
          description = excluded.description,
          country_codes = excluded.country_codes,
          image_url = excluded.image_url,
          data = excluded.data,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where ll2_catalog_public_cache.name is distinct from excluded.name
         or ll2_catalog_public_cache.slug is distinct from excluded.slug
         or ll2_catalog_public_cache.description is distinct from excluded.description
         or ll2_catalog_public_cache.country_codes is distinct from excluded.country_codes
         or ll2_catalog_public_cache.image_url is distinct from excluded.image_url
         or ll2_catalog_public_cache.data is distinct from excluded.data
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;


--
-- Name: upsert_ll2_launchers_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ll2_launchers_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_launcher_id,
      r.serial_number,
      r.flight_proven,
      r.status,
      r.details,
      r.image_url,
      r.launcher_config_id,
      r.flights,
      r.first_launch_date,
      r.last_launch_date,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_launcher_id int,
      serial_number text,
      flight_proven boolean,
      status text,
      details text,
      image_url text,
      launcher_config_id int,
      flights jsonb,
      first_launch_date date,
      last_launch_date date,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_launcher_id is not null
  ),
  upserted as (
    insert into public.ll2_launchers (
      ll2_launcher_id,
      serial_number,
      flight_proven,
      status,
      details,
      image_url,
      launcher_config_id,
      flights,
      first_launch_date,
      last_launch_date,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_launcher_id,
      i.serial_number,
      i.flight_proven,
      i.status,
      i.details,
      i.image_url,
      i.launcher_config_id,
      i.flights,
      i.first_launch_date,
      i.last_launch_date,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_launcher_id) do update
      set serial_number = excluded.serial_number,
          flight_proven = excluded.flight_proven,
          status = excluded.status,
          details = excluded.details,
          image_url = excluded.image_url,
          launcher_config_id = excluded.launcher_config_id,
          flights = excluded.flights,
          first_launch_date = excluded.first_launch_date,
          last_launch_date = excluded.last_launch_date,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_launchers.serial_number is distinct from excluded.serial_number
        or ll2_launchers.flight_proven is distinct from excluded.flight_proven
        or ll2_launchers.status is distinct from excluded.status
        or ll2_launchers.details is distinct from excluded.details
        or ll2_launchers.image_url is distinct from excluded.image_url
        or ll2_launchers.launcher_config_id is distinct from excluded.launcher_config_id
        or ll2_launchers.flights is distinct from excluded.flights
        or ll2_launchers.first_launch_date is distinct from excluded.first_launch_date
        or ll2_launchers.last_launch_date is distinct from excluded.last_launch_date
        or ll2_launchers.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_ll2_locations_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ll2_locations_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_location_id,
      r.name,
      r.country_code,
      r.timezone_name,
      r.latitude,
      r.longitude,
      r.description,
      r.map_image,
      r.total_launch_count,
      r.total_landing_count,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_location_id int,
      name text,
      country_code text,
      timezone_name text,
      latitude double precision,
      longitude double precision,
      description text,
      map_image text,
      total_launch_count int,
      total_landing_count int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_location_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_locations (
      ll2_location_id,
      name,
      country_code,
      timezone_name,
      latitude,
      longitude,
      description,
      map_image,
      total_launch_count,
      total_landing_count,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_location_id,
      i.name,
      i.country_code,
      i.timezone_name,
      i.latitude,
      i.longitude,
      i.description,
      i.map_image,
      i.total_launch_count,
      i.total_landing_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_location_id) do update
      set name = excluded.name,
          country_code = excluded.country_code,
          timezone_name = excluded.timezone_name,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          description = excluded.description,
          map_image = excluded.map_image,
          total_launch_count = excluded.total_launch_count,
          total_landing_count = excluded.total_landing_count,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_locations.name is distinct from excluded.name
        or ll2_locations.country_code is distinct from excluded.country_code
        or ll2_locations.timezone_name is distinct from excluded.timezone_name
        or ll2_locations.latitude is distinct from excluded.latitude
        or ll2_locations.longitude is distinct from excluded.longitude
        or ll2_locations.description is distinct from excluded.description
        or ll2_locations.map_image is distinct from excluded.map_image
        or ll2_locations.total_launch_count is distinct from excluded.total_launch_count
        or ll2_locations.total_landing_count is distinct from excluded.total_landing_count
        or ll2_locations.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_ll2_pads_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ll2_pads_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_pad_id,
      r.ll2_location_id,
      r.name,
      r.latitude,
      r.longitude,
      r.state_code,
      r.agency_id,
      r.description,
      r.info_url,
      r.wiki_url,
      r.map_url,
      r.map_image,
      r.country_code,
      r.total_launch_count,
      r.orbital_launch_attempt_count,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_pad_id int,
      ll2_location_id int,
      name text,
      latitude double precision,
      longitude double precision,
      state_code text,
      agency_id text,
      description text,
      info_url text,
      wiki_url text,
      map_url text,
      map_image text,
      country_code text,
      total_launch_count int,
      orbital_launch_attempt_count int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_pad_id is not null
      and r.ll2_location_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_pads (
      ll2_pad_id,
      ll2_location_id,
      name,
      latitude,
      longitude,
      state_code,
      agency_id,
      description,
      info_url,
      wiki_url,
      map_url,
      map_image,
      country_code,
      total_launch_count,
      orbital_launch_attempt_count,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_pad_id,
      i.ll2_location_id,
      i.name,
      i.latitude,
      i.longitude,
      i.state_code,
      i.agency_id,
      i.description,
      i.info_url,
      i.wiki_url,
      i.map_url,
      i.map_image,
      i.country_code,
      i.total_launch_count,
      i.orbital_launch_attempt_count,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_pad_id) do update
      set ll2_location_id = excluded.ll2_location_id,
          name = excluded.name,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          state_code = excluded.state_code,
          agency_id = excluded.agency_id,
          description = excluded.description,
          info_url = excluded.info_url,
          wiki_url = excluded.wiki_url,
          map_url = excluded.map_url,
          map_image = excluded.map_image,
          country_code = excluded.country_code,
          total_launch_count = excluded.total_launch_count,
          orbital_launch_attempt_count = excluded.orbital_launch_attempt_count,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_pads.ll2_location_id is distinct from excluded.ll2_location_id
        or ll2_pads.name is distinct from excluded.name
        or ll2_pads.latitude is distinct from excluded.latitude
        or ll2_pads.longitude is distinct from excluded.longitude
        or ll2_pads.state_code is distinct from excluded.state_code
        or ll2_pads.agency_id is distinct from excluded.agency_id
        or ll2_pads.description is distinct from excluded.description
        or ll2_pads.info_url is distinct from excluded.info_url
        or ll2_pads.wiki_url is distinct from excluded.wiki_url
        or ll2_pads.map_url is distinct from excluded.map_url
        or ll2_pads.map_image is distinct from excluded.map_image
        or ll2_pads.country_code is distinct from excluded.country_code
        or ll2_pads.total_launch_count is distinct from excluded.total_launch_count
        or ll2_pads.orbital_launch_attempt_count is distinct from excluded.orbital_launch_attempt_count
        or ll2_pads.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_ll2_rocket_configs_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_ll2_rocket_configs_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      r.ll2_config_id,
      r.name,
      r.full_name,
      r.family,
      r.manufacturer,
      r.variant,
      r.reusable,
      r.image_url,
      r.info_url,
      r.wiki_url,
      r.manufacturer_id,
      coalesce(r.raw, '{}'::jsonb) as raw,
      coalesce(r.fetched_at, now()) as fetched_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      ll2_config_id int,
      name text,
      full_name text,
      family text,
      manufacturer text,
      variant text,
      reusable boolean,
      image_url text,
      info_url text,
      wiki_url text,
      manufacturer_id int,
      raw jsonb,
      fetched_at timestamptz,
      updated_at timestamptz
    )
    where r.ll2_config_id is not null
      and r.name is not null
      and btrim(r.name) <> ''
  ),
  upserted as (
    insert into public.ll2_rocket_configs (
      ll2_config_id,
      name,
      full_name,
      family,
      manufacturer,
      variant,
      reusable,
      image_url,
      info_url,
      wiki_url,
      manufacturer_id,
      raw,
      fetched_at,
      updated_at
    )
    select
      i.ll2_config_id,
      i.name,
      i.full_name,
      i.family,
      i.manufacturer,
      i.variant,
      i.reusable,
      i.image_url,
      i.info_url,
      i.wiki_url,
      i.manufacturer_id,
      i.raw,
      i.fetched_at,
      i.updated_at
    from input i
    on conflict (ll2_config_id) do update
      set name = excluded.name,
          full_name = excluded.full_name,
          family = excluded.family,
          manufacturer = excluded.manufacturer,
          variant = excluded.variant,
          reusable = excluded.reusable,
          image_url = excluded.image_url,
          info_url = excluded.info_url,
          wiki_url = excluded.wiki_url,
          manufacturer_id = excluded.manufacturer_id,
          raw = excluded.raw,
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at
      where
        ll2_rocket_configs.name is distinct from excluded.name
        or ll2_rocket_configs.full_name is distinct from excluded.full_name
        or ll2_rocket_configs.family is distinct from excluded.family
        or ll2_rocket_configs.manufacturer is distinct from excluded.manufacturer
        or ll2_rocket_configs.variant is distinct from excluded.variant
        or ll2_rocket_configs.reusable is distinct from excluded.reusable
        or ll2_rocket_configs.image_url is distinct from excluded.image_url
        or ll2_rocket_configs.info_url is distinct from excluded.info_url
        or ll2_rocket_configs.wiki_url is distinct from excluded.wiki_url
        or ll2_rocket_configs.manufacturer_id is distinct from excluded.manufacturer_id
        or ll2_rocket_configs.raw is distinct from excluded.raw
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$$;


--
-- Name: upsert_satellite_group_memberships_throttled(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_satellite_group_memberships_throttled(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  min_update_seconds int := 86400;
  raw_value jsonb;
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0, 'minUpdateSeconds', min_update_seconds);
  end if;

  select value into raw_value
  from public.system_settings
  where key = 'celestrak_membership_last_seen_min_update_seconds'
  limit 1;

  if raw_value is not null then
    min_update_seconds := case
      when jsonb_typeof(raw_value) = 'number' then (raw_value::text)::int
      when jsonb_typeof(raw_value) = 'string' then (trim(both '\"' from raw_value::text))::int
      else min_update_seconds
    end;
  end if;

  min_update_seconds := greatest(0, least(coalesce(min_update_seconds, 86400), 604800)); -- 0..7d

  with input as (
    select
      nullif(btrim(r.group_code), '') as group_code,
      (r.norad_cat_id)::bigint as norad_cat_id,
      coalesce(r.last_seen_at, now()) as last_seen_at
    from jsonb_to_recordset(rows_in) as r(
      group_code text,
      norad_cat_id text,
      last_seen_at timestamptz
    )
    where r.group_code is not null
      and btrim(r.group_code) <> ''
      and r.norad_cat_id is not null
      and r.norad_cat_id ~ '^[0-9]+$'
  ),
  upserted as (
    insert into public.satellite_group_memberships (group_code, norad_cat_id, first_seen_at, last_seen_at)
    select
      group_code,
      norad_cat_id,
      last_seen_at,
      last_seen_at
    from input
    on conflict (group_code, norad_cat_id) do update
      set last_seen_at = greatest(satellite_group_memberships.last_seen_at, excluded.last_seen_at)
      where excluded.last_seen_at >= satellite_group_memberships.last_seen_at + (min_update_seconds * interval '1 second')
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted),
    'minUpdateSeconds', min_update_seconds
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$_$;


--
-- Name: upsert_satellite_identities_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_satellite_identities_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      (r.norad_cat_id)::bigint as norad_cat_id,
      nullif(btrim(r.intl_des), '') as intl_des,
      nullif(btrim(r.object_name), '') as object_name,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      norad_cat_id text,
      intl_des text,
      object_name text,
      updated_at timestamptz
    )
    where r.norad_cat_id is not null
      and r.norad_cat_id ~ '^[0-9]+$'
  ),
  upserted as (
    insert into public.satellites (norad_cat_id, intl_des, object_name, updated_at)
    select
      norad_cat_id,
      intl_des,
      object_name,
      updated_at
    from input
    on conflict (norad_cat_id) do update
      set intl_des = coalesce(excluded.intl_des, satellites.intl_des),
          object_name = coalesce(excluded.object_name, satellites.object_name),
          updated_at = excluded.updated_at
      where satellites.intl_des is distinct from coalesce(excluded.intl_des, satellites.intl_des)
         or satellites.object_name is distinct from coalesce(excluded.object_name, satellites.object_name)
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, '{}'::jsonb);
end;
$_$;


--
-- Name: upsert_satellites_satcat_if_changed(jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.upsert_satellites_satcat_if_changed(rows_in jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $_$
declare
  result jsonb;
begin
  if rows_in is null or jsonb_typeof(rows_in) <> 'array' or jsonb_array_length(rows_in) = 0 then
    return jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0);
  end if;

  with input as (
    select
      (r.norad_cat_id)::bigint as norad_cat_id,
      nullif(btrim(r.intl_des), '') as intl_des,
      nullif(btrim(r.object_name), '') as object_name,
      case
        when upper(nullif(btrim(r.object_type), '')) = 'R/B' then 'RB'
        when upper(nullif(btrim(r.object_type), '')) in ('PAY', 'RB', 'DEB') then upper(nullif(btrim(r.object_type), ''))
        else 'UNK'
      end as object_type,
      nullif(btrim(r.ops_status_code), '') as ops_status_code,
      nullif(btrim(r.owner), '') as owner,
      case
        when r.launch_date is null then null
        when btrim(r.launch_date) ~ '^\\d{4}-\\d{2}-\\d{2}$' then (btrim(r.launch_date))::date
        else null
      end as launch_date,
      nullif(btrim(r.launch_site), '') as launch_site,
      case
        when r.decay_date is null then null
        when btrim(r.decay_date) ~ '^\\d{4}-\\d{2}-\\d{2}$' then (btrim(r.decay_date))::date
        else null
      end as decay_date,
      case
        when r.period_min is null or btrim(r.period_min) = '' then null
        when btrim(r.period_min) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.period_min))::double precision
        else null
      end as period_min,
      case
        when r.inclination_deg is null or btrim(r.inclination_deg) = '' then null
        when btrim(r.inclination_deg) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.inclination_deg))::double precision
        else null
      end as inclination_deg,
      case
        when r.apogee_km is null or btrim(r.apogee_km) = '' then null
        when btrim(r.apogee_km) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.apogee_km))::double precision
        else null
      end as apogee_km,
      case
        when r.perigee_km is null or btrim(r.perigee_km) = '' then null
        when btrim(r.perigee_km) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.perigee_km))::double precision
        else null
      end as perigee_km,
      case
        when r.rcs_m2 is null or btrim(r.rcs_m2) = '' then null
        when btrim(r.rcs_m2) ~ '^[-+]?[0-9]*\\.?[0-9]+([eE][-+]?[0-9]+)?$' then (btrim(r.rcs_m2))::double precision
        else null
      end as rcs_m2,
      coalesce(r.raw_satcat, '{}'::jsonb) as raw_satcat,
      coalesce(r.satcat_updated_at, now()) as satcat_updated_at,
      coalesce(r.updated_at, now()) as updated_at
    from jsonb_to_recordset(rows_in) as r(
      norad_cat_id text,
      intl_des text,
      object_name text,
      object_type text,
      ops_status_code text,
      owner text,
      launch_date text,
      launch_site text,
      decay_date text,
      period_min text,
      inclination_deg text,
      apogee_km text,
      perigee_km text,
      rcs_m2 text,
      raw_satcat jsonb,
      satcat_updated_at timestamptz,
      updated_at timestamptz
    )
    where r.norad_cat_id is not null
      and r.norad_cat_id ~ '^[0-9]+$'
  ),
  upserted as (
    insert into public.satellites (
      norad_cat_id,
      intl_des,
      object_name,
      object_type,
      ops_status_code,
      owner,
      launch_date,
      launch_site,
      decay_date,
      period_min,
      inclination_deg,
      apogee_km,
      perigee_km,
      rcs_m2,
      raw_satcat,
      satcat_updated_at,
      updated_at
    )
    select
      i.norad_cat_id,
      i.intl_des,
      i.object_name,
      i.object_type,
      i.ops_status_code,
      i.owner,
      i.launch_date,
      i.launch_site,
      i.decay_date,
      i.period_min,
      i.inclination_deg,
      i.apogee_km,
      i.perigee_km,
      i.rcs_m2,
      i.raw_satcat,
      i.satcat_updated_at,
      i.updated_at
    from input i
    on conflict (norad_cat_id) do update
      set intl_des = coalesce(excluded.intl_des, satellites.intl_des),
          object_name = coalesce(excluded.object_name, satellites.object_name),
          object_type = coalesce(excluded.object_type, satellites.object_type),
          ops_status_code = coalesce(excluded.ops_status_code, satellites.ops_status_code),
          owner = coalesce(excluded.owner, satellites.owner),
          launch_date = coalesce(excluded.launch_date, satellites.launch_date),
          launch_site = coalesce(excluded.launch_site, satellites.launch_site),
          decay_date = coalesce(excluded.decay_date, satellites.decay_date),
          period_min = coalesce(excluded.period_min, satellites.period_min),
          inclination_deg = coalesce(excluded.inclination_deg, satellites.inclination_deg),
          apogee_km = coalesce(excluded.apogee_km, satellites.apogee_km),
          perigee_km = coalesce(excluded.perigee_km, satellites.perigee_km),
          rcs_m2 = coalesce(excluded.rcs_m2, satellites.rcs_m2),
          raw_satcat = coalesce(excluded.raw_satcat, satellites.raw_satcat),
          satcat_updated_at = excluded.satcat_updated_at,
          updated_at = excluded.updated_at
      where satellites.intl_des is distinct from coalesce(excluded.intl_des, satellites.intl_des)
         or satellites.object_name is distinct from coalesce(excluded.object_name, satellites.object_name)
         or satellites.object_type is distinct from coalesce(excluded.object_type, satellites.object_type)
         or satellites.ops_status_code is distinct from coalesce(excluded.ops_status_code, satellites.ops_status_code)
         or satellites.owner is distinct from coalesce(excluded.owner, satellites.owner)
         or satellites.launch_date is distinct from coalesce(excluded.launch_date, satellites.launch_date)
         or satellites.launch_site is distinct from coalesce(excluded.launch_site, satellites.launch_site)
         or satellites.decay_date is distinct from coalesce(excluded.decay_date, satellites.decay_date)
         or satellites.period_min is distinct from coalesce(excluded.period_min, satellites.period_min)
         or satellites.inclination_deg is distinct from coalesce(excluded.inclination_deg, satellites.inclination_deg)
         or satellites.apogee_km is distinct from coalesce(excluded.apogee_km, satellites.apogee_km)
         or satellites.perigee_km is distinct from coalesce(excluded.perigee_km, satellites.perigee_km)
         or satellites.rcs_m2 is distinct from coalesce(excluded.rcs_m2, satellites.rcs_m2)
         or satellites.raw_satcat is distinct from coalesce(excluded.raw_satcat, satellites.raw_satcat)
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'skipped', (select count(*) from input) - (select count(*) from upserted)
  )
  into result;

  return coalesce(result, jsonb_build_object('input', 0, 'inserted', 0, 'updated', 0, 'skipped', 0));
end;
$_$;


--
-- Name: validate_calendar_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_calendar_token(token_in uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: validate_embed_token(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_embed_token(token_in uuid) RETURNS boolean
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: ws45_backfill_launch_forecast_quality_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ws45_backfill_launch_forecast_quality_batch(batch_limit_in integer DEFAULT 250) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(1, least(coalesce(batch_limit_in, 250), 2000));
  v_updated int := 0;
begin
  with target as (
    select
      f.id,
      f.raw_text,
      f.forecast_kind,
      f.product_name,
      f.mission_name,
      f.issued_at,
      f.valid_start,
      f.valid_end,
      f.match_status
    from public.ws45_launch_forecasts f
    where
      (f.document_mode = 'unknown' and coalesce(f.raw_text, '') <> '')
      or f.document_family is null
      or f.classification_confidence is null
      or f.parse_confidence is null
      or f.latest_parse_run_id is null
    order by coalesce(f.updated_at, f.created_at, now()) asc, f.id
    limit v_limit
  ), computed as (
    select
      t.id,
      case
        when coalesce(t.raw_text, '') <> '' then 'digital'
        else 'unknown'
      end as document_mode,
      case
        when coalesce(t.raw_text, '') ~* 'Forecast[[:space:]]+Discussio[[:space:]]+n' then 'split_heading_variant'
        when coalesce(t.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]*-[[:space:]]*[A-Za-z]{3}[[:space:]]*-[[:space:]]*[0-9]{2}[[:>:]]' then 'hyphenated_abbrev_month_2digit_year'
        when coalesce(t.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]+[A-Za-z]+\\.?[[:space:]]+[0-9]{4}[[:>:]]' then 'legacy_spaced_full_month_year'
        else 'unknown_family'
      end as document_family,
      array_remove(array[
        case when t.product_name is null then 'product_name' end,
        case when t.mission_name is null then 'mission_name' end,
        case when t.issued_at is null then 'issued_at' end,
        case when t.valid_start is null then 'valid_start' end,
        case when t.valid_end is null then 'valid_end' end
      ], null) as required_fields_missing,
      array_remove(array[
        case when coalesce(t.raw_text, '') ~* 'Forecast[[:space:]]+Discussio[[:space:]]+n' then 'split_forecast_discussion_heading' end,
        case when coalesce(t.raw_text, '') ~* '[[:<:]][0-9]{1,2}[[:space:]]*-[[:space:]]*[A-Za-z]{3}[[:space:]]*-[[:space:]]*[0-9]{2}[[:>:]]' then 'hyphenated_date_tokens' end
      ], null) as normalization_flags
    from target t
  )
  update public.ws45_launch_forecasts f
  set
    document_mode = computed.document_mode,
    document_family = computed.document_family,
    classification_confidence = case
      when computed.document_family = 'unknown_family' then 40
      else 90
    end,
    required_fields_missing = computed.required_fields_missing,
    normalization_flags = computed.normalization_flags,
    parse_status = case
      when coalesce(f.product_name, '') = ''
        and coalesce(f.mission_name, '') = ''
        and f.issued_at is null
        and f.valid_start is null
        and f.valid_end is null
      then 'failed'
      when array_length(computed.required_fields_missing, 1) is not null
        or (f.valid_start is not null and f.valid_end is not null and f.valid_end <= f.valid_start)
      then 'partial'
      else 'parsed'
    end,
    parse_confidence = case
      when f.match_status = 'matched'
        and f.product_name is not null
        and f.mission_name is not null
        and f.issued_at is not null
        and f.valid_start is not null
        and f.valid_end is not null
        and (f.valid_end is null or f.valid_start is null or f.valid_end > f.valid_start)
      then 95
      when coalesce(f.product_name, '') <> ''
        or coalesce(f.mission_name, '') <> ''
        or f.issued_at is not null
        or f.valid_start is not null
        or f.valid_end is not null
      then 60
      else 20
    end,
    publish_eligible = (
      coalesce(f.forecast_kind, '') <> 'faq'
      and f.product_name is not null
      and f.mission_name is not null
      and f.issued_at is not null
      and f.valid_start is not null
      and f.valid_end is not null
      and f.valid_end > f.valid_start
      and f.match_status = 'matched'
    ),
    quarantine_reasons = array_remove(array[
      case when f.product_name is null then 'missing_product_name' end,
      case when f.mission_name is null then 'missing_mission_name' end,
      case when f.issued_at is null then 'missing_issued_at' end,
      case when f.valid_start is null then 'missing_valid_start' end,
      case when f.valid_end is null then 'missing_valid_end' end,
      case when f.valid_start is not null and f.valid_end is not null and f.valid_end <= f.valid_start then 'invalid_valid_window_order' end,
      case when f.match_status = 'unmatched' then 'unmatched_launch' end,
      case when f.match_status = 'ambiguous' then 'ambiguous_launch' end
    ], null)
  from computed
  where computed.id = f.id;

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;


--
-- Name: ws45_seed_parse_runs_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ws45_seed_parse_runs_batch(batch_limit_in integer DEFAULT 250) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(1, least(coalesce(batch_limit_in, 250), 2000));
  v_inserted int := 0;
begin
  with target as (
    select
      f.id,
      f.parse_version,
      f.document_mode,
      f.document_family,
      f.parse_status,
      f.parse_confidence,
      f.publish_eligible,
      f.required_fields_missing,
      f.normalization_flags,
      f.source_label,
      f.forecast_kind,
      f.product_name,
      f.mission_name,
      f.issued_at,
      f.valid_start,
      f.valid_end,
      f.match_strategy,
      f.match_status,
      f.match_confidence,
      f.updated_at,
      f.created_at
    from public.ws45_launch_forecasts f
    where not exists (
      select 1
      from public.ws45_forecast_parse_runs r
      where r.forecast_id = f.id
    )
    order by coalesce(f.updated_at, f.created_at, now()) asc, f.id
    limit v_limit
  )
  insert into public.ws45_forecast_parse_runs (
    forecast_id,
    parser_version,
    runtime,
    attempt_reason,
    document_mode,
    document_family,
    parse_status,
    parse_confidence,
    publish_eligible,
    missing_required_fields,
    validation_failures,
    normalization_flags,
    field_confidence,
    field_evidence,
    strategy_trace,
    stats,
    created_at
  )
  select
    t.id,
    coalesce(t.parse_version, 'unknown'),
    'script',
    'backfill',
    t.document_mode,
    t.document_family,
    t.parse_status,
    t.parse_confidence,
    t.publish_eligible,
    t.required_fields_missing,
    array_remove(array[
      case when t.valid_start is not null and t.valid_end is not null and t.valid_end <= t.valid_start then 'invalid_valid_window_order' end
    ], null),
    t.normalization_flags,
    jsonb_build_object(
      'product_name', case when t.product_name is not null then 100 else 0 end,
      'mission_name', case when t.mission_name is not null then 100 else 0 end,
      'issued_at', case when t.issued_at is not null then 100 else 0 end,
      'valid_start', case when t.valid_start is not null then 100 else 0 end,
      'valid_end', case when t.valid_end is not null then 100 else 0 end
    ),
    jsonb_build_object(
      'source_label', t.source_label,
      'forecast_kind', t.forecast_kind,
      'product_name', t.product_name,
      'mission_name', t.mission_name,
      'issued_at', t.issued_at,
      'valid_start', t.valid_start,
      'valid_end', t.valid_end
    ),
    jsonb_build_object(
      'match_strategy', t.match_strategy,
      'match_status', t.match_status
    ),
    jsonb_build_object(
      'match_status', t.match_status,
      'match_confidence', t.match_confidence,
      'match_strategy', t.match_strategy
    ),
    coalesce(t.updated_at, t.created_at, now())
  from target t;

  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, 0);
end;
$$;


--
-- Name: ws45_sync_latest_parse_run_ids_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ws45_sync_latest_parse_run_ids_batch(batch_limit_in integer DEFAULT 250) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'pg_catalog'
    AS $$
declare
  v_limit int := greatest(1, least(coalesce(batch_limit_in, 250), 2000));
  v_updated int := 0;
begin
  with target as (
    select f.id
    from public.ws45_launch_forecasts f
    where f.latest_parse_run_id is null
    order by coalesce(f.updated_at, f.created_at, now()) asc, f.id
    limit v_limit
  ), latest as (
    select distinct on (r.forecast_id)
      r.forecast_id,
      r.id
    from public.ws45_forecast_parse_runs r
    join target t on t.id = r.forecast_id
    order by r.forecast_id, r.created_at desc, r.id desc
  )
  update public.ws45_launch_forecasts f
  set latest_parse_run_id = latest.id
  from latest
  where latest.forecast_id = f.id;

  get diagnostics v_updated = row_count;
  return coalesce(v_updated, 0);
end;
$$;


--
-- Name: admin_access_override_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_access_override_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    updated_by uuid,
    previous_override text,
    next_override text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT admin_access_override_events_next_override_check CHECK ((next_override = ANY (ARRAY['anon'::text, 'premium'::text]))),
    CONSTRAINT admin_access_override_events_previous_override_check CHECK ((previous_override = ANY (ARRAY['anon'::text, 'premium'::text])))
);


--
-- Name: admin_access_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_access_overrides (
    user_id uuid NOT NULL,
    effective_tier_override text,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_by uuid,
    CONSTRAINT admin_access_overrides_effective_tier_override_check CHECK ((effective_tier_override = ANY (ARRAY['anon'::text, 'premium'::text])))
);


--
-- Name: api_rate_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_rate_counters (
    provider text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    window_seconds integer NOT NULL,
    count integer DEFAULT 0 NOT NULL
)
WITH (fillfactor='80', autovacuum_vacuum_scale_factor='0.01', autovacuum_vacuum_threshold='50', autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='50');


--
-- Name: apple_sign_in_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apple_sign_in_tokens (
    user_id uuid NOT NULL,
    client_id text NOT NULL,
    apple_user_id text,
    token_kind text NOT NULL,
    token_value text,
    email text,
    email_is_private_relay boolean DEFAULT false NOT NULL,
    capture_source text NOT NULL,
    last_captured_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    last_revoked_at timestamp with time zone,
    last_revocation_status text,
    last_revocation_error text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT apple_sign_in_tokens_capture_source_check CHECK ((capture_source = ANY (ARRAY['ios_native_code'::text, 'web_provider_refresh'::text, 'web_provider_access'::text]))),
    CONSTRAINT apple_sign_in_tokens_client_id_check CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 255))),
    CONSTRAINT apple_sign_in_tokens_token_kind_check CHECK ((token_kind = ANY (ARRAY['refresh_token'::text, 'access_token'::text])))
);


--
-- Name: ar_camera_guide_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ar_camera_guide_sessions (
    id uuid NOT NULL,
    launch_id uuid NOT NULL,
    started_at timestamp with time zone NOT NULL,
    ended_at timestamp with time zone,
    duration_ms integer,
    camera_status text,
    motion_status text,
    heading_status text,
    mode_entered text,
    fallback_reason text,
    retry_count integer DEFAULT 0 NOT NULL,
    used_scrub boolean,
    scrub_seconds_total integer,
    lens_preset text,
    corridor_mode text,
    yaw_offset_bucket text,
    pitch_level_bucket text,
    hfov_bucket text,
    vfov_bucket text,
    trajectory_quality integer,
    trajectory_version text,
    trajectory_duration_s integer,
    trajectory_step_s integer,
    avg_sigma_deg real,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_env text,
    screen_bucket text,
    event_tap_count integer,
    pose_source text,
    xr_supported boolean,
    xr_used boolean,
    xr_error_bucket text,
    heading_source text,
    declination_applied boolean,
    fov_source text,
    fusion_enabled boolean,
    fusion_used boolean,
    fusion_fallback_reason text,
    declination_mag_bucket text,
    render_loop_running boolean,
    canvas_hidden boolean,
    pose_update_rate_bucket text,
    confidence_tier_seen text,
    contract_tier text,
    render_tier text,
    dropped_frame_bucket text,
    ar_loop_active_ms integer,
    sky_compass_loop_active_ms integer,
    loop_restart_count integer,
    declination_source text,
    client_profile text,
    lock_on_attempted boolean,
    lock_on_acquired boolean,
    time_to_lock_bucket text,
    lock_loss_count integer,
    lock_on_mode text,
    pose_mode text,
    overlay_mode text,
    vision_backend text,
    runtime_degradation_tier integer,
    trajectory_authority_tier text,
    trajectory_quality_state text,
    runtime_family text,
    tracking_state text,
    tracking_reason text,
    world_alignment text,
    world_mapping_status text,
    lidar_available boolean,
    scene_depth_enabled boolean,
    scene_reconstruction_enabled boolean,
    geo_tracking_state text,
    geo_tracking_accuracy text,
    occlusion_mode text,
    relocalization_count integer,
    high_res_capture_attempted boolean,
    high_res_capture_succeeded boolean,
    zoom_supported boolean,
    zoom_ratio_bucket text,
    zoom_control_path text,
    zoom_apply_latency_bucket text,
    zoom_projection_sync_latency_bucket text,
    projection_source text,
    release_profile text,
    location_permission text,
    location_accuracy text,
    location_fix_state text,
    alignment_ready boolean,
    time_to_usable_ms integer,
    CONSTRAINT ar_camera_guide_sessions_ar_loop_active_ms_check CHECK (((ar_loop_active_ms IS NULL) OR (ar_loop_active_ms >= 0))),
    CONSTRAINT ar_camera_guide_sessions_avg_sigma_deg_check CHECK (((avg_sigma_deg IS NULL) OR ((avg_sigma_deg >= (0)::double precision) AND (avg_sigma_deg <= (90)::double precision)))),
    CONSTRAINT ar_camera_guide_sessions_camera_status_check CHECK (((camera_status IS NULL) OR (camera_status = ANY (ARRAY['granted'::text, 'denied'::text, 'prompt'::text, 'error'::text])))),
    CONSTRAINT ar_camera_guide_sessions_client_env_check CHECK (((client_env IS NULL) OR (client_env = ANY (ARRAY['ios_safari'::text, 'ios_chrome'::text, 'ios_firefox'::text, 'android_chrome'::text, 'android_firefox'::text, 'android_other'::text, 'desktop_chrome'::text, 'desktop_safari'::text, 'desktop_firefox'::text, 'desktop_edge'::text, 'desktop_other'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_client_profile_check CHECK (((client_profile IS NULL) OR (client_profile = ANY (ARRAY['android_chrome'::text, 'android_samsung_internet'::text, 'ios_webkit'::text, 'android_fallback'::text, 'desktop_debug'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_confidence_tier_seen_check CHECK (((confidence_tier_seen IS NULL) OR (confidence_tier_seen = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT ar_camera_guide_sessions_contract_tier_check CHECK (((contract_tier IS NULL) OR (contract_tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT ar_camera_guide_sessions_corridor_mode_check CHECK (((corridor_mode IS NULL) OR (corridor_mode = ANY (ARRAY['tight'::text, 'normal'::text, 'wide'::text])))),
    CONSTRAINT ar_camera_guide_sessions_declination_source_check CHECK (((declination_source IS NULL) OR (declination_source = ANY (ARRAY['wmm'::text, 'approx'::text, 'none'::text])))),
    CONSTRAINT ar_camera_guide_sessions_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT ar_camera_guide_sessions_event_tap_count_check CHECK (((event_tap_count IS NULL) OR (event_tap_count >= 0))),
    CONSTRAINT ar_camera_guide_sessions_fallback_reason_check CHECK (((fallback_reason IS NULL) OR (fallback_reason = ANY (ARRAY['camera_denied'::text, 'motion_denied'::text, 'no_heading'::text, 'camera_error'::text])))),
    CONSTRAINT ar_camera_guide_sessions_fov_source_check CHECK (((fov_source IS NULL) OR (fov_source = ANY (ARRAY['xr'::text, 'preset'::text, 'saved'::text, 'inferred'::text, 'default'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_fusion_fallback_reason_check CHECK (((fusion_fallback_reason IS NULL) OR (fusion_fallback_reason = ANY (ARRAY['no_gyro'::text, 'no_gravity'::text, 'gravity_unreliable'::text, 'not_initialized'::text])))),
    CONSTRAINT ar_camera_guide_sessions_geo_tracking_accuracy_check CHECK (((geo_tracking_accuracy IS NULL) OR (geo_tracking_accuracy = ANY (ARRAY['unknown'::text, 'low'::text, 'medium'::text, 'high'::text])))),
    CONSTRAINT ar_camera_guide_sessions_geo_tracking_state_check CHECK (((geo_tracking_state IS NULL) OR (geo_tracking_state = ANY (ARRAY['not_available'::text, 'initializing'::text, 'localizing'::text, 'localized'::text])))),
    CONSTRAINT ar_camera_guide_sessions_heading_source_check CHECK (((heading_source IS NULL) OR (heading_source = ANY (ARRAY['webxr'::text, 'webkit_compass'::text, 'deviceorientation_absolute'::text, 'deviceorientation_tilt_comp'::text, 'deviceorientation_relative'::text, 'arkit_world'::text, 'core_location_heading'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_heading_status_check CHECK (((heading_status IS NULL) OR (heading_status = ANY (ARRAY['ok'::text, 'unavailable'::text, 'noisy'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_lens_preset_check CHECK (((lens_preset IS NULL) OR (lens_preset = ANY (ARRAY['0.5x'::text, '1x'::text, '2x'::text, '3x'::text, 'custom'::text])))),
    CONSTRAINT ar_camera_guide_sessions_location_accuracy_check CHECK (((location_accuracy IS NULL) OR (location_accuracy = ANY (ARRAY['full'::text, 'reduced'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_location_fix_state_check CHECK (((location_fix_state IS NULL) OR (location_fix_state = ANY (ARRAY['unavailable'::text, 'acquiring'::text, 'timeout'::text, 'coarse'::text, 'ready'::text])))),
    CONSTRAINT ar_camera_guide_sessions_location_permission_check CHECK (((location_permission IS NULL) OR (location_permission = ANY (ARRAY['granted'::text, 'denied'::text, 'prompt'::text, 'error'::text, 'not_applicable'::text])))),
    CONSTRAINT ar_camera_guide_sessions_lock_loss_count_check CHECK (((lock_loss_count IS NULL) OR (lock_loss_count >= 0))),
    CONSTRAINT ar_camera_guide_sessions_lock_on_mode_check CHECK (((lock_on_mode IS NULL) OR (lock_on_mode = ANY (ARRAY['auto'::text, 'manual_debug'::text])))),
    CONSTRAINT ar_camera_guide_sessions_loop_restart_count_check CHECK (((loop_restart_count IS NULL) OR (loop_restart_count >= 0))),
    CONSTRAINT ar_camera_guide_sessions_mode_entered_check CHECK (((mode_entered IS NULL) OR (mode_entered = ANY (ARRAY['ar'::text, 'sky_compass'::text])))),
    CONSTRAINT ar_camera_guide_sessions_motion_status_check CHECK (((motion_status IS NULL) OR (motion_status = ANY (ARRAY['granted'::text, 'denied'::text, 'prompt'::text, 'error'::text, 'not_applicable'::text])))),
    CONSTRAINT ar_camera_guide_sessions_occlusion_mode_check CHECK (((occlusion_mode IS NULL) OR (occlusion_mode = ANY (ARRAY['none'::text, 'scene_depth'::text, 'mesh'::text])))),
    CONSTRAINT ar_camera_guide_sessions_overlay_mode_check CHECK (((overlay_mode IS NULL) OR (overlay_mode = ANY (ARRAY['precision'::text, 'guided'::text, 'search'::text, 'recover'::text])))),
    CONSTRAINT ar_camera_guide_sessions_pose_mode_check CHECK (((pose_mode IS NULL) OR (pose_mode = ANY (ARRAY['webxr'::text, 'sensor_fused'::text, 'arkit_world_tracking'::text])))),
    CONSTRAINT ar_camera_guide_sessions_pose_source_check CHECK (((pose_source IS NULL) OR (pose_source = ANY (ARRAY['webxr'::text, 'deviceorientation'::text, 'deviceorientationabsolute'::text, 'sky_compass'::text, 'arkit_world_tracking'::text])))),
    CONSTRAINT ar_camera_guide_sessions_projection_source_check CHECK (((projection_source IS NULL) OR (projection_source = ANY (ARRAY['intrinsics_frame'::text, 'projection_matrix'::text, 'inferred_fov'::text, 'preset'::text])))),
    CONSTRAINT ar_camera_guide_sessions_release_profile_check CHECK (((release_profile IS NULL) OR (char_length(release_profile) <= 64))),
    CONSTRAINT ar_camera_guide_sessions_relocalization_count_check CHECK (((relocalization_count IS NULL) OR (relocalization_count >= 0))),
    CONSTRAINT ar_camera_guide_sessions_render_tier_check CHECK (((render_tier IS NULL) OR (render_tier = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_retry_count_check CHECK ((retry_count >= 0)),
    CONSTRAINT ar_camera_guide_sessions_runtime_degradation_tier_check CHECK (((runtime_degradation_tier IS NULL) OR ((runtime_degradation_tier >= 0) AND (runtime_degradation_tier <= 3)))),
    CONSTRAINT ar_camera_guide_sessions_runtime_family_check CHECK (((runtime_family IS NULL) OR (runtime_family = ANY (ARRAY['web'::text, 'ios_native'::text, 'android_native'::text])))),
    CONSTRAINT ar_camera_guide_sessions_screen_bucket_check CHECK (((screen_bucket IS NULL) OR (screen_bucket = ANY (ARRAY['xs'::text, 'sm'::text, 'md'::text, 'lg'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_scrub_seconds_total_check CHECK (((scrub_seconds_total IS NULL) OR (scrub_seconds_total >= 0))),
    CONSTRAINT ar_camera_guide_sessions_sky_compass_loop_active_ms_check CHECK (((sky_compass_loop_active_ms IS NULL) OR (sky_compass_loop_active_ms >= 0))),
    CONSTRAINT ar_camera_guide_sessions_time_to_lock_bucket_check CHECK (((time_to_lock_bucket IS NULL) OR (time_to_lock_bucket = ANY (ARRAY['<2s'::text, '2..5s'::text, '5..10s'::text, '10..20s'::text, '20..60s'::text, '60s+'::text])))),
    CONSTRAINT ar_camera_guide_sessions_time_to_usable_ms_check CHECK (((time_to_usable_ms IS NULL) OR ((time_to_usable_ms >= 0) AND (time_to_usable_ms <= 21600000)))),
    CONSTRAINT ar_camera_guide_sessions_tracking_state_check CHECK (((tracking_state IS NULL) OR (tracking_state = ANY (ARRAY['not_available'::text, 'limited'::text, 'normal'::text])))),
    CONSTRAINT ar_camera_guide_sessions_trajectory_authority_tier_check CHECK (((trajectory_authority_tier IS NULL) OR (trajectory_authority_tier = ANY (ARRAY['partner_feed'::text, 'official_numeric'::text, 'regulatory_constrained'::text, 'supplemental_ephemeris'::text, 'public_metadata'::text, 'model_prior'::text])))),
    CONSTRAINT ar_camera_guide_sessions_trajectory_duration_s_check CHECK (((trajectory_duration_s IS NULL) OR (trajectory_duration_s >= 0))),
    CONSTRAINT ar_camera_guide_sessions_trajectory_quality_check CHECK (((trajectory_quality IS NULL) OR ((trajectory_quality >= 0) AND (trajectory_quality <= 3)))),
    CONSTRAINT ar_camera_guide_sessions_trajectory_quality_state_check CHECK (((trajectory_quality_state IS NULL) OR (trajectory_quality_state = ANY (ARRAY['precision'::text, 'guided'::text, 'search'::text, 'pad_only'::text])))),
    CONSTRAINT ar_camera_guide_sessions_trajectory_step_s_check CHECK (((trajectory_step_s IS NULL) OR (trajectory_step_s >= 0))),
    CONSTRAINT ar_camera_guide_sessions_vision_backend_check CHECK (((vision_backend IS NULL) OR (vision_backend = ANY (ARRAY['worker_roi'::text, 'main_thread_roi'::text, 'none'::text, 'vision_native'::text])))),
    CONSTRAINT ar_camera_guide_sessions_world_alignment_check CHECK (((world_alignment IS NULL) OR (world_alignment = ANY (ARRAY['gravity'::text, 'gravity_and_heading'::text, 'camera'::text])))),
    CONSTRAINT ar_camera_guide_sessions_world_mapping_status_check CHECK (((world_mapping_status IS NULL) OR (world_mapping_status = ANY (ARRAY['not_available'::text, 'limited'::text, 'extending'::text, 'mapped'::text])))),
    CONSTRAINT ar_camera_guide_sessions_xr_error_bucket_check CHECK (((xr_error_bucket IS NULL) OR (xr_error_bucket = ANY (ARRAY['not_available'::text, 'unsupported'::text, 'webgl'::text, 'permission'::text, 'session_error'::text, 'unknown'::text])))),
    CONSTRAINT ar_camera_guide_sessions_zoom_control_path_check CHECK (((zoom_control_path IS NULL) OR (zoom_control_path = ANY (ARRAY['native_camera'::text, 'track_constraints'::text, 'preset_fallback'::text, 'unsupported'::text]))))
);


--
-- Name: artemis_budget_lines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_budget_lines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fiscal_year integer,
    agency text,
    program text,
    line_item text,
    amount_requested numeric,
    amount_enacted numeric,
    announced_time timestamp with time zone,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artemis_content_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_content_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fingerprint text NOT NULL,
    kind text NOT NULL,
    mission_key text NOT NULL,
    title text NOT NULL,
    summary text,
    url text NOT NULL,
    published_at timestamp with time zone,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    source_key text,
    source_type text NOT NULL,
    source_class text NOT NULL,
    source_tier text DEFAULT 'tier2'::text NOT NULL,
    authority_score numeric(4,3) DEFAULT 0.5 NOT NULL,
    relevance_score numeric(4,3) DEFAULT 0.5 NOT NULL,
    freshness_score numeric(4,3) DEFAULT 0.5 NOT NULL,
    overall_score numeric(4,3) DEFAULT 0.5 NOT NULL,
    image_url text,
    external_id text,
    platform text,
    data_label text,
    data_value numeric,
    data_unit text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_content_items_authority_score_check CHECK (((authority_score >= (0)::numeric) AND (authority_score <= (1)::numeric))),
    CONSTRAINT artemis_content_items_freshness_score_check CHECK (((freshness_score >= (0)::numeric) AND (freshness_score <= (1)::numeric))),
    CONSTRAINT artemis_content_items_kind_check CHECK ((kind = ANY (ARRAY['article'::text, 'photo'::text, 'social'::text, 'data'::text]))),
    CONSTRAINT artemis_content_items_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text]))),
    CONSTRAINT artemis_content_items_overall_score_check CHECK (((overall_score >= (0)::numeric) AND (overall_score <= (1)::numeric))),
    CONSTRAINT artemis_content_items_relevance_score_check CHECK (((relevance_score >= (0)::numeric) AND (relevance_score <= (1)::numeric))),
    CONSTRAINT artemis_content_items_source_class_check CHECK ((source_class = ANY (ARRAY['nasa_primary'::text, 'oversight'::text, 'budget'::text, 'procurement'::text, 'technical'::text, 'media'::text, 'll2-cache'::text, 'curated-fallback'::text]))),
    CONSTRAINT artemis_content_items_source_tier_check CHECK ((source_tier = ANY (ARRAY['tier1'::text, 'tier2'::text]))),
    CONSTRAINT artemis_content_items_source_type_check CHECK ((source_type = ANY (ARRAY['nasa_primary'::text, 'oversight'::text, 'budget'::text, 'procurement'::text, 'technical'::text, 'media'::text])))
);


--
-- Name: artemis_content_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_content_scores (
    id bigint NOT NULL,
    content_item_id uuid NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    authority_score numeric(4,3) NOT NULL,
    relevance_score numeric(4,3) NOT NULL,
    freshness_score numeric(4,3) NOT NULL,
    stability_score numeric(4,3) NOT NULL,
    risk_score numeric(4,3) NOT NULL,
    overall_score numeric(4,3) NOT NULL,
    weights jsonb DEFAULT '{}'::jsonb NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT artemis_content_scores_authority_score_check CHECK (((authority_score >= (0)::numeric) AND (authority_score <= (1)::numeric))),
    CONSTRAINT artemis_content_scores_freshness_score_check CHECK (((freshness_score >= (0)::numeric) AND (freshness_score <= (1)::numeric))),
    CONSTRAINT artemis_content_scores_overall_score_check CHECK (((overall_score >= (0)::numeric) AND (overall_score <= (1)::numeric))),
    CONSTRAINT artemis_content_scores_relevance_score_check CHECK (((relevance_score >= (0)::numeric) AND (relevance_score <= (1)::numeric))),
    CONSTRAINT artemis_content_scores_risk_score_check CHECK (((risk_score >= (0)::numeric) AND (risk_score <= (1)::numeric))),
    CONSTRAINT artemis_content_scores_stability_score_check CHECK (((stability_score >= (0)::numeric) AND (stability_score <= (1)::numeric)))
);


--
-- Name: artemis_content_scores_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artemis_content_scores_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artemis_content_scores_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artemis_content_scores_id_seq OWNED BY public.artemis_content_scores.id;


--
-- Name: artemis_contract_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_contract_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    action_key text NOT NULL,
    mod_number text DEFAULT '0'::text NOT NULL,
    action_date date,
    obligation_delta numeric,
    obligation_cumulative numeric,
    solicitation_id text,
    sam_notice_id text,
    source text DEFAULT 'usaspending'::text NOT NULL,
    source_record_hash text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_contract_actions_source_check CHECK ((source = ANY (ARRAY['sam_contract_awards'::text, 'sam_data_services'::text, 'usaspending'::text, 'manual'::text])))
);


--
-- Name: artemis_contract_budget_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_contract_budget_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    budget_line_id uuid NOT NULL,
    match_method text NOT NULL,
    confidence numeric DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_contract_budget_map_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT artemis_contract_budget_map_method_check CHECK ((match_method = ANY (ARRAY['rule'::text, 'keyword'::text, 'manual'::text])))
);


--
-- Name: artemis_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_key text NOT NULL,
    piid text NOT NULL,
    referenced_idv_piid text,
    parent_award_id text,
    agency_code text,
    subtier_code text,
    mission_key text DEFAULT 'program'::text NOT NULL,
    awardee_name text,
    awardee_uei text,
    contract_type text DEFAULT 'definitive'::text NOT NULL,
    description text,
    base_award_date date,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_contracts_contract_type_check CHECK ((contract_type = ANY (ARRAY['definitive'::text, 'idv'::text, 'order'::text, 'unknown'::text]))),
    CONSTRAINT artemis_contracts_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text])))
);


--
-- Name: artemis_entities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_entities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_key text NOT NULL,
    name text NOT NULL,
    entity_type text NOT NULL,
    description text,
    related_missions text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artemis_ingest_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_ingest_checkpoints (
    source_key text NOT NULL,
    source_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    cursor text,
    records_ingested bigint DEFAULT 0 NOT NULL,
    last_announced_time timestamp with time zone,
    last_event_time timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_ingest_checkpoints_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'error'::text])))
);


--
-- Name: artemis_mission_components; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_mission_components (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mission_key text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    component text NOT NULL,
    component_normalized text GENERATED ALWAYS AS (lower(component)) STORED,
    description text NOT NULL,
    official_urls text[] DEFAULT '{}'::text[] NOT NULL,
    image_url text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_mission_components_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text])))
);


--
-- Name: artemis_mission_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_mission_snapshots (
    mission_key text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_updated timestamp with time zone,
    snapshot jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_mission_snapshots_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text])))
);


--
-- Name: artemis_opportunity_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_opportunity_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notice_id text NOT NULL,
    solicitation_id text,
    ptype text,
    title text,
    posted_date date,
    response_deadline timestamp with time zone,
    latest_active_version boolean DEFAULT true NOT NULL,
    awardee_name text,
    award_amount numeric,
    notice_url text,
    attachment_count integer,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artemis_people; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_people (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mission_key text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    name text NOT NULL,
    name_normalized text GENERATED ALWAYS AS (lower(name)) STORED,
    agency text NOT NULL,
    role text,
    bio_url text NOT NULL,
    portrait_url text,
    summary text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_people_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text])))
);


--
-- Name: artemis_procurement_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_procurement_awards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    usaspending_award_id text,
    award_title text,
    recipient text,
    obligated_amount numeric,
    awarded_on date,
    mission_key text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    program_scope text GENERATED ALWAYS AS (lower(COALESCE((metadata ->> 'programScope'::text), (metadata ->> 'program_scope'::text)))) STORED,
    CONSTRAINT artemis_procurement_awards_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text])))
);


--
-- Name: artemis_program_procurement_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_program_procurement_cache (
    contract_id uuid NOT NULL,
    usaspending_award_id text,
    contract_key text NOT NULL,
    mission_key text DEFAULT 'program'::text NOT NULL,
    recipient text,
    award_title text,
    obligated_amount numeric,
    awarded_on date,
    solicitation_id text,
    action_count integer DEFAULT 0 NOT NULL,
    latest_mod_number text,
    source_document_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: artemis_sam_contract_award_rows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_sam_contract_award_rows (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    row_key text NOT NULL,
    contract_id uuid NOT NULL,
    contract_key text NOT NULL,
    mission_key text DEFAULT 'program'::text NOT NULL,
    program_scope text DEFAULT 'other'::text NOT NULL,
    solicitation_id text,
    piid text,
    referenced_idv_piid text,
    response_status integer,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_sam_contract_award_rows_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text]))),
    CONSTRAINT artemis_sam_contract_award_rows_program_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'blue-origin'::text, 'spacex'::text, 'other'::text])))
);


--
-- Name: artemis_social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_social_accounts (
    id bigint NOT NULL,
    platform text NOT NULL,
    handle text NOT NULL,
    handle_normalized text GENERATED ALWAYS AS (lower(handle)) STORED,
    mission_scope text DEFAULT 'program'::text NOT NULL,
    source_tier text DEFAULT 'tier1'::text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_social_accounts_mission_scope_check CHECK ((mission_scope = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text]))),
    CONSTRAINT artemis_social_accounts_platform_check CHECK ((platform = ANY (ARRAY['x'::text, 'twitter'::text, 'youtube'::text, 'instagram'::text, 'facebook'::text, 'other'::text]))),
    CONSTRAINT artemis_social_accounts_source_tier_check CHECK ((source_tier = ANY (ARRAY['tier1'::text, 'tier2'::text])))
);


--
-- Name: artemis_social_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.artemis_social_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: artemis_social_accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.artemis_social_accounts_id_seq OWNED BY public.artemis_social_accounts.id;


--
-- Name: artemis_source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_source_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    source_type text NOT NULL,
    url text NOT NULL,
    title text,
    published_at timestamp with time zone,
    announced_time timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    http_status integer,
    etag text,
    last_modified timestamp with time zone,
    sha256 text,
    bytes integer,
    content_type text,
    summary text,
    raw jsonb,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: artemis_source_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_source_registry (
    source_key text NOT NULL,
    source_type text NOT NULL,
    source_tier text DEFAULT 'tier2'::text NOT NULL,
    display_name text NOT NULL,
    base_url text,
    authority_score numeric(4,3) DEFAULT 0.5 NOT NULL,
    relevance_weight numeric(4,3) DEFAULT 0.5 NOT NULL,
    freshness_sla_minutes integer,
    poll_interval_minutes integer,
    active boolean DEFAULT true NOT NULL,
    parser_version text DEFAULT 'v1'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_source_registry_authority_score_check CHECK (((authority_score >= (0)::numeric) AND (authority_score <= (1)::numeric))),
    CONSTRAINT artemis_source_registry_relevance_weight_check CHECK (((relevance_weight >= (0)::numeric) AND (relevance_weight <= (1)::numeric))),
    CONSTRAINT artemis_source_registry_source_tier_check CHECK ((source_tier = ANY (ARRAY['tier1'::text, 'tier2'::text]))),
    CONSTRAINT artemis_source_registry_source_type_check CHECK ((source_type = ANY (ARRAY['nasa_primary'::text, 'oversight'::text, 'budget'::text, 'procurement'::text, 'technical'::text, 'media'::text])))
);


--
-- Name: artemis_spending_timeseries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_spending_timeseries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    fiscal_year integer NOT NULL,
    fiscal_month integer NOT NULL,
    obligations numeric,
    outlays numeric,
    source text DEFAULT 'usaspending'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_spending_timeseries_month_check CHECK (((fiscal_month >= 1) AND (fiscal_month <= 12))),
    CONSTRAINT artemis_spending_timeseries_source_check CHECK ((source = ANY (ARRAY['usaspending'::text, 'sam'::text, 'manual'::text])))
);


--
-- Name: artemis_timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.artemis_timeline_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mission_key text NOT NULL,
    title text NOT NULL,
    summary text,
    event_time timestamp with time zone,
    event_time_precision text DEFAULT 'unknown'::text NOT NULL,
    announced_time timestamp with time zone NOT NULL,
    source_type text NOT NULL,
    confidence text NOT NULL,
    source_document_id uuid NOT NULL,
    source_url text,
    supersedes_event_id uuid,
    is_superseded boolean DEFAULT false NOT NULL,
    fingerprint text NOT NULL,
    tags text[] DEFAULT '{}'::text[] NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT artemis_timeline_events_confidence_check CHECK ((confidence = ANY (ARRAY['primary'::text, 'oversight'::text, 'secondary'::text]))),
    CONSTRAINT artemis_timeline_events_mission_key_check CHECK ((mission_key = ANY (ARRAY['program'::text, 'artemis-i'::text, 'artemis-ii'::text, 'artemis-iii'::text, 'artemis-iv'::text, 'artemis-v'::text, 'artemis-vi'::text, 'artemis-vii'::text]))),
    CONSTRAINT artemis_timeline_events_source_type_check CHECK ((source_type = ANY (ARRAY['nasa_primary'::text, 'oversight'::text, 'budget'::text, 'procurement'::text, 'technical'::text, 'media'::text])))
);


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.billing_events (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.billing_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: billing_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.billing_events_id_seq OWNED BY public.billing_events.id;


--
-- Name: blue_origin_contract_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_contract_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    action_key text NOT NULL,
    mod_number text DEFAULT '0'::text NOT NULL,
    action_date date,
    obligation_delta numeric,
    obligation_cumulative numeric,
    source text DEFAULT 'manual'::text NOT NULL,
    source_record_hash text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_contract_actions_source_check CHECK ((source = ANY (ARRAY['usaspending'::text, 'sam'::text, 'government-record'::text, 'manual'::text])))
);


--
-- Name: blue_origin_contract_vehicle_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_contract_vehicle_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    vehicle_slug text,
    engine_slug text,
    match_method text DEFAULT 'rule'::text NOT NULL,
    confidence numeric DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_contract_vehicle_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
    CONSTRAINT blue_origin_contract_vehicle_match_method_check CHECK ((match_method = ANY (ARRAY['rule'::text, 'keyword'::text, 'manual'::text])))
);


--
-- Name: blue_origin_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_contracts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_key text NOT NULL,
    mission_key text NOT NULL,
    title text NOT NULL,
    agency text,
    customer text,
    amount numeric,
    awarded_on date,
    description text,
    source_url text,
    source_label text,
    status text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_contracts_mission_check CHECK ((mission_key = ANY (ARRAY['blue-origin-program'::text, 'new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text, 'be-4'::text])))
);


--
-- Name: blue_origin_engines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_engines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    engine_slug text NOT NULL,
    mission_key text NOT NULL,
    display_name text NOT NULL,
    propellants text,
    cycle text,
    thrust_vac_kn numeric,
    thrust_sl_kn numeric,
    status text,
    description text,
    official_url text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_engines_mission_check CHECK ((mission_key = ANY (ARRAY['blue-origin-program'::text, 'be-4'::text, 'blue-moon'::text, 'new-shepard'::text, 'new-glenn'::text]))),
    CONSTRAINT blue_origin_engines_slug_check CHECK ((engine_slug = ANY (ARRAY['be-3pm'::text, 'be-3u'::text, 'be-4'::text, 'be-7'::text])))
);


--
-- Name: blue_origin_flights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_flights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flight_code text NOT NULL,
    mission_key text NOT NULL,
    launch_id text,
    ll2_launch_uuid text,
    launch_name text,
    launch_date timestamp with time zone,
    status text,
    official_mission_url text,
    source text DEFAULT 'launches_public_cache'::text NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_flights_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT blue_origin_flights_mission_check CHECK ((mission_key = ANY (ARRAY['new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text, 'be-4'::text, 'blue-origin-program'::text])))
);


--
-- Name: blue_origin_ingest_checkpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_ingest_checkpoints (
    source_key text NOT NULL,
    source_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    cursor text,
    records_ingested bigint DEFAULT 0 NOT NULL,
    last_announced_time timestamp with time zone,
    last_event_time timestamp with time zone,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_ingest_checkpoints_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'complete'::text, 'error'::text])))
);


--
-- Name: blue_origin_mission_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_mission_snapshots (
    mission_key text NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_updated timestamp with time zone,
    snapshot jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_mission_snapshots_mission_key_check CHECK ((mission_key = ANY (ARRAY['blue-origin-program'::text, 'new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text, 'be-4'::text])))
);


--
-- Name: blue_origin_opportunity_notices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_opportunity_notices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notice_id text NOT NULL,
    solicitation_id text,
    title text,
    posted_date date,
    response_deadline timestamp with time zone,
    awardee_name text,
    award_amount numeric,
    notice_url text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blue_origin_passengers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_passengers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mission_key text NOT NULL,
    flight_code text,
    flight_slug text,
    name text NOT NULL,
    name_normalized text GENERATED ALWAYS AS (lower(name)) STORED,
    role text,
    nationality text,
    launch_id text,
    launch_name text,
    launch_date timestamp with time zone,
    source text DEFAULT 'derived'::text NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    traveler_slug text,
    CONSTRAINT blue_origin_passengers_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT blue_origin_passengers_mission_check CHECK ((mission_key = ANY (ARRAY['blue-origin-program'::text, 'new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text, 'be-4'::text])))
);


--
-- Name: blue_origin_payloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_payloads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    mission_key text NOT NULL,
    flight_code text,
    flight_slug text,
    name text NOT NULL,
    name_normalized text GENERATED ALWAYS AS (lower(name)) STORED,
    payload_type text,
    orbit text,
    agency text,
    launch_id text,
    launch_name text,
    launch_date timestamp with time zone,
    source text DEFAULT 'derived'::text NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_payloads_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT blue_origin_payloads_mission_check CHECK ((mission_key = ANY (ARRAY['blue-origin-program'::text, 'new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text, 'be-4'::text])))
);


--
-- Name: blue_origin_people_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_people_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    person_key text NOT NULL,
    name text NOT NULL,
    nationality text,
    bio text,
    profile_url text,
    source text DEFAULT 'derived'::text NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_people_profiles_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: blue_origin_source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_source_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    source_type text NOT NULL,
    url text NOT NULL,
    title text,
    published_at timestamp with time zone,
    announced_time timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    http_status integer,
    etag text,
    last_modified timestamp with time zone,
    sha256 text,
    bytes integer,
    content_type text,
    summary text,
    raw jsonb,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blue_origin_spending_timeseries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_spending_timeseries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contract_id uuid NOT NULL,
    fiscal_year integer NOT NULL,
    fiscal_month integer NOT NULL,
    obligations numeric,
    outlays numeric,
    source text DEFAULT 'usaspending'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_spending_month_check CHECK (((fiscal_month >= 1) AND (fiscal_month <= 12))),
    CONSTRAINT blue_origin_spending_source_check CHECK ((source = ANY (ARRAY['usaspending'::text, 'sam'::text, 'manual'::text])))
);


--
-- Name: blue_origin_timeline_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_timeline_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_key text NOT NULL,
    mission_key text NOT NULL,
    title text NOT NULL,
    summary text,
    event_time timestamp with time zone,
    announced_time timestamp with time zone NOT NULL,
    source_type text NOT NULL,
    confidence text NOT NULL,
    status text DEFAULT 'upcoming'::text NOT NULL,
    source_document_id uuid,
    source_url text,
    supersedes_event_key text,
    is_superseded boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_timeline_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT blue_origin_timeline_mission_check CHECK ((mission_key = ANY (ARRAY['blue-origin-program'::text, 'new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text, 'be-4'::text]))),
    CONSTRAINT blue_origin_timeline_source_type_check CHECK ((source_type = ANY (ARRAY['blue-origin-official'::text, 'government-record'::text, 'll2-cache'::text, 'curated-fallback'::text, 'social'::text]))),
    CONSTRAINT blue_origin_timeline_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'upcoming'::text, 'tentative'::text, 'superseded'::text])))
);


--
-- Name: blue_origin_traveler_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_traveler_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    traveler_slug text NOT NULL,
    launch_id text,
    flight_code text,
    source_type text NOT NULL,
    source_url text,
    source_document_id uuid,
    profile_url text,
    image_url text,
    bio_full text,
    bio_excerpt text,
    attribution jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence text DEFAULT 'medium'::text NOT NULL,
    content_sha256 text,
    captured_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_traveler_sources_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: blue_origin_travelers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_travelers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    traveler_slug text NOT NULL,
    canonical_name text NOT NULL,
    bio_short text,
    primary_image_url text,
    primary_profile_url text,
    nationality text,
    source_confidence text DEFAULT 'medium'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_travelers_confidence_check CHECK ((source_confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))
);


--
-- Name: blue_origin_vehicle_engine_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_vehicle_engine_map (
    vehicle_slug text NOT NULL,
    engine_slug text NOT NULL,
    role text,
    notes text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: blue_origin_vehicles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.blue_origin_vehicles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    vehicle_slug text NOT NULL,
    mission_key text NOT NULL,
    display_name text NOT NULL,
    vehicle_class text,
    status text,
    first_flight date,
    description text,
    official_url text,
    source_document_id uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT blue_origin_vehicles_mission_check CHECK ((mission_key = ANY (ARRAY['new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text]))),
    CONSTRAINT blue_origin_vehicles_slug_check CHECK ((vehicle_slug = ANY (ARRAY['new-shepard'::text, 'new-glenn'::text, 'blue-moon'::text, 'blue-ring'::text])))
);


--
-- Name: calendar_feeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_feeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    alarm_minutes_before integer,
    cached_ics text,
    cached_ics_etag text,
    cached_ics_generated_at timestamp with time zone,
    source_kind text DEFAULT 'all_launches'::text NOT NULL,
    source_preset_id uuid,
    source_follow_rule_type text,
    source_follow_rule_value text,
    CONSTRAINT calendar_feeds_alarm_minutes_check CHECK (((alarm_minutes_before IS NULL) OR ((alarm_minutes_before >= 0) AND (alarm_minutes_before <= 10080)))),
    CONSTRAINT calendar_feeds_source_follow_rule_type_check CHECK (((source_follow_rule_type IS NULL) OR (source_follow_rule_type = ANY (ARRAY['launch'::text, 'pad'::text, 'provider'::text, 'tier'::text])))),
    CONSTRAINT calendar_feeds_source_kind_check CHECK ((source_kind = ANY (ARRAY['all_launches'::text, 'preset'::text, 'follow'::text]))),
    CONSTRAINT calendar_feeds_source_scope_check CHECK ((((source_kind = 'all_launches'::text) AND (source_preset_id IS NULL) AND (source_follow_rule_type IS NULL) AND (source_follow_rule_value IS NULL)) OR ((source_kind = 'preset'::text) AND (source_preset_id IS NOT NULL) AND (source_follow_rule_type IS NULL) AND (source_follow_rule_value IS NULL)) OR ((source_kind = 'follow'::text) AND (source_preset_id IS NULL) AND (source_follow_rule_type IS NOT NULL) AND (source_follow_rule_value IS NOT NULL))))
);


--
-- Name: canonical_contracts_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.canonical_contracts_cache (
    uid text NOT NULL,
    scope text NOT NULL,
    story_status text DEFAULT 'pending'::text NOT NULL,
    story_key text,
    match_confidence numeric,
    has_full_story boolean DEFAULT false NOT NULL,
    action_count integer DEFAULT 0 NOT NULL,
    notice_count integer DEFAULT 0 NOT NULL,
    spending_count integer DEFAULT 0 NOT NULL,
    bidder_count integer DEFAULT 0 NOT NULL,
    title text NOT NULL,
    description text,
    contract_key text NOT NULL,
    piid text,
    usaspending_award_id text,
    mission_key text,
    mission_label text NOT NULL,
    agency text,
    customer text,
    recipient text,
    amount numeric,
    awarded_on date,
    source_url text,
    source_label text,
    status text,
    updated_at timestamp with time zone,
    canonical_path text NOT NULL,
    program_path text NOT NULL,
    keywords text[] DEFAULT ARRAY[]::text[] NOT NULL,
    search_text text DEFAULT ''::text NOT NULL,
    sort_exact_rank smallint DEFAULT 1 NOT NULL,
    sort_date timestamp with time zone,
    cache_refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT canonical_contracts_cache_scope_check CHECK ((scope = ANY (ARRAY['spacex'::text, 'blue-origin'::text, 'artemis'::text]))),
    CONSTRAINT canonical_contracts_cache_sort_exact_rank_check CHECK ((sort_exact_rank = ANY (ARRAY[0, 1]))),
    CONSTRAINT canonical_contracts_cache_story_status_check CHECK ((story_status = ANY (ARRAY['exact'::text, 'pending'::text])))
);


--
-- Name: discount_campaign_provider_artifacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_campaign_provider_artifacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    provider text NOT NULL,
    artifact_kind text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    external_id text,
    external_code text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    last_synced_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discount_campaign_provider_artifacts_artifact_kind_check CHECK ((artifact_kind = ANY (ARRAY['stripe_coupon'::text, 'stripe_promotion_code'::text, 'apple_offer_code'::text, 'apple_promotional_offer'::text, 'apple_win_back_offer'::text, 'google_offer'::text, 'google_promo_code'::text]))),
    CONSTRAINT discount_campaign_provider_artifacts_check CHECK (((external_id IS NOT NULL) OR (external_code IS NOT NULL))),
    CONSTRAINT discount_campaign_provider_artifacts_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'apple_app_store'::text, 'google_play'::text]))),
    CONSTRAINT discount_campaign_provider_artifacts_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'ended'::text, 'sync_error'::text])))
);


--
-- Name: discount_campaign_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_campaign_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    user_id uuid,
    email text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discount_campaign_targets_check CHECK (((user_id IS NOT NULL) OR (NULLIF(TRIM(BOTH FROM COALESCE(email, ''::text)), ''::text) IS NOT NULL)))
);


--
-- Name: discount_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    product_key text NOT NULL,
    campaign_kind text NOT NULL,
    targeting_kind text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    display_copy jsonb DEFAULT '{}'::jsonb NOT NULL,
    internal_notes text,
    created_by uuid,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discount_campaigns_campaign_kind_check CHECK ((campaign_kind = ANY (ARRAY['promo_code'::text, 'store_offer'::text]))),
    CONSTRAINT discount_campaigns_product_key_check CHECK ((product_key = 'premium_monthly'::text)),
    CONSTRAINT discount_campaigns_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'ended'::text, 'sync_error'::text]))),
    CONSTRAINT discount_campaigns_targeting_kind_check CHECK ((targeting_kind = ANY (ARRAY['all_users'::text, 'new_subscribers'::text, 'lapsed_subscribers'::text, 'specific_users'::text])))
);


--
-- Name: embed_widgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.embed_widgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    widget_type text DEFAULT 'next_launch_card'::text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    preset_id uuid,
    watchlist_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT embed_widgets_scope_one CHECK (((((preset_id IS NOT NULL))::integer + ((watchlist_id IS NOT NULL))::integer) <= 1)),
    CONSTRAINT embed_widgets_widget_type_check CHECK ((widget_type = 'next_launch_card'::text))
);


--
-- Name: faa_launch_match_dirty_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faa_launch_match_dirty_launches (
    launch_id uuid NOT NULL,
    reasons text[] DEFAULT '{}'::text[] NOT NULL,
    first_queued_at timestamp with time zone DEFAULT now() NOT NULL,
    last_queued_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: faa_launch_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faa_launch_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    launch_id uuid,
    faa_tfr_record_id uuid NOT NULL,
    faa_tfr_shape_id uuid,
    match_status text DEFAULT 'unmatched'::text NOT NULL,
    match_confidence integer,
    match_score double precision,
    match_strategy text,
    match_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    match_origin text DEFAULT 'auto'::text NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faa_launch_matches_match_confidence_check CHECK (((match_confidence IS NULL) OR ((match_confidence >= 0) AND (match_confidence <= 100)))),
    CONSTRAINT faa_launch_matches_match_origin_check CHECK ((match_origin = ANY (ARRAY['auto'::text, 'manual'::text]))),
    CONSTRAINT faa_launch_matches_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'ambiguous'::text, 'unmatched'::text, 'manual'::text])))
);


--
-- Name: faa_notam_details; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faa_notam_details (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    notam_id text NOT NULL,
    faa_tfr_record_id uuid,
    source text DEFAULT 'faa_tfr'::text NOT NULL,
    source_url text,
    web_text text,
    notam_text text,
    parsed jsonb DEFAULT '{}'::jsonb NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text NOT NULL,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: faa_tfr_records; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faa_tfr_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT 'faa_tfr'::text NOT NULL,
    source_key text NOT NULL,
    notam_id text,
    notam_key text,
    gid text,
    facility text,
    state text,
    type text,
    legal text,
    title text,
    description text,
    is_new boolean,
    mod_date text,
    mod_abs_time text,
    mod_at timestamp with time zone,
    valid_start timestamp with time zone,
    valid_end timestamp with time zone,
    valid_window tstzrange GENERATED ALWAYS AS (tstzrange(valid_start, valid_end, '[)'::text)) STORED,
    has_shape boolean DEFAULT false NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT faa_tfr_records_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'manual'::text])))
);


--
-- Name: faa_tfr_shapes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.faa_tfr_shapes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    faa_tfr_record_id uuid NOT NULL,
    source_shape_id text DEFAULT 'shape'::text NOT NULL,
    geometry jsonb NOT NULL,
    bbox_min_lat double precision,
    bbox_min_lon double precision,
    bbox_max_lat double precision,
    bbox_max_lon double precision,
    point_count integer,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: feedback_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feedback_submissions (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    name text,
    email text NOT NULL,
    message text NOT NULL,
    page_path text NOT NULL,
    source text NOT NULL,
    launch_id text,
    CONSTRAINT feedback_submissions_email_check CHECK ((char_length(email) <= 320)),
    CONSTRAINT feedback_submissions_launch_id_check CHECK (((launch_id IS NULL) OR (char_length(launch_id) <= 128))),
    CONSTRAINT feedback_submissions_message_check CHECK (((char_length(message) >= 5) AND (char_length(message) <= 5000))),
    CONSTRAINT feedback_submissions_name_check CHECK (((name IS NULL) OR (char_length(name) <= 120))),
    CONSTRAINT feedback_submissions_page_path_check CHECK (((char_length(page_path) >= 1) AND (char_length(page_path) <= 300))),
    CONSTRAINT feedback_submissions_source_check CHECK ((source = ANY (ARRAY['launch_card'::text, 'launch_details'::text])))
);


--
-- Name: feedback_submissions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.feedback_submissions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: feedback_submissions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.feedback_submissions_id_seq OWNED BY public.feedback_submissions.id;


--
-- Name: ingestion_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_runs (
    id bigint NOT NULL,
    job_name text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    success boolean,
    stats jsonb,
    error text
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_threshold='100', autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='100');


--
-- Name: ingestion_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ingestion_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ingestion_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ingestion_runs_id_seq OWNED BY public.ingestion_runs.id;


--
-- Name: jep_background_light_cells; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_background_light_cells (
    id bigint NOT NULL,
    observer_feature_key text NOT NULL,
    observer_lat_bucket numeric(6,3),
    observer_lon_bucket numeric(7,3),
    source_key text NOT NULL,
    source_version_id bigint,
    source_fetch_run_id bigint,
    product_key text NOT NULL,
    period_start_date date NOT NULL,
    period_end_date date NOT NULL,
    tile_h integer NOT NULL,
    tile_v integer NOT NULL,
    tile_row_index integer NOT NULL,
    tile_col_index integer NOT NULL,
    radiance_dataset text,
    radiance_nw_cm2_sr double precision,
    radiance_log double precision,
    radiance_stddev_nw_cm2_sr double precision,
    radiance_observation_count integer,
    quality_code integer,
    land_water_code integer,
    normalization_scope text DEFAULT 'tile_land'::text NOT NULL,
    normalization_version text DEFAULT 'percentile_v1'::text NOT NULL,
    radiance_percentile double precision,
    s_anthro double precision,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_background_light_cells_check CHECK ((period_end_date >= period_start_date)),
    CONSTRAINT jep_background_light_cells_observer_feature_key_check CHECK (((char_length(observer_feature_key) >= 1) AND (char_length(observer_feature_key) <= 128))),
    CONSTRAINT jep_background_light_cells_product_key_check CHECK ((product_key = ANY (ARRAY['VNP46A3'::text, 'VNP46A4'::text]))),
    CONSTRAINT jep_background_light_cells_radiance_percentile_check CHECK (((radiance_percentile IS NULL) OR ((radiance_percentile >= (0)::double precision) AND (radiance_percentile <= (1)::double precision)))),
    CONSTRAINT jep_background_light_cells_s_anthro_check CHECK (((s_anthro IS NULL) OR ((s_anthro >= (0)::double precision) AND (s_anthro <= (1)::double precision)))),
    CONSTRAINT jep_background_light_cells_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 64))),
    CONSTRAINT jep_background_light_cells_tile_col_index_check CHECK (((tile_col_index >= 0) AND (tile_col_index <= 2399))),
    CONSTRAINT jep_background_light_cells_tile_h_check CHECK (((tile_h >= 0) AND (tile_h <= 35))),
    CONSTRAINT jep_background_light_cells_tile_row_index_check CHECK (((tile_row_index >= 0) AND (tile_row_index <= 2399))),
    CONSTRAINT jep_background_light_cells_tile_v_check CHECK (((tile_v >= 0) AND (tile_v <= 17)))
);


--
-- Name: jep_background_light_cells_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_background_light_cells_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_background_light_cells_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_background_light_cells_id_seq OWNED BY public.jep_background_light_cells.id;


--
-- Name: jep_corridor_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_corridor_cache (
    id bigint NOT NULL,
    launch_id uuid,
    source text NOT NULL,
    raw_text text,
    parsed_azimuth_deg numeric(6,3),
    polygon_coords jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_corridor_cache_source_check CHECK ((source = ANY (ARRAY['bnm'::text, 'tfr'::text, 'default_table'::text])))
);


--
-- Name: jep_corridor_cache_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_corridor_cache_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_corridor_cache_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_corridor_cache_id_seq OWNED BY public.jep_corridor_cache.id;


--
-- Name: jep_feature_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_feature_snapshots (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    observer_location_hash text NOT NULL,
    observer_feature_key text NOT NULL,
    observer_lat_bucket numeric(6,3),
    observer_lon_bucket numeric(7,3),
    feature_family text NOT NULL,
    model_version text NOT NULL,
    input_hash text NOT NULL,
    trajectory_input_hash text,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    feature_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    snapshot_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_feature_snapshots_feature_family_check CHECK (((char_length(feature_family) >= 1) AND (char_length(feature_family) <= 64))),
    CONSTRAINT jep_feature_snapshots_input_hash_check CHECK (((char_length(input_hash) >= 1) AND (char_length(input_hash) <= 128))),
    CONSTRAINT jep_feature_snapshots_model_version_check CHECK (((char_length(model_version) >= 1) AND (char_length(model_version) <= 64))),
    CONSTRAINT jep_feature_snapshots_observer_feature_key_check CHECK (((char_length(observer_feature_key) >= 1) AND (char_length(observer_feature_key) <= 128))),
    CONSTRAINT jep_feature_snapshots_observer_location_hash_check CHECK (((char_length(observer_location_hash) >= 1) AND (char_length(observer_location_hash) <= 64)))
);


--
-- Name: jep_feature_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_feature_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_feature_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_feature_snapshots_id_seq OWNED BY public.jep_feature_snapshots.id;


--
-- Name: jep_horizon_masks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_horizon_masks (
    observer_feature_key text NOT NULL,
    observer_lat_bucket numeric(8,4) NOT NULL,
    observer_lon_bucket numeric(9,4) NOT NULL,
    observer_cell_deg numeric(5,3) NOT NULL,
    azimuth_step_deg numeric(5,3) NOT NULL,
    terrain_mask_profile jsonb DEFAULT '[]'::jsonb NOT NULL,
    building_mask_profile jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_mask_profile jsonb DEFAULT '[]'::jsonb NOT NULL,
    dominant_source_profile jsonb DEFAULT '[]'::jsonb NOT NULL,
    dominant_distance_m_profile jsonb DEFAULT '[]'::jsonb NOT NULL,
    dem_source_key text,
    dem_source_version_id bigint,
    dem_release_id text,
    building_source_key text,
    building_source_version_id bigint,
    building_release_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: jep_moon_ephemerides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_moon_ephemerides (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    observer_location_hash text NOT NULL,
    observer_feature_key text NOT NULL,
    observer_lat_bucket numeric(6,3),
    observer_lon_bucket numeric(7,3),
    observer_elev_m integer,
    sample_at timestamp with time zone NOT NULL,
    sample_offset_sec integer DEFAULT 0 NOT NULL,
    source_key text NOT NULL,
    source_version_id bigint,
    source_fetch_run_id bigint,
    qa_source_key text,
    qa_version_id bigint,
    qa_fetch_run_id bigint,
    moon_az_deg numeric(7,3),
    moon_el_deg numeric(7,3),
    moon_illum_frac numeric(7,5),
    moon_phase_name text,
    moon_phase_angle_deg numeric(7,3),
    moonrise_utc timestamp with time zone,
    moonset_utc timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    confidence_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_moon_ephemerides_moon_illum_frac_check CHECK (((moon_illum_frac IS NULL) OR ((moon_illum_frac >= (0)::numeric) AND (moon_illum_frac <= (1)::numeric)))),
    CONSTRAINT jep_moon_ephemerides_observer_feature_key_check CHECK (((char_length(observer_feature_key) >= 1) AND (char_length(observer_feature_key) <= 128))),
    CONSTRAINT jep_moon_ephemerides_observer_location_hash_check CHECK (((char_length(observer_location_hash) >= 1) AND (char_length(observer_location_hash) <= 64))),
    CONSTRAINT jep_moon_ephemerides_qa_source_key_check CHECK (((qa_source_key IS NULL) OR ((char_length(qa_source_key) >= 1) AND (char_length(qa_source_key) <= 64)))),
    CONSTRAINT jep_moon_ephemerides_sample_offset_sec_check CHECK (((sample_offset_sec >= '-86400'::integer) AND (sample_offset_sec <= 86400))),
    CONSTRAINT jep_moon_ephemerides_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 64)))
);


--
-- Name: jep_moon_ephemerides_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_moon_ephemerides_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_moon_ephemerides_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_moon_ephemerides_id_seq OWNED BY public.jep_moon_ephemerides.id;


--
-- Name: jep_observer_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_observer_locations (
    observer_location_hash text NOT NULL,
    lat_bucket numeric(6,3) NOT NULL,
    lon_bucket numeric(6,3) NOT NULL,
    source text DEFAULT 'request'::text NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_observer_locations_lat_bucket_check CHECK (((lat_bucket >= ('-90'::integer)::numeric) AND (lat_bucket <= (90)::numeric))),
    CONSTRAINT jep_observer_locations_lon_bucket_check CHECK (((lon_bucket >= ('-180'::integer)::numeric) AND (lon_bucket <= (180)::numeric)))
);


--
-- Name: jep_outcome_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_outcome_reports (
    id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    launch_id uuid NOT NULL,
    user_id uuid,
    reporter_hash text NOT NULL,
    observer_location_hash text NOT NULL,
    observer_lat_bucket numeric(6,3),
    observer_lon_bucket numeric(7,3),
    observer_personalized boolean DEFAULT false NOT NULL,
    outcome text NOT NULL,
    source text DEFAULT 'curated_import'::text NOT NULL,
    report_mode text NOT NULL,
    reported_score smallint NOT NULL,
    reported_probability numeric(6,5) NOT NULL,
    calibration_band text NOT NULL,
    model_version text NOT NULL,
    score_computed_at timestamp with time zone,
    trajectory_authority_tier text,
    trajectory_quality_state text,
    trajectory_confidence_tier text,
    trajectory_safe_mode boolean DEFAULT false NOT NULL,
    trajectory_evidence_epoch timestamp with time zone,
    CONSTRAINT jep_outcome_reports_calibration_band_check CHECK ((calibration_band = ANY (ARRAY['VERY_LOW'::text, 'LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'VERY_HIGH'::text, 'UNKNOWN'::text]))),
    CONSTRAINT jep_outcome_reports_model_version_check CHECK (((char_length(model_version) >= 1) AND (char_length(model_version) <= 64))),
    CONSTRAINT jep_outcome_reports_observer_location_hash_check CHECK (((char_length(observer_location_hash) >= 3) AND (char_length(observer_location_hash) <= 64))),
    CONSTRAINT jep_outcome_reports_outcome_check CHECK ((outcome = ANY (ARRAY['seen'::text, 'not_seen'::text, 'not_observable'::text]))),
    CONSTRAINT jep_outcome_reports_report_mode_check CHECK ((report_mode = ANY (ARRAY['watchability'::text, 'probability'::text]))),
    CONSTRAINT jep_outcome_reports_reported_probability_check CHECK (((reported_probability >= (0)::numeric) AND (reported_probability <= (1)::numeric))),
    CONSTRAINT jep_outcome_reports_reported_score_check CHECK (((reported_score >= 0) AND (reported_score <= 100))),
    CONSTRAINT jep_outcome_reports_reporter_hash_check CHECK (((char_length(reporter_hash) >= 16) AND (char_length(reporter_hash) <= 64))),
    CONSTRAINT jep_outcome_reports_source_check CHECK ((source = ANY (ARRAY['curated_import'::text, 'admin_manual'::text]))),
    CONSTRAINT jep_outcome_reports_trajectory_authority_tier_check CHECK (((trajectory_authority_tier IS NULL) OR (trajectory_authority_tier = ANY (ARRAY['partner_feed'::text, 'official_numeric'::text, 'regulatory_constrained'::text, 'supplemental_ephemeris'::text, 'public_metadata'::text, 'model_prior'::text])))),
    CONSTRAINT jep_outcome_reports_trajectory_confidence_tier_check CHECK (((trajectory_confidence_tier IS NULL) OR (trajectory_confidence_tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT jep_outcome_reports_trajectory_quality_state_check CHECK (((trajectory_quality_state IS NULL) OR (trajectory_quality_state = ANY (ARRAY['precision'::text, 'guided'::text, 'search'::text, 'pad_only'::text]))))
);


--
-- Name: jep_outcome_reports_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_outcome_reports_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_outcome_reports_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_outcome_reports_id_seq OWNED BY public.jep_outcome_reports.id;


--
-- Name: jep_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_profiles (
    id bigint NOT NULL,
    vehicle_slug text NOT NULL,
    mission_type text NOT NULL,
    profile_json jsonb NOT NULL,
    source_flight_count integer,
    confidence text DEFAULT 'MEDIUM'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_profiles_confidence_check CHECK ((confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text])))
);


--
-- Name: jep_profiles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_profiles_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_profiles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_profiles_id_seq OWNED BY public.jep_profiles.id;


--
-- Name: jep_source_fetch_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_source_fetch_runs (
    id bigint NOT NULL,
    source_key text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    trigger_mode text DEFAULT 'scheduled'::text NOT NULL,
    version_id bigint,
    request_ref text,
    asset_count integer DEFAULT 0 NOT NULL,
    row_count bigint DEFAULT 0 NOT NULL,
    error_text text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_source_fetch_runs_asset_count_check CHECK ((asset_count >= 0)),
    CONSTRAINT jep_source_fetch_runs_check CHECK (((completed_at IS NULL) OR (completed_at >= started_at))),
    CONSTRAINT jep_source_fetch_runs_row_count_check CHECK ((row_count >= 0)),
    CONSTRAINT jep_source_fetch_runs_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 64))),
    CONSTRAINT jep_source_fetch_runs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text]))),
    CONSTRAINT jep_source_fetch_runs_trigger_mode_check CHECK ((trigger_mode = ANY (ARRAY['scheduled'::text, 'manual'::text, 'backfill'::text, 'retry'::text])))
);


--
-- Name: jep_source_fetch_runs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_source_fetch_runs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_source_fetch_runs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_source_fetch_runs_id_seq OWNED BY public.jep_source_fetch_runs.id;


--
-- Name: jep_source_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_source_versions (
    id bigint NOT NULL,
    source_key text NOT NULL,
    version_key text NOT NULL,
    version_label text,
    upstream_url text,
    content_hash text,
    release_at timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_source_versions_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 64))),
    CONSTRAINT jep_source_versions_version_key_check CHECK (((char_length(version_key) >= 1) AND (char_length(version_key) <= 128)))
);


--
-- Name: jep_source_versions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.jep_source_versions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: jep_source_versions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.jep_source_versions_id_seq OWNED BY public.jep_source_versions.id;


--
-- Name: jep_vehicle_priors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.jep_vehicle_priors (
    family_key text NOT NULL,
    family_label text NOT NULL,
    ll2_rocket_config_id integer,
    provider_key text,
    pad_state text,
    rocket_full_name_pattern text,
    rocket_family_pattern text,
    mission_profile_factor double precision DEFAULT 1.0 NOT NULL,
    analyst_confidence text DEFAULT 'medium'::text NOT NULL,
    source_url text NOT NULL,
    source_title text NOT NULL,
    source_revision text,
    rationale text,
    active_from_date date,
    active_to_date date,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT jep_vehicle_priors_analyst_confidence_check CHECK ((analyst_confidence = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT jep_vehicle_priors_check CHECK (((active_to_date IS NULL) OR (active_from_date IS NULL) OR (active_to_date >= active_from_date))),
    CONSTRAINT jep_vehicle_priors_mission_profile_factor_check CHECK (((mission_profile_factor >= (0)::double precision) AND (mission_profile_factor <= (1)::double precision)))
);


--
-- Name: job_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_locks (
    lock_name text NOT NULL,
    locked_until timestamp with time zone NOT NULL,
    locked_by text NOT NULL,
    locked_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: launch_expected_satellite_payloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_expected_satellite_payloads (
    ll2_launch_uuid uuid NOT NULL,
    expected_count integer NOT NULL,
    source_label text,
    source_url text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_expected_satellite_payloads_expected_count_check CHECK (((expected_count > 0) AND (expected_count <= 5000)))
);


--
-- Name: launch_external_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_external_resources (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    source text NOT NULL,
    content_type text NOT NULL,
    source_id text NOT NULL,
    confidence double precision,
    source_hash text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_external_resources_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))))
);


--
-- Name: launch_external_resources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.launch_external_resources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: launch_external_resources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.launch_external_resources_id_seq OWNED BY public.launch_external_resources.id;


--
-- Name: launch_filter_presets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_filter_presets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: launch_jep_score_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_jep_score_candidates (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    observer_location_hash text NOT NULL,
    observer_lat_bucket numeric(8,3),
    observer_lon_bucket numeric(9,3),
    score smallint NOT NULL,
    raw_score numeric(6,3) NOT NULL,
    gate_open boolean DEFAULT false NOT NULL,
    vismap_modifier numeric(4,3) DEFAULT 1.000 NOT NULL,
    baseline_model_version text,
    baseline_score smallint,
    score_delta smallint,
    feature_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    feature_availability jsonb DEFAULT '{}'::jsonb NOT NULL,
    factor_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    compatibility_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    explainability jsonb DEFAULT '{}'::jsonb NOT NULL,
    model_version text NOT NULL,
    input_hash text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    snapshot_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_jep_score_candidates_baseline_score_check CHECK (((baseline_score >= 0) AND (baseline_score <= 100))),
    CONSTRAINT launch_jep_score_candidates_raw_score_check CHECK (((raw_score >= (0)::numeric) AND (raw_score <= (100)::numeric))),
    CONSTRAINT launch_jep_score_candidates_score_check CHECK (((score >= 0) AND (score <= 100))),
    CONSTRAINT launch_jep_score_candidates_vismap_modifier_check CHECK (((vismap_modifier >= (0)::numeric) AND (vismap_modifier <= (1)::numeric)))
);


--
-- Name: launch_jep_score_candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.launch_jep_score_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: launch_jep_score_candidates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.launch_jep_score_candidates_id_seq OWNED BY public.launch_jep_score_candidates.id;


--
-- Name: launch_jep_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_jep_scores (
    launch_id uuid NOT NULL,
    score smallint NOT NULL,
    illumination_factor numeric(4,3) NOT NULL,
    darkness_factor numeric(4,3) NOT NULL,
    los_factor numeric(4,3) NOT NULL,
    weather_factor numeric(4,3) NOT NULL,
    solar_depression_deg numeric(6,3),
    cloud_cover_pct smallint,
    cloud_cover_low_pct smallint,
    time_confidence text DEFAULT 'UNKNOWN'::text NOT NULL,
    trajectory_confidence text DEFAULT 'UNKNOWN'::text NOT NULL,
    weather_confidence text DEFAULT 'UNKNOWN'::text NOT NULL,
    weather_source text,
    azimuth_source text,
    geometry_only_fallback boolean DEFAULT false NOT NULL,
    model_version text DEFAULT 'jep_v1'::text NOT NULL,
    input_hash text NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    observer_location_hash text NOT NULL,
    observer_lat_bucket numeric(6,3),
    observer_lon_bucket numeric(6,3),
    probability numeric(6,5),
    calibration_band text,
    sunlit_margin_km numeric(9,3),
    los_visible_fraction numeric(6,5),
    weather_freshness_min integer,
    explainability jsonb DEFAULT '{}'::jsonb NOT NULL,
    snapshot_at timestamp with time zone,
    cloud_cover_mid_pct smallint,
    cloud_cover_high_pct smallint,
    CONSTRAINT launch_jep_scores_calibration_band_check CHECK (((calibration_band IS NULL) OR (calibration_band = ANY (ARRAY['VERY_LOW'::text, 'LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'VERY_HIGH'::text, 'UNKNOWN'::text])))),
    CONSTRAINT launch_jep_scores_darkness_factor_check CHECK (((darkness_factor >= (0)::numeric) AND (darkness_factor <= (1)::numeric))),
    CONSTRAINT launch_jep_scores_illumination_factor_check CHECK (((illumination_factor >= (0)::numeric) AND (illumination_factor <= (1)::numeric))),
    CONSTRAINT launch_jep_scores_los_factor_check CHECK (((los_factor >= (0)::numeric) AND (los_factor <= (1)::numeric))),
    CONSTRAINT launch_jep_scores_score_check CHECK (((score >= 0) AND (score <= 100))),
    CONSTRAINT launch_jep_scores_time_confidence_check CHECK ((time_confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text, 'UNKNOWN'::text]))),
    CONSTRAINT launch_jep_scores_trajectory_confidence_check CHECK ((trajectory_confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text, 'UNKNOWN'::text]))),
    CONSTRAINT launch_jep_scores_weather_confidence_check CHECK ((weather_confidence = ANY (ARRAY['HIGH'::text, 'MEDIUM'::text, 'LOW'::text, 'UNKNOWN'::text]))),
    CONSTRAINT launch_jep_scores_weather_factor_check CHECK (((weather_factor >= (0)::numeric) AND (weather_factor <= (1)::numeric)))
);


--
-- Name: launch_notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_notification_preferences (
    user_id uuid NOT NULL,
    launch_id uuid NOT NULL,
    channel text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    mode text DEFAULT 't_minus'::text NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    t_minus_minutes smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    local_times time without time zone[] DEFAULT '{}'::time without time zone[] NOT NULL,
    notify_status_change boolean DEFAULT false NOT NULL,
    notify_net_change boolean DEFAULT false NOT NULL,
    CONSTRAINT launch_notification_preferences_channel_check CHECK ((channel = 'push'::text)),
    CONSTRAINT launch_notification_preferences_mode_check CHECK ((mode = ANY (ARRAY['t_minus'::text, 'local_time'::text]))),
    CONSTRAINT launch_notification_prefs_local_times_len CHECK ((cardinality(local_times) <= 2)),
    CONSTRAINT launch_notification_prefs_mode_arrays CHECK ((((mode = 't_minus'::text) AND (cardinality(local_times) = 0)) OR ((mode = 'local_time'::text) AND (cardinality(t_minus_minutes) = 0)))),
    CONSTRAINT launch_notification_prefs_t_minus_allowed CHECK ((t_minus_minutes <@ ARRAY[(5)::smallint, (10)::smallint, (15)::smallint, (20)::smallint, (30)::smallint, (45)::smallint, (60)::smallint, (120)::smallint])),
    CONSTRAINT launch_notification_prefs_t_minus_len CHECK ((cardinality(t_minus_minutes) <= 2))
);


--
-- Name: launch_object_inventory_snapshot_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_object_inventory_snapshot_items (
    snapshot_id bigint NOT NULL,
    object_id text NOT NULL,
    norad_cat_id bigint,
    object_name text,
    object_type text NOT NULL,
    ops_status_code text,
    owner text,
    launch_date date,
    launch_site text,
    decay_date date,
    period_min double precision,
    inclination_deg double precision,
    apogee_km double precision,
    perigee_km double precision,
    rcs_m2 double precision,
    data_status_code text,
    orbit_center text,
    orbit_type text,
    CONSTRAINT launch_object_inventory_snapshot_items_object_type_check CHECK ((object_type = ANY (ARRAY['PAY'::text, 'RB'::text, 'DEB'::text, 'UNK'::text])))
);


--
-- Name: launch_object_inventory_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_object_inventory_snapshots (
    id bigint NOT NULL,
    launch_designator text NOT NULL,
    snapshot_hash text NOT NULL,
    object_count integer NOT NULL,
    payload_count integer NOT NULL,
    rb_count integer NOT NULL,
    deb_count integer NOT NULL,
    unk_count integer NOT NULL,
    payloads_filter_count integer NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_object_inventory_snapshots_deb_count_check CHECK ((deb_count >= 0)),
    CONSTRAINT launch_object_inventory_snapshots_object_count_check CHECK ((object_count >= 0)),
    CONSTRAINT launch_object_inventory_snapshots_payload_count_check CHECK ((payload_count >= 0)),
    CONSTRAINT launch_object_inventory_snapshots_payloads_filter_count_check CHECK ((payloads_filter_count >= 0)),
    CONSTRAINT launch_object_inventory_snapshots_rb_count_check CHECK ((rb_count >= 0)),
    CONSTRAINT launch_object_inventory_snapshots_unk_count_check CHECK ((unk_count >= 0))
);


--
-- Name: launch_object_inventory_snapshots_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.launch_object_inventory_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: launch_object_inventory_snapshots_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.launch_object_inventory_snapshots_id_seq OWNED BY public.launch_object_inventory_snapshots.id;


--
-- Name: launch_pad_preview_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_pad_preview_cache (
    pad_key text NOT NULL,
    ll2_pad_id integer,
    launch_id uuid,
    provider text NOT NULL,
    source_latitude double precision NOT NULL,
    source_longitude double precision NOT NULL,
    content_type text NOT NULL,
    image_base64 text NOT NULL,
    byte_size integer NOT NULL,
    content_sha256 text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    soft_refresh_at timestamp with time zone NOT NULL,
    hard_expire_at timestamp with time zone NOT NULL,
    last_accessed_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_pad_preview_cache_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT launch_pad_preview_cache_check CHECK ((soft_refresh_at <= hard_expire_at)),
    CONSTRAINT launch_pad_preview_cache_content_sha256_check CHECK ((content_sha256 <> ''::text)),
    CONSTRAINT launch_pad_preview_cache_content_type_check CHECK ((content_type <> ''::text)),
    CONSTRAINT launch_pad_preview_cache_provider_check CHECK ((provider <> ''::text))
);


--
-- Name: launch_refresh_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_refresh_state (
    cache_key text NOT NULL,
    scope text NOT NULL,
    launch_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_refresh_state_revision_check CHECK ((revision >= 0)),
    CONSTRAINT launch_refresh_state_scope_check CHECK ((scope = ANY (ARRAY['feed_public'::text, 'feed_live'::text, 'detail_public'::text, 'detail_live'::text])))
);


--
-- Name: launch_social_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_social_candidates (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    platform text NOT NULL,
    account_handle text NOT NULL,
    external_post_id text NOT NULL,
    post_url text NOT NULL,
    post_text text NOT NULL,
    posted_at timestamp with time zone,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    dedupe_key text NOT NULL,
    raw_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_social_candidates_platform_check CHECK ((platform = 'x'::text))
);


--
-- Name: launch_social_candidates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.launch_social_candidates ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.launch_social_candidates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: launch_social_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_social_matches (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    platform text NOT NULL,
    external_post_id text NOT NULL,
    post_url text NOT NULL,
    account_handle text NOT NULL,
    score integer NOT NULL,
    confidence text NOT NULL,
    matched_at timestamp with time zone DEFAULT now() NOT NULL,
    match_version text DEFAULT 'v1'::text NOT NULL,
    signals_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_social_matches_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'none'::text]))),
    CONSTRAINT launch_social_matches_platform_check CHECK ((platform = 'x'::text))
);


--
-- Name: launch_social_matches_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.launch_social_matches ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.launch_social_matches_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: launch_trajectory_constraints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_trajectory_constraints (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    source text NOT NULL,
    source_id text,
    constraint_type text NOT NULL,
    data jsonb NOT NULL,
    geometry jsonb,
    confidence double precision,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ingestion_run_id bigint,
    source_hash text,
    extracted_field_map jsonb,
    parse_rule_id text,
    parser_version text,
    license_class text
);


--
-- Name: launch_trajectory_constraints_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.launch_trajectory_constraints_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: launch_trajectory_constraints_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.launch_trajectory_constraints_id_seq OWNED BY public.launch_trajectory_constraints.id;


--
-- Name: launch_trajectory_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_trajectory_products (
    launch_id uuid NOT NULL,
    version text NOT NULL,
    quality integer NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    product jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ingestion_run_id bigint,
    confidence_tier text,
    source_sufficiency jsonb,
    freshness_state text,
    lineage_complete boolean DEFAULT false NOT NULL,
    CONSTRAINT launch_trajectory_products_confidence_tier_check CHECK (((confidence_tier IS NULL) OR (confidence_tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text])))),
    CONSTRAINT launch_trajectory_products_freshness_state_check CHECK (((freshness_state IS NULL) OR (freshness_state = ANY (ARRAY['fresh'::text, 'stale'::text, 'unknown'::text]))))
);


--
-- Name: launch_updates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_updates (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    changed_fields text[] NOT NULL,
    old_values jsonb,
    new_values jsonb,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: launch_updates_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.launch_updates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: launch_updates_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.launch_updates_id_seq OWNED BY public.launch_updates.id;


--
-- Name: launch_weather; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launch_weather (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    launch_id uuid NOT NULL,
    source text DEFAULT 'nws'::text NOT NULL,
    issued_at timestamp with time zone,
    valid_start timestamp with time zone,
    valid_end timestamp with time zone,
    summary text,
    concerns text[],
    probability integer,
    data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT launch_weather_probability_check CHECK (((probability >= 0) AND (probability <= 100)))
);


--
-- Name: launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ll2_launch_uuid uuid NOT NULL,
    name text NOT NULL,
    slug text,
    status_id integer,
    status_name text,
    status_abbrev text,
    net timestamp with time zone,
    net_precision text,
    window_start timestamp with time zone,
    window_end timestamp with time zone,
    provider text,
    vehicle text,
    pad_name text,
    pad_short_code text,
    pad_state text,
    pad_timezone text,
    ll2_agency_id integer,
    ll2_pad_id integer,
    ll2_rocket_config_id integer,
    webcast_live boolean,
    video_url text,
    image_url text,
    image_thumbnail_url text,
    image_credit text,
    image_license_name text,
    image_license_url text,
    image_single_use boolean,
    tier_auto text DEFAULT 'routine'::text NOT NULL,
    tier_override text,
    featured boolean DEFAULT false NOT NULL,
    hidden boolean DEFAULT false NOT NULL,
    last_updated_source timestamp with time zone,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pad_latitude double precision,
    pad_longitude double precision,
    mission_name text,
    mission_description text,
    mission_type text,
    mission_orbit text,
    mission_agencies jsonb,
    mission_info_urls jsonb,
    mission_vid_urls jsonb,
    rocket_full_name text,
    rocket_family text,
    rocket_description text,
    rocket_manufacturer text,
    rocket_reusable boolean,
    rocket_maiden_flight date,
    rocket_leo_capacity integer,
    rocket_gto_capacity integer,
    rocket_launch_mass integer,
    rocket_launch_cost text,
    rocket_info_url text,
    rocket_wiki_url text,
    provider_type text,
    provider_country_code text,
    provider_description text,
    programs jsonb,
    crew jsonb,
    payloads jsonb,
    pad_location_name text,
    pad_country_code text,
    pad_map_url text,
    rocket_image_url text,
    rocket_variant text,
    rocket_length_m double precision,
    rocket_diameter_m double precision,
    launch_info_urls jsonb,
    launch_vid_urls jsonb,
    flightclub_url text,
    hashtag text,
    probability integer,
    hold_reason text,
    fail_reason text,
    provider_logo_url text,
    provider_image_url text,
    rocket_manufacturer_logo_url text,
    rocket_manufacturer_image_url text,
    launch_designator text,
    agency_launch_attempt_count integer,
    agency_launch_attempt_count_year integer,
    location_launch_attempt_count integer,
    location_launch_attempt_count_year integer,
    orbital_launch_attempt_count integer,
    orbital_launch_attempt_count_year integer,
    pad_launch_attempt_count integer,
    pad_launch_attempt_count_year integer,
    pad_turnaround text,
    mission_patches jsonb,
    updates jsonb,
    timeline jsonb,
    weather_concerns text[],
    weather_icon_url text,
    spacex_x_post_id text,
    spacex_x_post_url text,
    spacex_x_post_captured_at timestamp with time zone,
    spacex_x_post_for_date date,
    social_primary_post_id text,
    social_primary_post_url text,
    social_primary_post_platform text,
    social_primary_post_handle text,
    social_primary_post_matched_at timestamp with time zone,
    social_primary_post_for_date date,
    CONSTRAINT launches_tier_auto_check CHECK ((tier_auto = ANY (ARRAY['routine'::text, 'notable'::text, 'major'::text]))),
    CONSTRAINT launches_tier_override_check CHECK ((tier_override = ANY (ARRAY['routine'::text, 'notable'::text, 'major'::text])))
);


--
-- Name: launches_public_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.launches_public_cache (
    launch_id uuid NOT NULL,
    name text NOT NULL,
    provider text,
    vehicle text,
    net timestamp with time zone,
    net_precision text,
    window_start timestamp with time zone,
    window_end timestamp with time zone,
    status_name text,
    status_abbrev text,
    tier text NOT NULL,
    featured boolean NOT NULL,
    pad_name text,
    pad_state_code text,
    location_name text,
    image_thumbnail_url text,
    webcast_live boolean,
    video_url text,
    cache_generated_at timestamp with time zone DEFAULT now() NOT NULL,
    pad_short_code text,
    pad_timezone text,
    mission_name text,
    mission_type text,
    mission_orbit text,
    mission_agencies jsonb,
    rocket_full_name text,
    rocket_family text,
    rocket_manufacturer text,
    provider_type text,
    provider_country_code text,
    programs jsonb,
    pad_location_name text,
    pad_country_code text,
    mission_description text,
    mission_info_urls jsonb,
    mission_vid_urls jsonb,
    rocket_description text,
    rocket_reusable boolean,
    rocket_maiden_flight date,
    rocket_leo_capacity integer,
    rocket_gto_capacity integer,
    rocket_launch_mass integer,
    rocket_launch_cost text,
    rocket_info_url text,
    rocket_wiki_url text,
    provider_description text,
    crew jsonb,
    payloads jsonb,
    pad_map_url text,
    rocket_image_url text,
    rocket_variant text,
    rocket_length_m double precision,
    rocket_diameter_m double precision,
    launch_info_urls jsonb,
    launch_vid_urls jsonb,
    flightclub_url text,
    hashtag text,
    probability integer,
    hold_reason text,
    fail_reason text,
    provider_logo_url text,
    provider_image_url text,
    rocket_manufacturer_logo_url text,
    rocket_manufacturer_image_url text,
    launch_designator text,
    agency_launch_attempt_count integer,
    agency_launch_attempt_count_year integer,
    location_launch_attempt_count integer,
    location_launch_attempt_count_year integer,
    orbital_launch_attempt_count integer,
    orbital_launch_attempt_count_year integer,
    pad_launch_attempt_count integer,
    pad_launch_attempt_count_year integer,
    pad_turnaround text,
    mission_patches jsonb,
    updates jsonb,
    timeline jsonb,
    image_url text,
    image_credit text,
    image_license_name text,
    image_license_url text,
    image_single_use boolean,
    weather_concerns text[],
    weather_icon_url text,
    ll2_launch_uuid uuid,
    ll2_agency_id integer,
    ll2_pad_id integer,
    ll2_rocket_config_id integer,
    slug text,
    pad_latitude double precision,
    pad_longitude double precision,
    spacex_x_post_id text,
    spacex_x_post_url text,
    spacex_x_post_captured_at timestamp with time zone,
    spacex_x_post_for_date date,
    social_primary_post_id text,
    social_primary_post_url text,
    social_primary_post_platform text,
    social_primary_post_handle text,
    social_primary_post_matched_at timestamp with time zone,
    social_primary_post_for_date date,
    hidden boolean DEFAULT false NOT NULL,
    pad_state text
);


--
-- Name: legal_acceptances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legal_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    document_key text NOT NULL,
    document_version text NOT NULL,
    platform text NOT NULL,
    flow text NOT NULL,
    accepted_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT legal_acceptances_document_key_check CHECK ((document_key = ANY (ARRAY['terms_of_service'::text, 'privacy_notice'::text]))),
    CONSTRAINT legal_acceptances_flow_check CHECK ((flow = ANY (ARRAY['premium_onboarding'::text, 'legacy_claim'::text]))),
    CONSTRAINT legal_acceptances_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text])))
);


--
-- Name: ll2_agencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_agencies (
    ll2_agency_id integer NOT NULL,
    name text NOT NULL,
    abbrev text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    type text,
    country_code text,
    description text,
    administrator text,
    founding_year text,
    launchers text,
    spacecraft text,
    parent text,
    image_url text,
    logo_url text,
    featured boolean,
    raw jsonb,
    fetched_at timestamp with time zone
);


--
-- Name: ll2_astronaut_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_astronaut_launches (
    ll2_astronaut_id integer NOT NULL,
    ll2_launch_uuid uuid NOT NULL,
    launch_id uuid,
    role text
);


--
-- Name: ll2_astronauts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_astronauts (
    ll2_astronaut_id integer NOT NULL,
    name text NOT NULL,
    status text,
    type text,
    agency_id integer,
    agency_name text,
    nationality text,
    in_space boolean,
    time_in_space text,
    eva_time text,
    age integer,
    date_of_birth date,
    date_of_death date,
    bio text,
    profile_image text,
    profile_image_thumbnail text,
    twitter text,
    instagram text,
    wiki text,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_catalog_public_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_catalog_public_cache (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    name text NOT NULL,
    slug text,
    description text,
    country_codes text[],
    image_url text,
    data jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
)
WITH (autovacuum_vacuum_scale_factor='0.02', autovacuum_vacuum_threshold='200', autovacuum_analyze_scale_factor='0.02', autovacuum_analyze_threshold='200');


--
-- Name: ll2_docking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_docking_events (
    ll2_docking_event_id integer NOT NULL,
    launch_id text,
    docking timestamp with time zone,
    departure timestamp with time zone,
    flight_vehicle jsonb,
    docking_location jsonb,
    space_station_id integer,
    space_station_name text,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_event_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_event_launches (
    ll2_event_id integer NOT NULL,
    launch_id uuid NOT NULL
);


--
-- Name: ll2_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_events (
    ll2_event_id integer NOT NULL,
    name text NOT NULL,
    slug text,
    description text,
    type_id integer,
    type_name text,
    date timestamp with time zone,
    date_precision text,
    duration text,
    location_id integer,
    location_name text,
    location_country_code text,
    webcast_live boolean,
    image_url text,
    image_credit text,
    image_license_name text,
    image_license_url text,
    image_single_use boolean,
    info_urls jsonb,
    vid_urls jsonb,
    updates jsonb,
    url text,
    last_updated_source timestamp with time zone,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_expeditions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_expeditions (
    ll2_expedition_id integer NOT NULL,
    name text NOT NULL,
    start_time timestamp with time zone,
    end_time timestamp with time zone,
    space_station_id integer,
    mission_patches jsonb,
    spacewalks jsonb,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_landings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_landings (
    ll2_landing_id integer NOT NULL,
    attempt boolean,
    success boolean,
    description text,
    downrange_distance_km double precision,
    landing_location jsonb,
    landing_type jsonb,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_launch_landings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_launch_landings (
    ll2_launch_uuid uuid NOT NULL,
    launch_id uuid,
    ll2_landing_id integer NOT NULL,
    landing_role text DEFAULT 'unknown'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ll2_launch_landings_role_check CHECK ((landing_role = ANY (ARRAY['booster'::text, 'spacecraft'::text, 'unknown'::text])))
);


--
-- Name: ll2_launcher_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_launcher_launches (
    ll2_launcher_id integer NOT NULL,
    ll2_launch_uuid uuid NOT NULL,
    launch_id uuid
);


--
-- Name: ll2_launchers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_launchers (
    ll2_launcher_id integer NOT NULL,
    serial_number text,
    flight_proven boolean,
    status text,
    details text,
    image_url text,
    launcher_config_id integer,
    flights jsonb,
    first_launch_date date,
    last_launch_date date,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_locations (
    ll2_location_id integer NOT NULL,
    name text NOT NULL,
    country_code text,
    timezone_name text,
    latitude double precision,
    longitude double precision,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    description text,
    map_image text,
    total_launch_count integer,
    total_landing_count integer,
    raw jsonb,
    fetched_at timestamp with time zone
);


--
-- Name: ll2_pads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_pads (
    ll2_pad_id integer NOT NULL,
    ll2_location_id integer NOT NULL,
    name text NOT NULL,
    latitude double precision,
    longitude double precision,
    state_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    agency_id text,
    description text,
    info_url text,
    wiki_url text,
    map_url text,
    map_image text,
    country_code text,
    total_launch_count integer,
    orbital_launch_attempt_count integer,
    raw jsonb,
    fetched_at timestamp with time zone
);


--
-- Name: ll2_payload_flight_docking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_payload_flight_docking_events (
    ll2_payload_flight_id integer NOT NULL,
    ll2_docking_event_id integer NOT NULL,
    docking timestamp with time zone,
    departure timestamp with time zone,
    docking_location jsonb,
    space_station jsonb,
    flight_vehicle jsonb,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_payload_flights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_payload_flights (
    ll2_payload_flight_id integer NOT NULL,
    ll2_launch_uuid uuid NOT NULL,
    launch_id uuid,
    ll2_payload_id integer,
    url text,
    destination text,
    amount integer,
    ll2_landing_id integer,
    active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_payload_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_payload_types (
    ll2_payload_type_id integer NOT NULL,
    name text NOT NULL,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_payloads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_payloads (
    ll2_payload_id integer NOT NULL,
    name text NOT NULL,
    description text,
    payload_type_id integer,
    manufacturer_id integer,
    operator_id integer,
    wiki_link text,
    info_link text,
    cost_usd integer,
    mass_kg double precision,
    program jsonb,
    image_url text,
    thumbnail_url text,
    image_credit text,
    image_license_name text,
    image_license_url text,
    image_single_use boolean,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_rocket_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_rocket_configs (
    ll2_config_id integer NOT NULL,
    name text NOT NULL,
    full_name text,
    family text,
    manufacturer text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    variant text,
    reusable boolean,
    image_url text,
    info_url text,
    wiki_url text,
    manufacturer_id integer,
    raw jsonb,
    fetched_at timestamp with time zone
);


--
-- Name: ll2_space_stations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_space_stations (
    ll2_space_station_id integer NOT NULL,
    name text NOT NULL,
    status text,
    type text,
    founded date,
    deorbited date,
    description text,
    orbit text,
    owners jsonb,
    active_expeditions jsonb,
    image_url text,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_spacecraft_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_spacecraft_configs (
    ll2_spacecraft_config_id integer NOT NULL,
    name text NOT NULL,
    spacecraft_type_id integer,
    agency_id integer,
    family text,
    in_use boolean,
    image_url text,
    thumbnail_url text,
    image_credit text,
    image_license_name text,
    image_license_url text,
    image_single_use boolean,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_spacecraft_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_spacecraft_configurations (
    ll2_spacecraft_config_id integer NOT NULL,
    name text NOT NULL,
    agency_id integer,
    agency_name text,
    in_use boolean,
    capability text,
    maiden_flight date,
    human_rated boolean,
    crew_capacity integer,
    image_url text,
    nation_url text,
    wiki_url text,
    info_url text,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_spacecraft_flight_docking_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_spacecraft_flight_docking_events (
    ll2_spacecraft_flight_id integer NOT NULL,
    ll2_docking_event_id integer NOT NULL,
    docking timestamp with time zone,
    departure timestamp with time zone,
    docking_location jsonb,
    space_station jsonb,
    flight_vehicle jsonb,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_spacecraft_flights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_spacecraft_flights (
    ll2_spacecraft_flight_id integer NOT NULL,
    ll2_launch_uuid uuid NOT NULL,
    launch_id uuid,
    ll2_spacecraft_id integer,
    url text,
    destination text,
    mission_end timestamp with time zone,
    duration text,
    turn_around_time text,
    ll2_landing_id integer,
    launch_crew jsonb,
    onboard_crew jsonb,
    landing_crew jsonb,
    active boolean DEFAULT true NOT NULL,
    last_seen_at timestamp with time zone,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_spacecraft_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_spacecraft_types (
    ll2_spacecraft_type_id integer NOT NULL,
    name text NOT NULL,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ll2_spacecrafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ll2_spacecrafts (
    ll2_spacecraft_id integer NOT NULL,
    name text NOT NULL,
    serial_number text,
    description text,
    status jsonb,
    in_space boolean,
    spacecraft_config_id integer,
    image_url text,
    thumbnail_url text,
    image_credit text,
    image_license_name text,
    image_license_url text,
    image_single_use boolean,
    raw jsonb,
    fetched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: managed_scheduler_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managed_scheduler_jobs (
    cron_job_name text NOT NULL,
    edge_job_slug text NOT NULL,
    interval_seconds integer NOT NULL,
    offset_seconds integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    next_run_at timestamp with time zone DEFAULT now() NOT NULL,
    last_enqueued_at timestamp with time zone,
    last_dispatched_at timestamp with time zone,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT managed_scheduler_jobs_interval_seconds_check CHECK (((interval_seconds >= 60) AND (interval_seconds <= 604800))),
    CONSTRAINT managed_scheduler_jobs_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10))),
    CONSTRAINT managed_scheduler_jobs_offset_lt_interval CHECK ((offset_seconds < interval_seconds)),
    CONSTRAINT managed_scheduler_jobs_offset_seconds_check CHECK ((offset_seconds >= 0))
);


--
-- Name: managed_scheduler_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.managed_scheduler_queue (
    id bigint NOT NULL,
    cron_job_name text NOT NULL,
    edge_job_slug text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    error text,
    locked_at timestamp with time zone,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT managed_scheduler_queue_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10))),
    CONSTRAINT managed_scheduler_queue_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: managed_scheduler_queue_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.managed_scheduler_queue ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.managed_scheduler_queue_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: mobile_auth_risk_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_auth_risk_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    event_type text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: mobile_auth_risk_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_auth_risk_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flow text NOT NULL,
    platform text NOT NULL,
    email_hash text NOT NULL,
    installation_hash text NOT NULL,
    attestation_provider text NOT NULL,
    attestation_status text NOT NULL,
    app_version text,
    build_profile text,
    disposition text NOT NULL,
    reason_code text,
    challenge_completed_at timestamp with time zone,
    challenge_expires_at timestamp with time zone,
    used_at timestamp with time zone,
    result text,
    result_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    CONSTRAINT mobile_auth_risk_sessions_disposition_check CHECK ((disposition = ANY (ARRAY['silent_turnstile'::text, 'visible_turnstile'::text, 'deny'::text]))),
    CONSTRAINT mobile_auth_risk_sessions_flow_check CHECK ((flow = ANY (ARRAY['sign_in'::text, 'sign_up'::text, 'resend'::text, 'recover'::text]))),
    CONSTRAINT mobile_auth_risk_sessions_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);


--
-- Name: mobile_push_installations_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_push_installations_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_kind text NOT NULL,
    user_id uuid,
    installation_id text NOT NULL,
    platform text NOT NULL,
    push_provider text NOT NULL,
    token text NOT NULL,
    app_version text,
    device_name text,
    device_secret_hash text,
    is_active boolean DEFAULT true NOT NULL,
    last_registered_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone,
    last_receipt_at timestamp with time zone,
    last_failure_reason text,
    disabled_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    locked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mobile_push_installations_v2_owner_check CHECK ((((owner_kind = 'guest'::text) AND (user_id IS NULL) AND (device_secret_hash IS NOT NULL)) OR ((owner_kind = 'user'::text) AND (user_id IS NOT NULL)))),
    CONSTRAINT mobile_push_installations_v2_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['guest'::text, 'user'::text]))),
    CONSTRAINT mobile_push_installations_v2_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text]))),
    CONSTRAINT mobile_push_installations_v2_push_provider_check CHECK ((push_provider = 'expo'::text))
);


--
-- Name: mobile_push_outbox_v2_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.mobile_push_outbox_v2_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: mobile_push_outbox_v2_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.mobile_push_outbox_v2_id_seq OWNED BY public.mobile_push_outbox_v2.id;


--
-- Name: mobile_push_rules_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mobile_push_rules_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_kind text NOT NULL,
    user_id uuid,
    installation_id text,
    scope_kind text NOT NULL,
    state text,
    launch_id uuid,
    filter_preset_id uuid,
    follow_rule_type text,
    follow_rule_value text,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    prelaunch_offsets_minutes smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    daily_digest_local_time text,
    status_change_types text[] DEFAULT '{}'::text[] NOT NULL,
    notify_net_change boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mobile_push_rules_v2_follow_rule_type_check CHECK ((follow_rule_type = ANY (ARRAY['launch'::text, 'pad'::text, 'provider'::text, 'tier'::text]))),
    CONSTRAINT mobile_push_rules_v2_owner_check CHECK ((((owner_kind = 'guest'::text) AND (user_id IS NULL) AND (installation_id IS NOT NULL)) OR ((owner_kind = 'user'::text) AND (user_id IS NOT NULL) AND (installation_id IS NULL)))),
    CONSTRAINT mobile_push_rules_v2_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['guest'::text, 'user'::text]))),
    CONSTRAINT mobile_push_rules_v2_scope_check CHECK ((((scope_kind = 'all_us'::text) AND (state IS NULL) AND (launch_id IS NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((scope_kind = 'state'::text) AND (state IS NOT NULL) AND (launch_id IS NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((scope_kind = 'launch'::text) AND (state IS NULL) AND (launch_id IS NOT NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((scope_kind = 'all_launches'::text) AND (state IS NULL) AND (launch_id IS NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((scope_kind = 'preset'::text) AND (state IS NULL) AND (launch_id IS NULL) AND (filter_preset_id IS NOT NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((scope_kind = 'follow'::text) AND (state IS NULL) AND (launch_id IS NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NOT NULL) AND (follow_rule_value IS NOT NULL)))),
    CONSTRAINT mobile_push_rules_v2_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['all_us'::text, 'state'::text, 'launch'::text, 'all_launches'::text, 'preset'::text, 'follow'::text])))
);


--
-- Name: navcen_bnm_hazard_areas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.navcen_bnm_hazard_areas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    message_id uuid NOT NULL,
    navcen_guid text NOT NULL,
    area_name text NOT NULL,
    valid_start timestamp with time zone,
    valid_end timestamp with time zone,
    valid_window tstzrange GENERATED ALWAYS AS (tstzrange(valid_start, valid_end, '[)'::text)) STORED,
    geometry jsonb,
    confidence integer,
    raw_text_snippet text,
    data jsonb,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    match_status text DEFAULT 'unmatched'::text NOT NULL,
    matched_launch_id uuid,
    match_confidence integer,
    match_strategy text,
    match_meta jsonb,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT navcen_bnm_hazard_areas_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= 0) AND (confidence <= 100)))),
    CONSTRAINT navcen_bnm_hazard_areas_match_confidence_check CHECK (((match_confidence IS NULL) OR ((match_confidence >= 0) AND (match_confidence <= 100)))),
    CONSTRAINT navcen_bnm_hazard_areas_match_status_check CHECK ((match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'ambiguous'::text, 'manual'::text])))
);


--
-- Name: navcen_bnm_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.navcen_bnm_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT 'navcen'::text NOT NULL,
    district integer DEFAULT 7 NOT NULL,
    navcen_guid text NOT NULL,
    message_url text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    http_status integer,
    etag text,
    last_modified timestamp with time zone,
    sha256 text NOT NULL,
    bytes integer,
    rss_feed_url text,
    govdelivery_topic_id text,
    govdelivery_bulletin_url text,
    rss_item_title text,
    rss_item_published_at timestamp with time zone,
    title text,
    category text,
    issued_at timestamp with time zone,
    valid_start timestamp with time zone,
    valid_end timestamp with time zone,
    valid_window tstzrange GENERATED ALWAYS AS (tstzrange(valid_start, valid_end, '[)'::text)) STORED,
    raw_text text,
    raw_html text,
    raw jsonb,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notification_alert_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_alert_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    state text,
    filter_preset_id uuid,
    follow_rule_type text,
    follow_rule_value text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_alert_rules_follow_rule_type_check CHECK ((follow_rule_type = ANY (ARRAY['launch'::text, 'pad'::text, 'provider'::text, 'tier'::text]))),
    CONSTRAINT notification_alert_rules_kind_check CHECK ((kind = ANY (ARRAY['region_us'::text, 'state'::text, 'filter_preset'::text, 'follow'::text]))),
    CONSTRAINT notification_alert_rules_kind_scope_check CHECK ((((kind = 'region_us'::text) AND (state IS NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((kind = 'state'::text) AND (state IS NOT NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((kind = 'filter_preset'::text) AND (state IS NULL) AND (filter_preset_id IS NOT NULL) AND (follow_rule_type IS NULL) AND (follow_rule_value IS NULL)) OR ((kind = 'follow'::text) AND (state IS NULL) AND (filter_preset_id IS NULL) AND (follow_rule_type IS NOT NULL) AND (follow_rule_value IS NOT NULL))))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL,
    quiet_hours_enabled boolean DEFAULT false NOT NULL,
    quiet_start_local time without time zone,
    quiet_end_local time without time zone,
    notify_t_minus_60 boolean DEFAULT true NOT NULL,
    notify_t_minus_10 boolean DEFAULT true NOT NULL,
    notify_liftoff boolean DEFAULT true NOT NULL,
    notify_status_change boolean DEFAULT true NOT NULL,
    notify_net_change boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notify_t_minus_5 boolean DEFAULT true NOT NULL,
    launch_day_email_enabled boolean DEFAULT false NOT NULL,
    launch_day_email_providers text[] DEFAULT '{}'::text[] NOT NULL,
    launch_day_email_states text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT launch_day_email_filter_limits CHECK (((cardinality(launch_day_email_providers) <= 80) AND (cardinality(launch_day_email_states) <= 80)))
);


--
-- Name: notification_push_destinations_v3; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_push_destinations_v3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_kind text NOT NULL,
    owner_key text NOT NULL,
    user_id uuid,
    installation_id text,
    platform text NOT NULL,
    delivery_kind text NOT NULL,
    push_provider text NOT NULL,
    destination_key text NOT NULL,
    endpoint text,
    p256dh text,
    auth text,
    token text,
    app_version text,
    device_name text,
    user_agent text,
    device_secret_hash text,
    is_active boolean DEFAULT true NOT NULL,
    verified boolean DEFAULT true NOT NULL,
    last_registered_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sent_at timestamp with time zone,
    last_receipt_at timestamp with time zone,
    last_failure_reason text,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_push_destinations_v3_delivery_kind_check CHECK ((delivery_kind = ANY (ARRAY['web_push'::text, 'mobile_push'::text]))),
    CONSTRAINT notification_push_destinations_v3_owner_check CHECK ((((owner_kind = 'guest'::text) AND (user_id IS NULL) AND (installation_id IS NOT NULL) AND (device_secret_hash IS NOT NULL)) OR ((owner_kind = 'user'::text) AND (user_id IS NOT NULL)))),
    CONSTRAINT notification_push_destinations_v3_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['guest'::text, 'user'::text]))),
    CONSTRAINT notification_push_destinations_v3_payload_check CHECK ((((delivery_kind = 'web_push'::text) AND (push_provider = 'webpush'::text) AND (endpoint IS NOT NULL) AND (p256dh IS NOT NULL) AND (auth IS NOT NULL) AND (token IS NULL)) OR ((delivery_kind = 'mobile_push'::text) AND (push_provider = 'expo'::text) AND (token IS NOT NULL) AND (endpoint IS NULL) AND (p256dh IS NULL) AND (auth IS NULL)))),
    CONSTRAINT notification_push_destinations_v3_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text]))),
    CONSTRAINT notification_push_destinations_v3_push_provider_check CHECK ((push_provider = ANY (ARRAY['webpush'::text, 'expo'::text])))
);


--
-- Name: notification_push_devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_push_devices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    platform text NOT NULL,
    push_provider text NOT NULL,
    token text NOT NULL,
    app_version text,
    device_name text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    installation_id text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    disabled_at timestamp with time zone,
    last_registered_at timestamp with time zone,
    last_sent_at timestamp with time zone,
    last_receipt_at timestamp with time zone,
    last_failure_reason text,
    CONSTRAINT notification_push_devices_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text]))),
    CONSTRAINT notification_push_devices_push_provider_check CHECK ((push_provider = ANY (ARRAY['expo'::text, 'webpush'::text])))
);


--
-- Name: notification_rules_v3; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_rules_v3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_kind text NOT NULL,
    owner_key text NOT NULL,
    user_id uuid,
    installation_id text,
    intent text NOT NULL,
    visible_in_following boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    scope_kind text NOT NULL,
    scope_key text NOT NULL,
    launch_id uuid,
    state text,
    provider text,
    rocket_id integer,
    pad_key text,
    launch_site text,
    filter_preset_id uuid,
    filters jsonb,
    tier text,
    channels text[] DEFAULT '{}'::text[] NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    prelaunch_offsets_minutes smallint[] DEFAULT '{}'::smallint[] NOT NULL,
    include_liftoff boolean DEFAULT false NOT NULL,
    daily_digest_local_time text,
    status_change_types text[] DEFAULT '{}'::text[] NOT NULL,
    notify_net_change boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_rules_v3_channels_check CHECK ((channels <@ ARRAY['push'::text, 'email'::text])),
    CONSTRAINT notification_rules_v3_intent_check CHECK ((intent = ANY (ARRAY['follow'::text, 'notifications_only'::text]))),
    CONSTRAINT notification_rules_v3_owner_check CHECK ((((owner_kind = 'guest'::text) AND (user_id IS NULL) AND (installation_id IS NOT NULL)) OR ((owner_kind = 'user'::text) AND (user_id IS NOT NULL) AND (installation_id IS NULL)))),
    CONSTRAINT notification_rules_v3_owner_kind_check CHECK ((owner_kind = ANY (ARRAY['guest'::text, 'user'::text]))),
    CONSTRAINT notification_rules_v3_scope_kind_check CHECK ((scope_kind = ANY (ARRAY['launch'::text, 'state'::text, 'provider'::text, 'rocket'::text, 'pad'::text, 'launch_site'::text, 'preset'::text, 'filter'::text, 'all_us'::text, 'all_launches'::text, 'tier'::text]))),
    CONSTRAINT notification_rules_v3_status_types_check CHECK ((status_change_types <@ ARRAY['any'::text, 'go'::text, 'hold'::text, 'scrubbed'::text, 'tbd'::text]))
);


--
-- Name: notification_usage_monthly; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_usage_monthly (
    user_id uuid NOT NULL,
    month_start date NOT NULL,
    channel text NOT NULL,
    messages_sent integer DEFAULT 0 NOT NULL,
    segments_sent integer DEFAULT 0 NOT NULL,
    CONSTRAINT notification_usage_monthly_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'push'::text])))
);


--
-- Name: notifications_outbox_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_outbox_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_outbox_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_outbox_id_seq OWNED BY public.notifications_outbox.id;


--
-- Name: nws_points; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nws_points (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coord_key text NOT NULL,
    ll2_pad_id integer,
    latitude double precision NOT NULL,
    longitude double precision NOT NULL,
    cwa text,
    grid_id text NOT NULL,
    grid_x integer NOT NULL,
    grid_y integer NOT NULL,
    forecast_url text NOT NULL,
    forecast_hourly_url text NOT NULL,
    forecast_grid_data_url text,
    time_zone text,
    county_url text,
    forecast_zone_url text,
    raw jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ops_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_alerts (
    id bigint NOT NULL,
    key text NOT NULL,
    severity text NOT NULL,
    message text NOT NULL,
    details jsonb,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    occurrences integer DEFAULT 1 NOT NULL,
    resolved boolean DEFAULT false NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT ops_alerts_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'warning'::text, 'critical'::text])))
);


--
-- Name: ops_alerts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ops_alerts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ops_alerts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ops_alerts_id_seq OWNED BY public.ops_alerts.id;


--
-- Name: ops_metrics_samples_1m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_metrics_samples_1m (
    id bigint NOT NULL,
    sampled_at timestamp with time zone NOT NULL,
    metric_key text NOT NULL,
    labels jsonb DEFAULT '{}'::jsonb NOT NULL,
    value double precision NOT NULL,
    source text DEFAULT 'supabase_metrics'::text NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ops_metrics_samples_1m_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ops_metrics_samples_1m_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ops_metrics_samples_1m_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ops_metrics_samples_1m_id_seq OWNED BY public.ops_metrics_samples_1m.id;


--
-- Name: ops_metrics_samples_5m; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_metrics_samples_5m (
    id bigint NOT NULL,
    sampled_at timestamp with time zone NOT NULL,
    metric_key text NOT NULL,
    labels jsonb DEFAULT '{}'::jsonb NOT NULL,
    value double precision NOT NULL,
    source text DEFAULT 'rollup_5m'::text NOT NULL,
    collected_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ops_metrics_samples_5m_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ops_metrics_samples_5m_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ops_metrics_samples_5m_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ops_metrics_samples_5m_id_seq OWNED BY public.ops_metrics_samples_5m.id;


--
-- Name: orbit_elements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orbit_elements (
    id bigint NOT NULL,
    norad_cat_id bigint NOT NULL,
    source text NOT NULL,
    group_or_source text,
    epoch timestamp with time zone NOT NULL,
    inclination_deg double precision,
    raan_deg double precision,
    eccentricity double precision,
    arg_perigee_deg double precision,
    mean_anomaly_deg double precision,
    mean_motion_rev_per_day double precision,
    bstar double precision,
    raw_omm jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    hash text,
    CONSTRAINT orbit_elements_source_check CHECK ((source = ANY (ARRAY['gp'::text, 'supgp'::text])))
);


--
-- Name: orbit_elements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.orbit_elements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: orbit_elements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.orbit_elements_id_seq OWNED BY public.orbit_elements.id;


--
-- Name: premium_claims; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_claims (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    claim_token uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    provider text NOT NULL,
    product_key text DEFAULT 'premium_monthly'::text NOT NULL,
    status text NOT NULL,
    email text,
    return_to text DEFAULT '/account'::text NOT NULL,
    checkout_session_id text,
    provider_event_id text,
    provider_customer_id text,
    provider_subscription_id text,
    provider_product_id text,
    provider_status text,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    current_period_end timestamp with time zone,
    claimed_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT premium_claims_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'apple_app_store'::text, 'google_play'::text]))),
    CONSTRAINT premium_claims_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'verified'::text, 'claimed'::text])))
);


--
-- Name: premium_onboarding_allow_creates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_onboarding_allow_creates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    onboarding_intent_id uuid,
    provider text NOT NULL,
    email text NOT NULL,
    email_normalized text NOT NULL,
    used_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    claim_id uuid,
    CONSTRAINT premium_onboarding_allow_creates_check CHECK ((email_normalized = lower(btrim(email)))),
    CONSTRAINT premium_onboarding_allow_creates_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'apple'::text])))
);


--
-- Name: premium_onboarding_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.premium_onboarding_intents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform text NOT NULL,
    return_to text DEFAULT '/account'::text NOT NULL,
    viewer_id uuid,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    expires_at timestamp with time zone DEFAULT (timezone('utc'::text, now()) + '24:00:00'::interval) NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT premium_onboarding_intents_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text])))
);


--
-- Name: privacy_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.privacy_preferences (
    user_id uuid NOT NULL,
    opt_out_sale_share boolean DEFAULT false NOT NULL,
    opt_out_targeted_ads boolean DEFAULT false NOT NULL,
    limit_sensitive boolean DEFAULT false NOT NULL,
    block_third_party_embeds boolean DEFAULT false NOT NULL,
    gpc_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    user_id uuid NOT NULL,
    email text,
    role text DEFAULT 'user'::text NOT NULL,
    timezone text DEFAULT 'America/New_York'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    first_name text,
    last_name text,
    calendar_token uuid DEFAULT gen_random_uuid() NOT NULL,
    marketing_email_opt_in boolean DEFAULT false NOT NULL,
    marketing_email_opt_in_updated_at timestamp with time zone DEFAULT now() NOT NULL,
    marketing_unsubscribe_token uuid DEFAULT gen_random_uuid() NOT NULL,
    embed_token uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT profiles_role_check CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))
);


--
-- Name: program_contract_story_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_contract_story_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    candidate_key text NOT NULL,
    program_scope text NOT NULL,
    source_type text NOT NULL,
    source_record_key text NOT NULL,
    candidate_story_key text,
    confidence_tier text NOT NULL,
    confidence_score numeric DEFAULT 0 NOT NULL,
    signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    content_hash text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT program_contract_story_candidates_confidence_score_check CHECK (((confidence_score >= (0)::numeric) AND (confidence_score <= (1)::numeric))),
    CONSTRAINT program_contract_story_candidates_confidence_tier_check CHECK ((confidence_tier = ANY (ARRAY['exact'::text, 'candidate'::text, 'discovery-only'::text]))),
    CONSTRAINT program_contract_story_candidates_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'spacex'::text, 'blue-origin'::text]))),
    CONSTRAINT program_contract_story_candidates_source_type_check CHECK ((source_type = ANY (ARRAY['sam-contract-award'::text, 'sam-opportunity'::text]))),
    CONSTRAINT program_contract_story_candidates_status_check CHECK ((status = ANY (ARRAY['active'::text, 'promoted'::text, 'suppressed'::text])))
);


--
-- Name: program_contract_story_discoveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_contract_story_discoveries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    discovery_key text NOT NULL,
    program_scope text NOT NULL,
    source_type text NOT NULL,
    source_record_key text NOT NULL,
    title text,
    summary text,
    entity_name text,
    agency_name text,
    piid text,
    solicitation_id text,
    notice_id text,
    usaspending_award_id text,
    source_url text,
    published_at timestamp with time zone,
    amount numeric,
    join_status text DEFAULT 'unlinked'::text NOT NULL,
    best_candidate_story_key text,
    relevance_score numeric DEFAULT 0 NOT NULL,
    relevance_signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_document_id uuid,
    content_hash text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT program_contract_story_discoveries_join_status_check CHECK ((join_status = ANY (ARRAY['unlinked'::text, 'candidate'::text, 'linked'::text, 'suppressed'::text]))),
    CONSTRAINT program_contract_story_discoveries_relevance_score_check CHECK (((relevance_score >= (0)::numeric) AND (relevance_score <= (1)::numeric))),
    CONSTRAINT program_contract_story_discoveries_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'spacex'::text, 'blue-origin'::text]))),
    CONSTRAINT program_contract_story_discoveries_source_type_check CHECK ((source_type = ANY (ARRAY['sam-contract-award'::text, 'sam-opportunity'::text])))
);


--
-- Name: program_contract_story_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_contract_story_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    story_key text NOT NULL,
    program_scope text NOT NULL,
    primary_usaspending_award_id text,
    primary_piid text,
    primary_contract_key text,
    primary_solicitation_id text,
    primary_notice_id text,
    mission_key text,
    recipient text,
    title text,
    awarded_on date,
    obligated_amount numeric,
    match_strategy text NOT NULL,
    match_confidence numeric DEFAULT 0 NOT NULL,
    match_evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_count integer DEFAULT 0 NOT NULL,
    notice_count integer DEFAULT 0 NOT NULL,
    spending_point_count integer DEFAULT 0 NOT NULL,
    bidder_count integer DEFAULT 0 NOT NULL,
    latest_action_date date,
    latest_notice_date date,
    latest_spending_fiscal_year integer,
    latest_spending_fiscal_month integer,
    has_full_story boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    content_hash text,
    CONSTRAINT program_contract_story_links_match_confidence_check CHECK (((match_confidence >= (0)::numeric) AND (match_confidence <= (1)::numeric))),
    CONSTRAINT program_contract_story_links_match_strategy_check CHECK ((match_strategy = ANY (ARRAY['exact_award_id'::text, 'exact_piid'::text, 'exact_solicitation'::text, 'heuristic_multi_signal'::text]))),
    CONSTRAINT program_contract_story_links_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'spacex'::text, 'blue-origin'::text])))
);


--
-- Name: program_contract_story_source_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_contract_story_source_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    story_key text NOT NULL,
    program_scope text NOT NULL,
    source_type text NOT NULL,
    source_record_key text NOT NULL,
    title text,
    summary text,
    entity_name text,
    agency_name text,
    piid text,
    solicitation_id text,
    notice_id text,
    usaspending_award_id text,
    source_url text,
    published_at timestamp with time zone,
    amount numeric,
    source_document_id uuid,
    content_hash text DEFAULT ''::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT program_contract_story_source_links_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'spacex'::text, 'blue-origin'::text]))),
    CONSTRAINT program_contract_story_source_links_source_type_check CHECK ((source_type = ANY (ARRAY['usaspending-award'::text, 'sam-contract-award'::text, 'sam-opportunity'::text])))
);


--
-- Name: program_usaspending_scope_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.program_usaspending_scope_reviews (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    award_identity_key text NOT NULL,
    usaspending_award_id text,
    program_scope text NOT NULL,
    auto_tier text NOT NULL,
    final_tier text,
    review_status text DEFAULT 'unreviewed'::text NOT NULL,
    reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
    signal_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
    live_source_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    audit_version text DEFAULT ''::text NOT NULL,
    review_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT program_usaspending_scope_reviews_auto_tier_check CHECK ((auto_tier = ANY (ARRAY['exact'::text, 'candidate'::text, 'excluded'::text]))),
    CONSTRAINT program_usaspending_scope_reviews_final_tier_check CHECK (((final_tier IS NULL) OR (final_tier = ANY (ARRAY['exact'::text, 'candidate'::text, 'excluded'::text])))),
    CONSTRAINT program_usaspending_scope_reviews_program_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'spacex'::text, 'blue-origin'::text]))),
    CONSTRAINT program_usaspending_scope_reviews_status_check CHECK ((review_status = ANY (ARRAY['unreviewed'::text, 'confirmed'::text, 'suppressed'::text])))
);


--
-- Name: program_usaspending_audited_awards; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.program_usaspending_audited_awards WITH (security_invoker='true') AS
 SELECT a.id,
    public.program_usaspending_award_identity_key(a.usaspending_award_id, a.award_title, a.recipient, a.awarded_on, a.metadata) AS award_identity_key,
    a.usaspending_award_id,
    a.award_title,
    a.recipient,
    a.obligated_amount,
    a.awarded_on,
    a.mission_key,
    a.source_document_id,
    a.metadata,
    a.updated_at,
    lower(COALESCE((a.metadata ->> 'programScope'::text), (a.metadata ->> 'program_scope'::text))) AS raw_program_scope,
    r.program_scope,
    r.auto_tier,
    r.final_tier,
        CASE
            WHEN (r.review_status = 'suppressed'::text) THEN 'excluded'::text
            ELSE COALESCE(r.final_tier, r.auto_tier)
        END AS scope_tier,
    r.review_status,
    r.reason_codes,
    r.signal_snapshot,
    r.live_source_snapshot,
    r.audit_version
   FROM (public.artemis_procurement_awards a
     JOIN public.program_usaspending_scope_reviews r ON ((r.award_identity_key = public.program_usaspending_award_identity_key(a.usaspending_award_id, a.award_title, a.recipient, a.awarded_on, a.metadata))));


--
-- Name: providers_public_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.providers_public_cache (
    provider_key text NOT NULL,
    name text NOT NULL,
    provider_type text,
    provider_country_code text,
    provider_description text,
    provider_logo_url text,
    provider_image_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: purchase_entitlements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_entitlements (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    entitlement_key text DEFAULT 'premium'::text NOT NULL,
    provider text NOT NULL,
    provider_subscription_id text,
    provider_product_id text,
    status text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    current_period_end timestamp with time zone,
    source text DEFAULT 'provider_sync'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT purchase_entitlements_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'apple_app_store'::text, 'google_play'::text])))
);


--
-- Name: purchase_entitlements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_entitlements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_entitlements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_entitlements_id_seq OWNED BY public.purchase_entitlements.id;


--
-- Name: purchase_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_events (
    id bigint NOT NULL,
    user_id uuid,
    provider text NOT NULL,
    entitlement_key text DEFAULT 'premium'::text NOT NULL,
    event_type text NOT NULL,
    provider_event_id text,
    provider_subscription_id text,
    provider_product_id text,
    status text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT purchase_events_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'apple_app_store'::text, 'google_play'::text])))
);


--
-- Name: purchase_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_events_id_seq OWNED BY public.purchase_events.id;


--
-- Name: purchase_provider_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_provider_customers (
    id bigint NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_customer_id text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT purchase_provider_customers_provider_check CHECK ((provider = ANY (ARRAY['stripe'::text, 'apple_app_store'::text, 'google_play'::text])))
);


--
-- Name: purchase_provider_customers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.purchase_provider_customers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: purchase_provider_customers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.purchase_provider_customers_id_seq OWNED BY public.purchase_provider_customers.id;


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: rss_feeds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rss_feeds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cached_rss_xml text,
    cached_rss_etag text,
    cached_rss_generated_at timestamp with time zone,
    cached_atom_xml text,
    cached_atom_etag text,
    cached_atom_generated_at timestamp with time zone
);


--
-- Name: sam_awards_extract_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sam_awards_extract_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_key text NOT NULL,
    contract_id uuid NOT NULL,
    contract_key text NOT NULL,
    mission_key text DEFAULT 'program'::text NOT NULL,
    program_scope text DEFAULT 'other'::text NOT NULL,
    piid text NOT NULL,
    referenced_idv_piid text,
    extract_format text DEFAULT 'json'::text NOT NULL,
    request_url text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    token text,
    job_status_url text,
    download_url text,
    response_status integer,
    row_count integer,
    source_document_id uuid,
    last_error text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sam_awards_extract_jobs_format_check CHECK ((extract_format = ANY (ARRAY['json'::text, 'csv'::text]))),
    CONSTRAINT sam_awards_extract_jobs_scope_check CHECK ((program_scope = ANY (ARRAY['artemis'::text, 'blue-origin'::text, 'spacex'::text, 'other'::text]))),
    CONSTRAINT sam_awards_extract_jobs_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'applied'::text, 'failed'::text])))
);


--
-- Name: sam_entity_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sam_entity_registry (
    entity_key text NOT NULL,
    legal_business_name text,
    uei text,
    cage text,
    parent_uei text,
    parent_legal_business_name text,
    is_active boolean DEFAULT true NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sam_query_fingerprints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sam_query_fingerprints (
    fingerprint text NOT NULL,
    endpoint text NOT NULL,
    query_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_status integer,
    last_row_count integer,
    last_error text,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    cooldown_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sam_query_fingerprints_consecutive_failures_check CHECK ((consecutive_failures >= 0)),
    CONSTRAINT sam_query_fingerprints_endpoint_check CHECK ((endpoint = ANY (ARRAY['contract-awards'::text, 'opportunities'::text])))
);


--
-- Name: sam_query_partitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sam_query_partitions (
    partition_key text NOT NULL,
    endpoint text NOT NULL,
    program_scope text,
    keyword text,
    organization_name text,
    posted_from date,
    posted_to date,
    current_offset integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    next_retry_at timestamp with time zone,
    last_scanned_at timestamp with time zone,
    last_http_status integer,
    last_row_count integer,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sam_query_partitions_endpoint_check CHECK ((endpoint = ANY (ARRAY['opportunities'::text, 'contract-awards'::text]))),
    CONSTRAINT sam_query_partitions_offset_check CHECK ((current_offset >= 0)),
    CONSTRAINT sam_query_partitions_row_count_check CHECK (((last_row_count IS NULL) OR (last_row_count >= 0))),
    CONSTRAINT sam_query_partitions_scope_check CHECK (((program_scope IS NULL) OR (program_scope = ANY (ARRAY['artemis'::text, 'blue-origin'::text, 'spacex'::text, 'other'::text])))),
    CONSTRAINT sam_query_partitions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'retired'::text])))
);


--
-- Name: satellite_group_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.satellite_group_memberships (
    group_code text NOT NULL,
    norad_cat_id bigint NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: satellites; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.satellites (
    norad_cat_id bigint NOT NULL,
    intl_des text,
    object_name text,
    object_type text DEFAULT 'UNK'::text,
    ops_status_code text,
    owner text,
    launch_date date,
    launch_site text,
    decay_date date,
    period_min double precision,
    inclination_deg double precision,
    apogee_km double precision,
    perigee_km double precision,
    rcs_m2 double precision,
    raw_satcat jsonb,
    satcat_updated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT satellites_object_type_check CHECK (((object_type = ANY (ARRAY['PAY'::text, 'RB'::text, 'DEB'::text, 'UNK'::text])) OR (object_type IS NULL)))
);


--
-- Name: search_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_documents (
    doc_id text NOT NULL,
    source_type text NOT NULL,
    doc_type text NOT NULL,
    url text NOT NULL,
    title text NOT NULL,
    subtitle text,
    summary text,
    body_preview text,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    keywords text[] DEFAULT '{}'::text[] NOT NULL,
    badge text,
    image_url text,
    published_at timestamp with time zone,
    source_updated_at timestamp with time zone,
    boost double precision DEFAULT 0 NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    title_alias_text text,
    search_vector tsvector,
    CONSTRAINT search_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['launch'::text, 'hub'::text, 'guide'::text, 'news'::text, 'contract'::text, 'person'::text, 'recovery'::text, 'catalog'::text, 'page'::text])))
);


--
-- Name: search_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_sync_state (
    sync_key text NOT NULL,
    status text NOT NULL,
    last_started_at timestamp with time zone,
    last_completed_at timestamp with time zone,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT search_sync_state_status_check CHECK ((status = ANY (ARRAY['idle'::text, 'running'::text, 'complete'::text, 'error'::text])))
);


--
-- Name: snapi_item_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snapi_item_events (
    snapi_uid text NOT NULL,
    ll2_event_id integer NOT NULL,
    provider text
);


--
-- Name: snapi_item_launches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snapi_item_launches (
    snapi_uid text NOT NULL,
    launch_id uuid NOT NULL
);


--
-- Name: snapi_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.snapi_items (
    snapi_uid text NOT NULL,
    snapi_id integer NOT NULL,
    item_type text NOT NULL,
    title text NOT NULL,
    url text NOT NULL,
    news_site text,
    summary text,
    image_url text,
    published_at timestamp with time zone,
    updated_at timestamp with time zone,
    featured boolean,
    authors jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT snapi_items_item_type_check CHECK ((item_type = ANY (ARRAY['article'::text, 'blog'::text, 'report'::text])))
);


--
-- Name: social_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.social_accounts (
    id bigint NOT NULL,
    provider_key text NOT NULL,
    provider_name text NOT NULL,
    platform text DEFAULT 'x'::text NOT NULL,
    handle text NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    verified_hint boolean DEFAULT true NOT NULL,
    last_fetch_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_error_at timestamp with time zone,
    last_error text,
    cooldown_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT social_accounts_platform_check CHECK ((platform = 'x'::text))
);


--
-- Name: social_accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

ALTER TABLE public.social_accounts ALTER COLUMN id ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME public.social_accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: spacex_contracts; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.spacex_contracts AS
 SELECT id,
    COALESCE(usaspending_award_id, ('spacex-award-'::text || (id)::text)) AS contract_key,
    COALESCE(NULLIF(TRIM(BOTH FROM mission_key), ''::text), 'program'::text) AS mission_key,
    award_title AS title,
    recipient AS agency,
    recipient AS customer,
    obligated_amount AS amount,
    awarded_on,
    COALESCE(NULLIF((metadata ->> 'description'::text), ''::text), NULLIF(award_title, ''::text), 'USASpending award record'::text) AS description,
    COALESCE(NULLIF((metadata ->> 'awardPageUrl'::text), ''::text), NULLIF((metadata ->> 'sourceUrl'::text), ''::text),
        CASE
            WHEN (usaspending_award_id IS NOT NULL) THEN ('https://www.usaspending.gov/search/?hash='::text || usaspending_award_id)
            ELSE NULL::text
        END) AS source_url,
    COALESCE(NULLIF((metadata ->> 'sourceTitle'::text), ''::text), 'USASpending award record'::text) AS source_label,
    'awarded'::text AS status,
    metadata,
    updated_at
   FROM public.program_usaspending_audited_awards
  WHERE ((program_scope = 'spacex'::text) AND (scope_tier = 'exact'::text));


--
-- Name: spacex_drone_ship_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spacex_drone_ship_assignments (
    launch_id uuid NOT NULL,
    launch_library_id uuid,
    ship_slug text,
    ship_name_raw text,
    ship_abbrev_raw text,
    landing_attempt boolean,
    landing_success boolean,
    landing_result text DEFAULT 'unknown'::text NOT NULL,
    landing_time timestamp with time zone,
    source text DEFAULT 'll2'::text NOT NULL,
    source_landing_id text,
    last_verified_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT spacex_drone_ship_assignments_landing_result_check CHECK ((landing_result = ANY (ARRAY['success'::text, 'failure'::text, 'no_attempt'::text, 'unknown'::text])))
);


--
-- Name: spacex_drone_ships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spacex_drone_ships (
    slug text NOT NULL,
    name text NOT NULL,
    abbrev text,
    status text DEFAULT 'active'::text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    wikidata_id text,
    wiki_source_url text,
    wikipedia_url text,
    wikimedia_commons_category text,
    wiki_last_synced_at timestamp with time zone,
    image_url text,
    image_source_url text,
    image_license text,
    image_license_url text,
    image_credit text,
    image_alt text,
    length_m numeric(8,3),
    year_built integer,
    home_port text,
    owner_name text,
    operator_name text,
    country_name text,
    CONSTRAINT spacex_drone_ships_status_check CHECK ((status = ANY (ARRAY['active'::text, 'retired'::text, 'unknown'::text]))),
    CONSTRAINT spacex_drone_ships_year_built_check CHECK (((year_built IS NULL) OR ((year_built >= 1800) AND (year_built <= 2100))))
);


--
-- Name: stripe_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.stripe_customers (
    user_id uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_subscription_sync_at timestamp with time zone
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    user_id uuid NOT NULL,
    stripe_subscription_id text NOT NULL,
    stripe_price_id text NOT NULL,
    status text NOT NULL,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: tipjar_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tipjar_customers (
    user_id uuid NOT NULL,
    stripe_customer_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trajectory_product_lineage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trajectory_product_lineage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    launch_id uuid NOT NULL,
    product_version text NOT NULL,
    generated_at timestamp with time zone NOT NULL,
    source_ref_id text NOT NULL,
    source text NOT NULL,
    source_id text,
    source_kind text,
    license_class text,
    constraint_id bigint,
    source_document_id uuid,
    source_url text,
    source_hash text,
    parser_version text,
    parse_rule_id text,
    extracted_field_map jsonb,
    fetched_at timestamp with time zone,
    weight_used double precision,
    confidence double precision,
    ingestion_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: trajectory_source_contracts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trajectory_source_contracts (
    id bigint NOT NULL,
    launch_id uuid NOT NULL,
    product_version text DEFAULT 'traj_v2'::text NOT NULL,
    contract_version text DEFAULT 'source_contract_v2_1'::text NOT NULL,
    confidence_tier text NOT NULL,
    status text NOT NULL,
    source_sufficiency jsonb DEFAULT '{}'::jsonb NOT NULL,
    required_fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    missing_fields text[] DEFAULT '{}'::text[] NOT NULL,
    blocking_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    freshness_state text DEFAULT 'unknown'::text NOT NULL,
    lineage_complete boolean DEFAULT false NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL,
    ingestion_run_id bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT trajectory_source_contracts_confidence_tier_check CHECK ((confidence_tier = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text]))),
    CONSTRAINT trajectory_source_contracts_freshness_state_check CHECK ((freshness_state = ANY (ARRAY['fresh'::text, 'stale'::text, 'unknown'::text]))),
    CONSTRAINT trajectory_source_contracts_status_check CHECK ((status = ANY (ARRAY['pass'::text, 'fail'::text])))
);


--
-- Name: trajectory_source_contracts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trajectory_source_contracts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trajectory_source_contracts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trajectory_source_contracts_id_seq OWNED BY public.trajectory_source_contracts.id;


--
-- Name: trajectory_source_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trajectory_source_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text DEFAULT 'orbit_doc'::text NOT NULL,
    url text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    http_status integer,
    etag text,
    last_modified timestamp with time zone,
    sha256 text NOT NULL,
    bytes integer,
    content_type text,
    title text,
    extracted_text text,
    raw jsonb,
    error text,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_sign_in_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_sign_in_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    platform text NOT NULL,
    event_type text NOT NULL,
    display_name text,
    avatar_url text,
    email_is_private_relay boolean DEFAULT false NOT NULL,
    app_version text,
    build_profile text,
    result text DEFAULT 'success'::text NOT NULL,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    risk_session_id uuid,
    CONSTRAINT user_sign_in_events_event_type_check CHECK ((event_type = ANY (ARRAY['sign_in'::text, 'sign_up'::text, 'oauth_callback'::text, 'password_reset'::text, 'session_restore'::text, 'sign_out'::text]))),
    CONSTRAINT user_sign_in_events_platform_check CHECK ((platform = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text]))),
    CONSTRAINT user_sign_in_events_provider_check CHECK ((provider = ANY (ARRAY['email_password'::text, 'apple'::text, 'google'::text, 'email_link'::text, 'unknown'::text])))
);


--
-- Name: user_surface_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_surface_summary (
    user_id uuid NOT NULL,
    first_mobile_platform text,
    last_sign_in_platform text,
    ever_used_web boolean DEFAULT false NOT NULL,
    ever_used_ios boolean DEFAULT false NOT NULL,
    ever_used_android boolean DEFAULT false NOT NULL,
    last_mobile_sign_in_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT user_surface_summary_first_mobile_platform_check CHECK ((first_mobile_platform = ANY (ARRAY['ios'::text, 'android'::text]))),
    CONSTRAINT user_surface_summary_last_sign_in_platform_check CHECK ((last_sign_in_platform = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text])))
);


--
-- Name: watchlist_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlist_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    watchlist_id uuid NOT NULL,
    rule_type text NOT NULL,
    rule_value text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT watchlist_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['launch'::text, 'pad'::text, 'provider'::text, 'tier'::text])))
);


--
-- Name: watchlists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.watchlists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text DEFAULT 'My Launches'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: webhook_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_events (
    id bigint NOT NULL,
    source text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    payload_hash text,
    processed boolean DEFAULT false NOT NULL,
    error text,
    event_id text
);


--
-- Name: webhook_events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.webhook_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: webhook_events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.webhook_events_id_seq OWNED BY public.webhook_events.id;


--
-- Name: ws45_forecast_parse_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws45_forecast_parse_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    forecast_id uuid NOT NULL,
    parser_version text NOT NULL,
    runtime text NOT NULL,
    attempt_reason text NOT NULL,
    document_mode text NOT NULL,
    document_family text,
    parse_status text NOT NULL,
    parse_confidence integer,
    publish_eligible boolean DEFAULT false NOT NULL,
    missing_required_fields text[] DEFAULT '{}'::text[] NOT NULL,
    validation_failures text[] DEFAULT '{}'::text[] NOT NULL,
    normalization_flags text[] DEFAULT '{}'::text[] NOT NULL,
    field_confidence jsonb,
    field_evidence jsonb,
    strategy_trace jsonb,
    stats jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ws45_forecast_parse_runs_attempt_reason_check CHECK ((attempt_reason = ANY (ARRAY['ingest'::text, 'reparse'::text, 'admin_replay'::text, 'backfill'::text]))),
    CONSTRAINT ws45_forecast_parse_runs_document_mode_check CHECK ((document_mode = ANY (ARRAY['digital'::text, 'scanned'::text, 'unknown'::text]))),
    CONSTRAINT ws45_forecast_parse_runs_parse_confidence_check CHECK (((parse_confidence >= 0) AND (parse_confidence <= 100))),
    CONSTRAINT ws45_forecast_parse_runs_parse_status_check CHECK ((parse_status = ANY (ARRAY['parsed'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT ws45_forecast_parse_runs_runtime_check CHECK ((runtime = ANY (ARRAY['edge'::text, 'node'::text, 'script'::text])))
);


--
-- Name: ws45_launch_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws45_launch_forecasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT '45ws'::text NOT NULL,
    source_range text DEFAULT 'eastern_range'::text NOT NULL,
    source_page_url text,
    source_label text,
    forecast_kind text,
    pdf_url text NOT NULL,
    pdf_etag text,
    pdf_last_modified timestamp with time zone,
    pdf_sha256 text NOT NULL,
    pdf_bytes integer,
    pdf_metadata jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    product_name text,
    mission_name text,
    mission_name_normalized text,
    mission_tokens text[],
    issued_at timestamp with time zone,
    valid_start timestamp with time zone,
    valid_end timestamp with time zone,
    valid_window tstzrange GENERATED ALWAYS AS (tstzrange(valid_start, valid_end, '[)'::text)) STORED,
    local_timezone text DEFAULT 'America/New_York'::text NOT NULL,
    forecast_discussion text,
    launch_day_pov_percent integer,
    launch_day_primary_concerns text[],
    launch_day jsonb,
    delay_24h_pov_percent integer,
    delay_24h_primary_concerns text[],
    delay_24h jsonb,
    raw_text text,
    raw jsonb,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    match_status text DEFAULT 'unmatched'::text NOT NULL,
    matched_launch_id uuid,
    match_confidence integer,
    match_strategy text,
    match_meta jsonb,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    document_mode text DEFAULT 'unknown'::text NOT NULL,
    document_family text,
    classification_confidence integer,
    parse_status text DEFAULT 'failed'::text NOT NULL,
    parse_confidence integer,
    publish_eligible boolean DEFAULT false NOT NULL,
    quarantine_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    required_fields_missing text[] DEFAULT '{}'::text[] NOT NULL,
    normalization_flags text[] DEFAULT '{}'::text[] NOT NULL,
    latest_parse_run_id uuid,
    CONSTRAINT ws45_launch_forecasts_classification_confidence_check CHECK (((classification_confidence >= 0) AND (classification_confidence <= 100))),
    CONSTRAINT ws45_launch_forecasts_delay_24h_pov_percent_check CHECK (((delay_24h_pov_percent >= 0) AND (delay_24h_pov_percent <= 100))),
    CONSTRAINT ws45_launch_forecasts_document_mode_check CHECK ((document_mode = ANY (ARRAY['digital'::text, 'scanned'::text, 'unknown'::text]))),
    CONSTRAINT ws45_launch_forecasts_launch_day_pov_percent_check CHECK (((launch_day_pov_percent >= 0) AND (launch_day_pov_percent <= 100))),
    CONSTRAINT ws45_launch_forecasts_match_confidence_check CHECK (((match_confidence >= 0) AND (match_confidence <= 100))),
    CONSTRAINT ws45_launch_forecasts_match_status_check CHECK ((match_status = ANY (ARRAY['unmatched'::text, 'matched'::text, 'ambiguous'::text, 'manual'::text]))),
    CONSTRAINT ws45_launch_forecasts_parse_confidence_check CHECK (((parse_confidence >= 0) AND (parse_confidence <= 100))),
    CONSTRAINT ws45_launch_forecasts_parse_status_check CHECK ((parse_status = ANY (ARRAY['parsed'::text, 'partial'::text, 'failed'::text])))
);


--
-- Name: ws45_live_weather_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws45_live_weather_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text DEFAULT '5ws_live_board'::text NOT NULL,
    source_page_url text DEFAULT 'https://45thweathersquadron.nebula.spaceforce.mil/pages/weatherSafety.html'::text NOT NULL,
    board_url text DEFAULT 'https://nimboard.rad.spaceforce.mil/nimboard'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    agency_count integer DEFAULT 0 NOT NULL,
    ring_count integer DEFAULT 0 NOT NULL,
    active_phase_1_count integer DEFAULT 0 NOT NULL,
    active_phase_2_count integer DEFAULT 0 NOT NULL,
    active_wind_count integer DEFAULT 0 NOT NULL,
    active_severe_count integer DEFAULT 0 NOT NULL,
    summary text,
    agencies jsonb DEFAULT '[]'::jsonb NOT NULL,
    lightning_rings jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ws45_live_weather_snapshots_active_phase_1_count_check CHECK ((active_phase_1_count >= 0)),
    CONSTRAINT ws45_live_weather_snapshots_active_phase_2_count_check CHECK ((active_phase_2_count >= 0)),
    CONSTRAINT ws45_live_weather_snapshots_active_severe_count_check CHECK ((active_severe_count >= 0)),
    CONSTRAINT ws45_live_weather_snapshots_active_wind_count_check CHECK ((active_wind_count >= 0)),
    CONSTRAINT ws45_live_weather_snapshots_agency_count_check CHECK ((agency_count >= 0)),
    CONSTRAINT ws45_live_weather_snapshots_ring_count_check CHECK ((ring_count >= 0))
);


--
-- Name: ws45_planning_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ws45_planning_forecasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_kind text NOT NULL,
    source text DEFAULT '45ws_planning'::text NOT NULL,
    source_page_url text DEFAULT 'https://45thweathersquadron.nebula.spaceforce.mil/pages/planningAndAviationForecastProducts.html'::text NOT NULL,
    source_label text,
    pdf_url text NOT NULL,
    pdf_etag text,
    pdf_last_modified timestamp with time zone,
    pdf_sha256 text NOT NULL,
    pdf_bytes integer,
    pdf_metadata jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    issued_at timestamp with time zone,
    valid_start timestamp with time zone,
    valid_end timestamp with time zone,
    valid_window tstzrange GENERATED ALWAYS AS (
CASE
    WHEN ((valid_start IS NOT NULL) AND (valid_end IS NOT NULL)) THEN tstzrange(valid_start, valid_end, '[)'::text)
    ELSE NULL::tstzrange
END) STORED,
    headline text,
    summary text,
    highlights text[] DEFAULT '{}'::text[] NOT NULL,
    raw_text text,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    parse_version text DEFAULT 'v1'::text NOT NULL,
    document_family text,
    parse_status text DEFAULT 'failed'::text NOT NULL,
    parse_confidence integer,
    publish_eligible boolean DEFAULT false NOT NULL,
    quarantine_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    structured_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT ws45_planning_forecasts_parse_confidence_check CHECK (((parse_confidence >= 0) AND (parse_confidence <= 100))),
    CONSTRAINT ws45_planning_forecasts_parse_status_check CHECK ((parse_status = ANY (ARRAY['parsed'::text, 'partial'::text, 'failed'::text]))),
    CONSTRAINT ws45_planning_forecasts_product_kind_check CHECK ((product_kind = ANY (ARRAY['planning_24h'::text, 'weekly_planning'::text])))
);


--
-- Name: artemis_content_scores id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_content_scores ALTER COLUMN id SET DEFAULT nextval('public.artemis_content_scores_id_seq'::regclass);


--
-- Name: artemis_social_accounts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_social_accounts ALTER COLUMN id SET DEFAULT nextval('public.artemis_social_accounts_id_seq'::regclass);


--
-- Name: billing_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events ALTER COLUMN id SET DEFAULT nextval('public.billing_events_id_seq'::regclass);


--
-- Name: feedback_submissions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions ALTER COLUMN id SET DEFAULT nextval('public.feedback_submissions_id_seq'::regclass);


--
-- Name: ingestion_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_runs ALTER COLUMN id SET DEFAULT nextval('public.ingestion_runs_id_seq'::regclass);


--
-- Name: jep_background_light_cells id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_background_light_cells ALTER COLUMN id SET DEFAULT nextval('public.jep_background_light_cells_id_seq'::regclass);


--
-- Name: jep_corridor_cache id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_corridor_cache ALTER COLUMN id SET DEFAULT nextval('public.jep_corridor_cache_id_seq'::regclass);


--
-- Name: jep_feature_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_feature_snapshots ALTER COLUMN id SET DEFAULT nextval('public.jep_feature_snapshots_id_seq'::regclass);


--
-- Name: jep_moon_ephemerides id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides ALTER COLUMN id SET DEFAULT nextval('public.jep_moon_ephemerides_id_seq'::regclass);


--
-- Name: jep_outcome_reports id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_outcome_reports ALTER COLUMN id SET DEFAULT nextval('public.jep_outcome_reports_id_seq'::regclass);


--
-- Name: jep_profiles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_profiles ALTER COLUMN id SET DEFAULT nextval('public.jep_profiles_id_seq'::regclass);


--
-- Name: jep_source_fetch_runs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_source_fetch_runs ALTER COLUMN id SET DEFAULT nextval('public.jep_source_fetch_runs_id_seq'::regclass);


--
-- Name: jep_source_versions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_source_versions ALTER COLUMN id SET DEFAULT nextval('public.jep_source_versions_id_seq'::regclass);


--
-- Name: launch_external_resources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_external_resources ALTER COLUMN id SET DEFAULT nextval('public.launch_external_resources_id_seq'::regclass);


--
-- Name: launch_jep_score_candidates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_jep_score_candidates ALTER COLUMN id SET DEFAULT nextval('public.launch_jep_score_candidates_id_seq'::regclass);


--
-- Name: launch_object_inventory_snapshots id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_object_inventory_snapshots ALTER COLUMN id SET DEFAULT nextval('public.launch_object_inventory_snapshots_id_seq'::regclass);


--
-- Name: launch_trajectory_constraints id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_constraints ALTER COLUMN id SET DEFAULT nextval('public.launch_trajectory_constraints_id_seq'::regclass);


--
-- Name: launch_updates id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_updates ALTER COLUMN id SET DEFAULT nextval('public.launch_updates_id_seq'::regclass);


--
-- Name: mobile_push_outbox_v2 id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_outbox_v2 ALTER COLUMN id SET DEFAULT nextval('public.mobile_push_outbox_v2_id_seq'::regclass);


--
-- Name: notifications_outbox id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox ALTER COLUMN id SET DEFAULT nextval('public.notifications_outbox_id_seq'::regclass);


--
-- Name: ops_alerts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_alerts ALTER COLUMN id SET DEFAULT nextval('public.ops_alerts_id_seq'::regclass);


--
-- Name: ops_metrics_samples_1m id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_metrics_samples_1m ALTER COLUMN id SET DEFAULT nextval('public.ops_metrics_samples_1m_id_seq'::regclass);


--
-- Name: ops_metrics_samples_5m id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_metrics_samples_5m ALTER COLUMN id SET DEFAULT nextval('public.ops_metrics_samples_5m_id_seq'::regclass);


--
-- Name: orbit_elements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_elements ALTER COLUMN id SET DEFAULT nextval('public.orbit_elements_id_seq'::regclass);


--
-- Name: purchase_entitlements id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_entitlements ALTER COLUMN id SET DEFAULT nextval('public.purchase_entitlements_id_seq'::regclass);


--
-- Name: purchase_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_events ALTER COLUMN id SET DEFAULT nextval('public.purchase_events_id_seq'::regclass);


--
-- Name: purchase_provider_customers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_provider_customers ALTER COLUMN id SET DEFAULT nextval('public.purchase_provider_customers_id_seq'::regclass);


--
-- Name: trajectory_source_contracts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_source_contracts ALTER COLUMN id SET DEFAULT nextval('public.trajectory_source_contracts_id_seq'::regclass);


--
-- Name: webhook_events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events ALTER COLUMN id SET DEFAULT nextval('public.webhook_events_id_seq'::regclass);


--
-- Name: admin_access_override_events admin_access_override_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_access_override_events
    ADD CONSTRAINT admin_access_override_events_pkey PRIMARY KEY (id);


--
-- Name: admin_access_overrides admin_access_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_access_overrides
    ADD CONSTRAINT admin_access_overrides_pkey PRIMARY KEY (user_id);


--
-- Name: api_rate_counters api_rate_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_rate_counters
    ADD CONSTRAINT api_rate_counters_pkey PRIMARY KEY (provider, window_start);


--
-- Name: apple_sign_in_tokens apple_sign_in_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apple_sign_in_tokens
    ADD CONSTRAINT apple_sign_in_tokens_pkey PRIMARY KEY (user_id);


--
-- Name: ar_camera_guide_sessions ar_camera_guide_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_camera_guide_sessions
    ADD CONSTRAINT ar_camera_guide_sessions_pkey PRIMARY KEY (id);


--
-- Name: artemis_budget_lines artemis_budget_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_budget_lines
    ADD CONSTRAINT artemis_budget_lines_pkey PRIMARY KEY (id);


--
-- Name: artemis_content_items artemis_content_items_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_content_items
    ADD CONSTRAINT artemis_content_items_fingerprint_key UNIQUE (fingerprint);


--
-- Name: artemis_content_items artemis_content_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_content_items
    ADD CONSTRAINT artemis_content_items_pkey PRIMARY KEY (id);


--
-- Name: artemis_content_scores artemis_content_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_content_scores
    ADD CONSTRAINT artemis_content_scores_pkey PRIMARY KEY (id);


--
-- Name: artemis_contract_actions artemis_contract_actions_action_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_actions
    ADD CONSTRAINT artemis_contract_actions_action_key_key UNIQUE (action_key);


--
-- Name: artemis_contract_actions artemis_contract_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_actions
    ADD CONSTRAINT artemis_contract_actions_pkey PRIMARY KEY (id);


--
-- Name: artemis_contract_budget_map artemis_contract_budget_map_contract_id_budget_line_id_matc_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_budget_map
    ADD CONSTRAINT artemis_contract_budget_map_contract_id_budget_line_id_matc_key UNIQUE (contract_id, budget_line_id, match_method);


--
-- Name: artemis_contract_budget_map artemis_contract_budget_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_budget_map
    ADD CONSTRAINT artemis_contract_budget_map_pkey PRIMARY KEY (id);


--
-- Name: artemis_contracts artemis_contracts_contract_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contracts
    ADD CONSTRAINT artemis_contracts_contract_key_key UNIQUE (contract_key);


--
-- Name: artemis_contracts artemis_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contracts
    ADD CONSTRAINT artemis_contracts_pkey PRIMARY KEY (id);


--
-- Name: artemis_entities artemis_entities_entity_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_entities
    ADD CONSTRAINT artemis_entities_entity_key_key UNIQUE (entity_key);


--
-- Name: artemis_entities artemis_entities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_entities
    ADD CONSTRAINT artemis_entities_pkey PRIMARY KEY (id);


--
-- Name: artemis_ingest_checkpoints artemis_ingest_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_ingest_checkpoints
    ADD CONSTRAINT artemis_ingest_checkpoints_pkey PRIMARY KEY (source_key);


--
-- Name: artemis_mission_components artemis_mission_components_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_mission_components
    ADD CONSTRAINT artemis_mission_components_pkey PRIMARY KEY (id);


--
-- Name: artemis_mission_snapshots artemis_mission_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_mission_snapshots
    ADD CONSTRAINT artemis_mission_snapshots_pkey PRIMARY KEY (mission_key);


--
-- Name: artemis_opportunity_notices artemis_opportunity_notices_notice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_opportunity_notices
    ADD CONSTRAINT artemis_opportunity_notices_notice_id_key UNIQUE (notice_id);


--
-- Name: artemis_opportunity_notices artemis_opportunity_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_opportunity_notices
    ADD CONSTRAINT artemis_opportunity_notices_pkey PRIMARY KEY (id);


--
-- Name: artemis_people artemis_people_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_people
    ADD CONSTRAINT artemis_people_pkey PRIMARY KEY (id);


--
-- Name: artemis_procurement_awards artemis_procurement_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_procurement_awards
    ADD CONSTRAINT artemis_procurement_awards_pkey PRIMARY KEY (id);


--
-- Name: artemis_procurement_awards artemis_procurement_awards_usaspending_award_id_mission_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_procurement_awards
    ADD CONSTRAINT artemis_procurement_awards_usaspending_award_id_mission_key_key UNIQUE (usaspending_award_id, mission_key);


--
-- Name: artemis_program_procurement_cache artemis_program_procurement_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_program_procurement_cache
    ADD CONSTRAINT artemis_program_procurement_cache_pkey PRIMARY KEY (contract_id);


--
-- Name: artemis_sam_contract_award_rows artemis_sam_contract_award_rows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_sam_contract_award_rows
    ADD CONSTRAINT artemis_sam_contract_award_rows_pkey PRIMARY KEY (id);


--
-- Name: artemis_sam_contract_award_rows artemis_sam_contract_award_rows_row_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_sam_contract_award_rows
    ADD CONSTRAINT artemis_sam_contract_award_rows_row_key_key UNIQUE (row_key);


--
-- Name: artemis_social_accounts artemis_social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_social_accounts
    ADD CONSTRAINT artemis_social_accounts_pkey PRIMARY KEY (id);


--
-- Name: artemis_source_documents artemis_source_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_source_documents
    ADD CONSTRAINT artemis_source_documents_pkey PRIMARY KEY (id);


--
-- Name: artemis_source_documents artemis_source_documents_url_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_source_documents
    ADD CONSTRAINT artemis_source_documents_url_sha256_key UNIQUE (url, sha256);


--
-- Name: artemis_source_registry artemis_source_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_source_registry
    ADD CONSTRAINT artemis_source_registry_pkey PRIMARY KEY (source_key);


--
-- Name: artemis_spending_timeseries artemis_spending_timeseries_contract_id_fiscal_year_fiscal__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_spending_timeseries
    ADD CONSTRAINT artemis_spending_timeseries_contract_id_fiscal_year_fiscal__key UNIQUE (contract_id, fiscal_year, fiscal_month, source);


--
-- Name: artemis_spending_timeseries artemis_spending_timeseries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_spending_timeseries
    ADD CONSTRAINT artemis_spending_timeseries_pkey PRIMARY KEY (id);


--
-- Name: artemis_timeline_events artemis_timeline_events_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_timeline_events
    ADD CONSTRAINT artemis_timeline_events_fingerprint_key UNIQUE (fingerprint);


--
-- Name: artemis_timeline_events artemis_timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_timeline_events
    ADD CONSTRAINT artemis_timeline_events_pkey PRIMARY KEY (id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_contract_actions blue_origin_contract_actions_action_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_actions
    ADD CONSTRAINT blue_origin_contract_actions_action_key_key UNIQUE (action_key);


--
-- Name: blue_origin_contract_actions blue_origin_contract_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_actions
    ADD CONSTRAINT blue_origin_contract_actions_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_contract_vehicle_map blue_origin_contract_vehicle__contract_id_vehicle_slug_engi_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_vehicle_map
    ADD CONSTRAINT blue_origin_contract_vehicle__contract_id_vehicle_slug_engi_key UNIQUE (contract_id, vehicle_slug, engine_slug, match_method);


--
-- Name: blue_origin_contract_vehicle_map blue_origin_contract_vehicle_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_vehicle_map
    ADD CONSTRAINT blue_origin_contract_vehicle_map_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_contracts blue_origin_contracts_contract_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contracts
    ADD CONSTRAINT blue_origin_contracts_contract_key_key UNIQUE (contract_key);


--
-- Name: blue_origin_contracts blue_origin_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contracts
    ADD CONSTRAINT blue_origin_contracts_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_engines blue_origin_engines_engine_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_engines
    ADD CONSTRAINT blue_origin_engines_engine_slug_key UNIQUE (engine_slug);


--
-- Name: blue_origin_engines blue_origin_engines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_engines
    ADD CONSTRAINT blue_origin_engines_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_flights blue_origin_flights_flight_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_flights
    ADD CONSTRAINT blue_origin_flights_flight_code_key UNIQUE (flight_code);


--
-- Name: blue_origin_flights blue_origin_flights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_flights
    ADD CONSTRAINT blue_origin_flights_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_ingest_checkpoints blue_origin_ingest_checkpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_ingest_checkpoints
    ADD CONSTRAINT blue_origin_ingest_checkpoints_pkey PRIMARY KEY (source_key);


--
-- Name: blue_origin_mission_snapshots blue_origin_mission_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_mission_snapshots
    ADD CONSTRAINT blue_origin_mission_snapshots_pkey PRIMARY KEY (mission_key);


--
-- Name: blue_origin_opportunity_notices blue_origin_opportunity_notices_notice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_opportunity_notices
    ADD CONSTRAINT blue_origin_opportunity_notices_notice_id_key UNIQUE (notice_id);


--
-- Name: blue_origin_opportunity_notices blue_origin_opportunity_notices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_opportunity_notices
    ADD CONSTRAINT blue_origin_opportunity_notices_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_passengers blue_origin_passengers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_passengers
    ADD CONSTRAINT blue_origin_passengers_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_payloads blue_origin_payloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_payloads
    ADD CONSTRAINT blue_origin_payloads_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_people_profiles blue_origin_people_profiles_person_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_people_profiles
    ADD CONSTRAINT blue_origin_people_profiles_person_key_key UNIQUE (person_key);


--
-- Name: blue_origin_people_profiles blue_origin_people_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_people_profiles
    ADD CONSTRAINT blue_origin_people_profiles_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_source_documents blue_origin_source_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_source_documents
    ADD CONSTRAINT blue_origin_source_documents_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_source_documents blue_origin_source_documents_url_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_source_documents
    ADD CONSTRAINT blue_origin_source_documents_url_sha256_key UNIQUE (url, sha256);


--
-- Name: blue_origin_spending_timeseries blue_origin_spending_timeseri_contract_id_fiscal_year_fisca_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_spending_timeseries
    ADD CONSTRAINT blue_origin_spending_timeseri_contract_id_fiscal_year_fisca_key UNIQUE (contract_id, fiscal_year, fiscal_month, source);


--
-- Name: blue_origin_spending_timeseries blue_origin_spending_timeseries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_spending_timeseries
    ADD CONSTRAINT blue_origin_spending_timeseries_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_timeline_events blue_origin_timeline_events_event_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_timeline_events
    ADD CONSTRAINT blue_origin_timeline_events_event_key_key UNIQUE (event_key);


--
-- Name: blue_origin_timeline_events blue_origin_timeline_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_timeline_events
    ADD CONSTRAINT blue_origin_timeline_events_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_traveler_sources blue_origin_traveler_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_traveler_sources
    ADD CONSTRAINT blue_origin_traveler_sources_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_traveler_sources blue_origin_traveler_sources_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_traveler_sources
    ADD CONSTRAINT blue_origin_traveler_sources_source_key_key UNIQUE (source_key);


--
-- Name: blue_origin_travelers blue_origin_travelers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_travelers
    ADD CONSTRAINT blue_origin_travelers_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_travelers blue_origin_travelers_traveler_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_travelers
    ADD CONSTRAINT blue_origin_travelers_traveler_slug_key UNIQUE (traveler_slug);


--
-- Name: blue_origin_vehicle_engine_map blue_origin_vehicle_engine_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_vehicle_engine_map
    ADD CONSTRAINT blue_origin_vehicle_engine_map_pkey PRIMARY KEY (vehicle_slug, engine_slug);


--
-- Name: blue_origin_vehicles blue_origin_vehicles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_vehicles
    ADD CONSTRAINT blue_origin_vehicles_pkey PRIMARY KEY (id);


--
-- Name: blue_origin_vehicles blue_origin_vehicles_vehicle_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_vehicles
    ADD CONSTRAINT blue_origin_vehicles_vehicle_slug_key UNIQUE (vehicle_slug);


--
-- Name: calendar_feeds calendar_feeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_pkey PRIMARY KEY (id);


--
-- Name: canonical_contracts_cache canonical_contracts_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.canonical_contracts_cache
    ADD CONSTRAINT canonical_contracts_cache_pkey PRIMARY KEY (uid);


--
-- Name: celestrak_datasets celestrak_datasets_dataset_type_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.celestrak_datasets
    ADD CONSTRAINT celestrak_datasets_dataset_type_code_key UNIQUE (dataset_type, code);


--
-- Name: celestrak_datasets celestrak_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.celestrak_datasets
    ADD CONSTRAINT celestrak_datasets_pkey PRIMARY KEY (dataset_key);


--
-- Name: celestrak_intdes_datasets celestrak_intdes_datasets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.celestrak_intdes_datasets
    ADD CONSTRAINT celestrak_intdes_datasets_pkey PRIMARY KEY (launch_designator);


--
-- Name: discount_campaign_provider_artifacts discount_campaign_provider_artifacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaign_provider_artifacts
    ADD CONSTRAINT discount_campaign_provider_artifacts_pkey PRIMARY KEY (id);


--
-- Name: discount_campaign_targets discount_campaign_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaign_targets
    ADD CONSTRAINT discount_campaign_targets_pkey PRIMARY KEY (id);


--
-- Name: discount_campaigns discount_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaigns
    ADD CONSTRAINT discount_campaigns_pkey PRIMARY KEY (id);


--
-- Name: discount_campaigns discount_campaigns_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaigns
    ADD CONSTRAINT discount_campaigns_slug_key UNIQUE (slug);


--
-- Name: embed_widgets embed_widgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embed_widgets
    ADD CONSTRAINT embed_widgets_pkey PRIMARY KEY (id);


--
-- Name: faa_launch_match_dirty_launches faa_launch_match_dirty_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_launch_match_dirty_launches
    ADD CONSTRAINT faa_launch_match_dirty_launches_pkey PRIMARY KEY (launch_id);


--
-- Name: faa_launch_matches faa_launch_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_launch_matches
    ADD CONSTRAINT faa_launch_matches_pkey PRIMARY KEY (id);


--
-- Name: faa_notam_details faa_notam_details_notam_hash_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_notam_details
    ADD CONSTRAINT faa_notam_details_notam_hash_uniq UNIQUE (notam_id, content_hash);


--
-- Name: faa_notam_details faa_notam_details_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_notam_details
    ADD CONSTRAINT faa_notam_details_pkey PRIMARY KEY (id);


--
-- Name: faa_tfr_records faa_tfr_records_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_tfr_records
    ADD CONSTRAINT faa_tfr_records_pkey PRIMARY KEY (id);


--
-- Name: faa_tfr_records faa_tfr_records_source_key_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_tfr_records
    ADD CONSTRAINT faa_tfr_records_source_key_uniq UNIQUE (source, source_key);


--
-- Name: faa_tfr_shapes faa_tfr_shapes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_tfr_shapes
    ADD CONSTRAINT faa_tfr_shapes_pkey PRIMARY KEY (id);


--
-- Name: faa_tfr_shapes faa_tfr_shapes_record_source_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_tfr_shapes
    ADD CONSTRAINT faa_tfr_shapes_record_source_uniq UNIQUE (faa_tfr_record_id, source_shape_id);


--
-- Name: feedback_submissions feedback_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_pkey PRIMARY KEY (id);


--
-- Name: ingestion_runs ingestion_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_runs
    ADD CONSTRAINT ingestion_runs_pkey PRIMARY KEY (id);


--
-- Name: jep_background_light_cells jep_background_light_cells_observer_feature_key_source_key__key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_background_light_cells
    ADD CONSTRAINT jep_background_light_cells_observer_feature_key_source_key__key UNIQUE (observer_feature_key, source_key, period_start_date);


--
-- Name: jep_background_light_cells jep_background_light_cells_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_background_light_cells
    ADD CONSTRAINT jep_background_light_cells_pkey PRIMARY KEY (id);


--
-- Name: jep_corridor_cache jep_corridor_cache_launch_id_source_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_corridor_cache
    ADD CONSTRAINT jep_corridor_cache_launch_id_source_key UNIQUE (launch_id, source);


--
-- Name: jep_corridor_cache jep_corridor_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_corridor_cache
    ADD CONSTRAINT jep_corridor_cache_pkey PRIMARY KEY (id);


--
-- Name: jep_feature_snapshots jep_feature_snapshots_launch_id_observer_location_hash_feat_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_feature_snapshots
    ADD CONSTRAINT jep_feature_snapshots_launch_id_observer_location_hash_feat_key UNIQUE (launch_id, observer_location_hash, feature_family, input_hash);


--
-- Name: jep_feature_snapshots jep_feature_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_feature_snapshots
    ADD CONSTRAINT jep_feature_snapshots_pkey PRIMARY KEY (id);


--
-- Name: jep_horizon_masks jep_horizon_masks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_horizon_masks
    ADD CONSTRAINT jep_horizon_masks_pkey PRIMARY KEY (observer_feature_key);


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_launch_id_observer_location_hash_sampl_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_launch_id_observer_location_hash_sampl_key UNIQUE (launch_id, observer_location_hash, sample_at);


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_pkey PRIMARY KEY (id);


--
-- Name: jep_observer_locations jep_observer_locations_lat_bucket_lon_bucket_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_observer_locations
    ADD CONSTRAINT jep_observer_locations_lat_bucket_lon_bucket_key UNIQUE (lat_bucket, lon_bucket);


--
-- Name: jep_observer_locations jep_observer_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_observer_locations
    ADD CONSTRAINT jep_observer_locations_pkey PRIMARY KEY (observer_location_hash);


--
-- Name: jep_outcome_reports jep_outcome_reports_launch_id_observer_location_hash_report_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_outcome_reports
    ADD CONSTRAINT jep_outcome_reports_launch_id_observer_location_hash_report_key UNIQUE (launch_id, observer_location_hash, reporter_hash);


--
-- Name: jep_outcome_reports jep_outcome_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_outcome_reports
    ADD CONSTRAINT jep_outcome_reports_pkey PRIMARY KEY (id);


--
-- Name: jep_profiles jep_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_profiles
    ADD CONSTRAINT jep_profiles_pkey PRIMARY KEY (id);


--
-- Name: jep_profiles jep_profiles_vehicle_slug_mission_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_profiles
    ADD CONSTRAINT jep_profiles_vehicle_slug_mission_type_key UNIQUE (vehicle_slug, mission_type);


--
-- Name: jep_source_fetch_runs jep_source_fetch_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_source_fetch_runs
    ADD CONSTRAINT jep_source_fetch_runs_pkey PRIMARY KEY (id);


--
-- Name: jep_source_versions jep_source_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_source_versions
    ADD CONSTRAINT jep_source_versions_pkey PRIMARY KEY (id);


--
-- Name: jep_source_versions jep_source_versions_source_key_version_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_source_versions
    ADD CONSTRAINT jep_source_versions_source_key_version_key_key UNIQUE (source_key, version_key);


--
-- Name: jep_vehicle_priors jep_vehicle_priors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_vehicle_priors
    ADD CONSTRAINT jep_vehicle_priors_pkey PRIMARY KEY (family_key);


--
-- Name: job_locks job_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_locks
    ADD CONSTRAINT job_locks_pkey PRIMARY KEY (lock_name);


--
-- Name: launch_expected_satellite_payloads launch_expected_satellite_payloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_expected_satellite_payloads
    ADD CONSTRAINT launch_expected_satellite_payloads_pkey PRIMARY KEY (ll2_launch_uuid);


--
-- Name: launch_external_resources launch_external_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_external_resources
    ADD CONSTRAINT launch_external_resources_pkey PRIMARY KEY (id);


--
-- Name: launch_external_resources launch_external_resources_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_external_resources
    ADD CONSTRAINT launch_external_resources_source_unique UNIQUE (launch_id, source, content_type, source_id);


--
-- Name: launch_filter_presets launch_filter_presets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_filter_presets
    ADD CONSTRAINT launch_filter_presets_pkey PRIMARY KEY (id);


--
-- Name: launch_jep_score_candidates launch_jep_score_candidates_launch_id_observer_location_has_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_jep_score_candidates
    ADD CONSTRAINT launch_jep_score_candidates_launch_id_observer_location_has_key UNIQUE (launch_id, observer_location_hash, model_version);


--
-- Name: launch_jep_score_candidates launch_jep_score_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_jep_score_candidates
    ADD CONSTRAINT launch_jep_score_candidates_pkey PRIMARY KEY (id);


--
-- Name: launch_jep_scores launch_jep_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_jep_scores
    ADD CONSTRAINT launch_jep_scores_pkey PRIMARY KEY (launch_id, observer_location_hash);


--
-- Name: launch_notification_preferences launch_notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_notification_preferences
    ADD CONSTRAINT launch_notification_preferences_pkey PRIMARY KEY (user_id, launch_id, channel);


--
-- Name: launch_object_inventory_snapshots launch_object_inventory_snaps_launch_designator_snapshot_ha_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_object_inventory_snapshots
    ADD CONSTRAINT launch_object_inventory_snaps_launch_designator_snapshot_ha_key UNIQUE (launch_designator, snapshot_hash);


--
-- Name: launch_object_inventory_snapshot_items launch_object_inventory_snapshot_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_object_inventory_snapshot_items
    ADD CONSTRAINT launch_object_inventory_snapshot_items_pkey PRIMARY KEY (snapshot_id, object_id);


--
-- Name: launch_object_inventory_snapshots launch_object_inventory_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_object_inventory_snapshots
    ADD CONSTRAINT launch_object_inventory_snapshots_pkey PRIMARY KEY (id);


--
-- Name: launch_pad_preview_cache launch_pad_preview_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_pad_preview_cache
    ADD CONSTRAINT launch_pad_preview_cache_pkey PRIMARY KEY (pad_key);


--
-- Name: launch_refresh_state launch_refresh_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_refresh_state
    ADD CONSTRAINT launch_refresh_state_pkey PRIMARY KEY (cache_key);


--
-- Name: launch_social_candidates launch_social_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_social_candidates
    ADD CONSTRAINT launch_social_candidates_pkey PRIMARY KEY (id);


--
-- Name: launch_social_matches launch_social_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_social_matches
    ADD CONSTRAINT launch_social_matches_pkey PRIMARY KEY (id);


--
-- Name: launch_trajectory_constraints launch_trajectory_constraints_launch_id_source_constraint_t_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_constraints
    ADD CONSTRAINT launch_trajectory_constraints_launch_id_source_constraint_t_key UNIQUE (launch_id, source, constraint_type, source_id);


--
-- Name: launch_trajectory_constraints launch_trajectory_constraints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_constraints
    ADD CONSTRAINT launch_trajectory_constraints_pkey PRIMARY KEY (id);


--
-- Name: launch_trajectory_products launch_trajectory_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_products
    ADD CONSTRAINT launch_trajectory_products_pkey PRIMARY KEY (launch_id);


--
-- Name: launch_updates launch_updates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_updates
    ADD CONSTRAINT launch_updates_pkey PRIMARY KEY (id);


--
-- Name: launch_weather launch_weather_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_weather
    ADD CONSTRAINT launch_weather_pkey PRIMARY KEY (id);


--
-- Name: launches launches_ll2_launch_uuid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches
    ADD CONSTRAINT launches_ll2_launch_uuid_key UNIQUE (ll2_launch_uuid);


--
-- Name: launches launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches
    ADD CONSTRAINT launches_pkey PRIMARY KEY (id);


--
-- Name: launches_public_cache launches_public_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches_public_cache
    ADD CONSTRAINT launches_public_cache_pkey PRIMARY KEY (launch_id);


--
-- Name: legal_acceptances legal_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_pkey PRIMARY KEY (id);


--
-- Name: ll2_agencies ll2_agencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_agencies
    ADD CONSTRAINT ll2_agencies_pkey PRIMARY KEY (ll2_agency_id);


--
-- Name: ll2_astronaut_launches ll2_astronaut_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_astronaut_launches
    ADD CONSTRAINT ll2_astronaut_launches_pkey PRIMARY KEY (ll2_astronaut_id, ll2_launch_uuid);


--
-- Name: ll2_astronauts ll2_astronauts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_astronauts
    ADD CONSTRAINT ll2_astronauts_pkey PRIMARY KEY (ll2_astronaut_id);


--
-- Name: ll2_catalog_public_cache ll2_catalog_public_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_catalog_public_cache
    ADD CONSTRAINT ll2_catalog_public_cache_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: ll2_docking_events ll2_docking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_docking_events
    ADD CONSTRAINT ll2_docking_events_pkey PRIMARY KEY (ll2_docking_event_id);


--
-- Name: ll2_event_launches ll2_event_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_event_launches
    ADD CONSTRAINT ll2_event_launches_pkey PRIMARY KEY (ll2_event_id, launch_id);


--
-- Name: ll2_events ll2_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_events
    ADD CONSTRAINT ll2_events_pkey PRIMARY KEY (ll2_event_id);


--
-- Name: ll2_expeditions ll2_expeditions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_expeditions
    ADD CONSTRAINT ll2_expeditions_pkey PRIMARY KEY (ll2_expedition_id);


--
-- Name: ll2_landings ll2_landings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_landings
    ADD CONSTRAINT ll2_landings_pkey PRIMARY KEY (ll2_landing_id);


--
-- Name: ll2_launch_landings ll2_launch_landings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launch_landings
    ADD CONSTRAINT ll2_launch_landings_pkey PRIMARY KEY (ll2_launch_uuid, ll2_landing_id, landing_role);


--
-- Name: ll2_launcher_launches ll2_launcher_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launcher_launches
    ADD CONSTRAINT ll2_launcher_launches_pkey PRIMARY KEY (ll2_launcher_id, ll2_launch_uuid);


--
-- Name: ll2_launchers ll2_launchers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launchers
    ADD CONSTRAINT ll2_launchers_pkey PRIMARY KEY (ll2_launcher_id);


--
-- Name: ll2_locations ll2_locations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_locations
    ADD CONSTRAINT ll2_locations_pkey PRIMARY KEY (ll2_location_id);


--
-- Name: ll2_pads ll2_pads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_pads
    ADD CONSTRAINT ll2_pads_pkey PRIMARY KEY (ll2_pad_id);


--
-- Name: ll2_payload_flight_docking_events ll2_payload_flight_docking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_flight_docking_events
    ADD CONSTRAINT ll2_payload_flight_docking_events_pkey PRIMARY KEY (ll2_payload_flight_id, ll2_docking_event_id);


--
-- Name: ll2_payload_flights ll2_payload_flights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_flights
    ADD CONSTRAINT ll2_payload_flights_pkey PRIMARY KEY (ll2_payload_flight_id);


--
-- Name: ll2_payload_types ll2_payload_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_types
    ADD CONSTRAINT ll2_payload_types_pkey PRIMARY KEY (ll2_payload_type_id);


--
-- Name: ll2_payloads ll2_payloads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payloads
    ADD CONSTRAINT ll2_payloads_pkey PRIMARY KEY (ll2_payload_id);


--
-- Name: ll2_rocket_configs ll2_rocket_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_rocket_configs
    ADD CONSTRAINT ll2_rocket_configs_pkey PRIMARY KEY (ll2_config_id);


--
-- Name: ll2_space_stations ll2_space_stations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_space_stations
    ADD CONSTRAINT ll2_space_stations_pkey PRIMARY KEY (ll2_space_station_id);


--
-- Name: ll2_spacecraft_configs ll2_spacecraft_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_configs
    ADD CONSTRAINT ll2_spacecraft_configs_pkey PRIMARY KEY (ll2_spacecraft_config_id);


--
-- Name: ll2_spacecraft_configurations ll2_spacecraft_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_configurations
    ADD CONSTRAINT ll2_spacecraft_configurations_pkey PRIMARY KEY (ll2_spacecraft_config_id);


--
-- Name: ll2_spacecraft_flight_docking_events ll2_spacecraft_flight_docking_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_flight_docking_events
    ADD CONSTRAINT ll2_spacecraft_flight_docking_events_pkey PRIMARY KEY (ll2_spacecraft_flight_id, ll2_docking_event_id);


--
-- Name: ll2_spacecraft_flights ll2_spacecraft_flights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_flights
    ADD CONSTRAINT ll2_spacecraft_flights_pkey PRIMARY KEY (ll2_spacecraft_flight_id);


--
-- Name: ll2_spacecraft_types ll2_spacecraft_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_types
    ADD CONSTRAINT ll2_spacecraft_types_pkey PRIMARY KEY (ll2_spacecraft_type_id);


--
-- Name: ll2_spacecrafts ll2_spacecrafts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecrafts
    ADD CONSTRAINT ll2_spacecrafts_pkey PRIMARY KEY (ll2_spacecraft_id);


--
-- Name: managed_scheduler_jobs managed_scheduler_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_scheduler_jobs
    ADD CONSTRAINT managed_scheduler_jobs_pkey PRIMARY KEY (cron_job_name);


--
-- Name: managed_scheduler_queue managed_scheduler_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_scheduler_queue
    ADD CONSTRAINT managed_scheduler_queue_pkey PRIMARY KEY (id);


--
-- Name: mobile_auth_risk_events mobile_auth_risk_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_risk_events
    ADD CONSTRAINT mobile_auth_risk_events_pkey PRIMARY KEY (id);


--
-- Name: mobile_auth_risk_sessions mobile_auth_risk_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_risk_sessions
    ADD CONSTRAINT mobile_auth_risk_sessions_pkey PRIMARY KEY (id);


--
-- Name: mobile_push_installations_v2 mobile_push_installations_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_installations_v2
    ADD CONSTRAINT mobile_push_installations_v2_pkey PRIMARY KEY (id);


--
-- Name: mobile_push_outbox_v2 mobile_push_outbox_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_outbox_v2
    ADD CONSTRAINT mobile_push_outbox_v2_pkey PRIMARY KEY (id);


--
-- Name: mobile_push_rules_v2 mobile_push_rules_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_rules_v2
    ADD CONSTRAINT mobile_push_rules_v2_pkey PRIMARY KEY (id);


--
-- Name: navcen_bnm_hazard_areas navcen_bnm_hazard_areas_message_id_area_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navcen_bnm_hazard_areas
    ADD CONSTRAINT navcen_bnm_hazard_areas_message_id_area_name_key UNIQUE (message_id, area_name);


--
-- Name: navcen_bnm_hazard_areas navcen_bnm_hazard_areas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navcen_bnm_hazard_areas
    ADD CONSTRAINT navcen_bnm_hazard_areas_pkey PRIMARY KEY (id);


--
-- Name: navcen_bnm_messages navcen_bnm_messages_navcen_guid_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navcen_bnm_messages
    ADD CONSTRAINT navcen_bnm_messages_navcen_guid_sha256_key UNIQUE (navcen_guid, sha256);


--
-- Name: navcen_bnm_messages navcen_bnm_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navcen_bnm_messages
    ADD CONSTRAINT navcen_bnm_messages_pkey PRIMARY KEY (id);


--
-- Name: notification_alert_rules notification_alert_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_alert_rules
    ADD CONSTRAINT notification_alert_rules_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notification_push_destinations_v3 notification_push_destinations_v3_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_destinations_v3
    ADD CONSTRAINT notification_push_destinations_v3_pkey PRIMARY KEY (id);


--
-- Name: notification_push_devices notification_push_devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_devices
    ADD CONSTRAINT notification_push_devices_pkey PRIMARY KEY (id);


--
-- Name: notification_rules_v3 notification_rules_v3_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules_v3
    ADD CONSTRAINT notification_rules_v3_pkey PRIMARY KEY (id);


--
-- Name: notification_usage_monthly notification_usage_monthly_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_usage_monthly
    ADD CONSTRAINT notification_usage_monthly_pkey PRIMARY KEY (user_id, month_start, channel);


--
-- Name: notifications_outbox notifications_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_pkey PRIMARY KEY (id);


--
-- Name: nws_points nws_points_coord_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nws_points
    ADD CONSTRAINT nws_points_coord_key_key UNIQUE (coord_key);


--
-- Name: nws_points nws_points_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nws_points
    ADD CONSTRAINT nws_points_pkey PRIMARY KEY (id);


--
-- Name: ops_alerts ops_alerts_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_alerts
    ADD CONSTRAINT ops_alerts_key_key UNIQUE (key);


--
-- Name: ops_alerts ops_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_alerts
    ADD CONSTRAINT ops_alerts_pkey PRIMARY KEY (id);


--
-- Name: ops_metrics_samples_1m ops_metrics_samples_1m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_metrics_samples_1m
    ADD CONSTRAINT ops_metrics_samples_1m_pkey PRIMARY KEY (id);


--
-- Name: ops_metrics_samples_5m ops_metrics_samples_5m_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_metrics_samples_5m
    ADD CONSTRAINT ops_metrics_samples_5m_pkey PRIMARY KEY (id);


--
-- Name: orbit_elements orbit_elements_norad_cat_id_source_epoch_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_elements
    ADD CONSTRAINT orbit_elements_norad_cat_id_source_epoch_key UNIQUE (norad_cat_id, source, epoch);


--
-- Name: orbit_elements orbit_elements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_elements
    ADD CONSTRAINT orbit_elements_pkey PRIMARY KEY (id);


--
-- Name: premium_claims premium_claims_claim_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_claims
    ADD CONSTRAINT premium_claims_claim_token_key UNIQUE (claim_token);


--
-- Name: premium_claims premium_claims_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_claims
    ADD CONSTRAINT premium_claims_pkey PRIMARY KEY (id);


--
-- Name: premium_onboarding_allow_creates premium_onboarding_allow_creates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_onboarding_allow_creates
    ADD CONSTRAINT premium_onboarding_allow_creates_pkey PRIMARY KEY (id);


--
-- Name: premium_onboarding_intents premium_onboarding_intents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_onboarding_intents
    ADD CONSTRAINT premium_onboarding_intents_pkey PRIMARY KEY (id);


--
-- Name: privacy_preferences privacy_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_preferences
    ADD CONSTRAINT privacy_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);


--
-- Name: program_contract_story_candidates program_contract_story_candidates_candidate_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_candidates
    ADD CONSTRAINT program_contract_story_candidates_candidate_key_key UNIQUE (candidate_key);


--
-- Name: program_contract_story_candidates program_contract_story_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_candidates
    ADD CONSTRAINT program_contract_story_candidates_pkey PRIMARY KEY (id);


--
-- Name: program_contract_story_discoveries program_contract_story_discoveries_discovery_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_discoveries
    ADD CONSTRAINT program_contract_story_discoveries_discovery_key_key UNIQUE (discovery_key);


--
-- Name: program_contract_story_discoveries program_contract_story_discoveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_discoveries
    ADD CONSTRAINT program_contract_story_discoveries_pkey PRIMARY KEY (id);


--
-- Name: program_contract_story_links program_contract_story_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_links
    ADD CONSTRAINT program_contract_story_links_pkey PRIMARY KEY (id);


--
-- Name: program_contract_story_links program_contract_story_links_story_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_links
    ADD CONSTRAINT program_contract_story_links_story_key_key UNIQUE (story_key);


--
-- Name: program_contract_story_source_links program_contract_story_source_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_source_links
    ADD CONSTRAINT program_contract_story_source_links_pkey PRIMARY KEY (id);


--
-- Name: program_contract_story_source_links program_contract_story_source_links_story_source_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_source_links
    ADD CONSTRAINT program_contract_story_source_links_story_source_unique UNIQUE (story_key, source_type, source_record_key);


--
-- Name: program_usaspending_scope_reviews program_usaspending_scope_reviews_identity_scope_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_usaspending_scope_reviews
    ADD CONSTRAINT program_usaspending_scope_reviews_identity_scope_key UNIQUE (award_identity_key, program_scope);


--
-- Name: program_usaspending_scope_reviews program_usaspending_scope_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_usaspending_scope_reviews
    ADD CONSTRAINT program_usaspending_scope_reviews_pkey PRIMARY KEY (id);


--
-- Name: providers_public_cache providers_public_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.providers_public_cache
    ADD CONSTRAINT providers_public_cache_pkey PRIMARY KEY (provider_key);


--
-- Name: purchase_entitlements purchase_entitlements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_entitlements
    ADD CONSTRAINT purchase_entitlements_pkey PRIMARY KEY (id);


--
-- Name: purchase_entitlements purchase_entitlements_user_id_entitlement_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_entitlements
    ADD CONSTRAINT purchase_entitlements_user_id_entitlement_key_key UNIQUE (user_id, entitlement_key);


--
-- Name: purchase_events purchase_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_events
    ADD CONSTRAINT purchase_events_pkey PRIMARY KEY (id);


--
-- Name: purchase_provider_customers purchase_provider_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_provider_customers
    ADD CONSTRAINT purchase_provider_customers_pkey PRIMARY KEY (id);


--
-- Name: purchase_provider_customers purchase_provider_customers_provider_provider_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_provider_customers
    ADD CONSTRAINT purchase_provider_customers_provider_provider_customer_id_key UNIQUE (provider, provider_customer_id);


--
-- Name: purchase_provider_customers purchase_provider_customers_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_provider_customers
    ADD CONSTRAINT purchase_provider_customers_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_user_id_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);


--
-- Name: rss_feeds rss_feeds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rss_feeds
    ADD CONSTRAINT rss_feeds_pkey PRIMARY KEY (id);


--
-- Name: sam_awards_extract_jobs sam_awards_extract_jobs_job_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_awards_extract_jobs
    ADD CONSTRAINT sam_awards_extract_jobs_job_key_key UNIQUE (job_key);


--
-- Name: sam_awards_extract_jobs sam_awards_extract_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_awards_extract_jobs
    ADD CONSTRAINT sam_awards_extract_jobs_pkey PRIMARY KEY (id);


--
-- Name: sam_entity_registry sam_entity_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_entity_registry
    ADD CONSTRAINT sam_entity_registry_pkey PRIMARY KEY (entity_key);


--
-- Name: sam_query_fingerprints sam_query_fingerprints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_query_fingerprints
    ADD CONSTRAINT sam_query_fingerprints_pkey PRIMARY KEY (fingerprint);


--
-- Name: sam_query_partitions sam_query_partitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_query_partitions
    ADD CONSTRAINT sam_query_partitions_pkey PRIMARY KEY (partition_key);


--
-- Name: satellite_group_memberships satellite_group_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.satellite_group_memberships
    ADD CONSTRAINT satellite_group_memberships_pkey PRIMARY KEY (group_code, norad_cat_id);


--
-- Name: satellites satellites_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.satellites
    ADD CONSTRAINT satellites_pkey PRIMARY KEY (norad_cat_id);


--
-- Name: search_documents search_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_documents
    ADD CONSTRAINT search_documents_pkey PRIMARY KEY (doc_id);


--
-- Name: search_sync_state search_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_sync_state
    ADD CONSTRAINT search_sync_state_pkey PRIMARY KEY (sync_key);


--
-- Name: snapi_item_events snapi_item_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_item_events
    ADD CONSTRAINT snapi_item_events_pkey PRIMARY KEY (snapi_uid, ll2_event_id);


--
-- Name: snapi_item_launches snapi_item_launches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_item_launches
    ADD CONSTRAINT snapi_item_launches_pkey PRIMARY KEY (snapi_uid, launch_id);


--
-- Name: snapi_items snapi_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_items
    ADD CONSTRAINT snapi_items_pkey PRIMARY KEY (snapi_uid);


--
-- Name: snapi_items snapi_items_snapi_id_item_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_items
    ADD CONSTRAINT snapi_items_snapi_id_item_type_key UNIQUE (snapi_id, item_type);


--
-- Name: social_accounts social_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_accounts
    ADD CONSTRAINT social_accounts_pkey PRIMARY KEY (id);


--
-- Name: social_posts social_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_pkey PRIMARY KEY (id);


--
-- Name: spacex_drone_ship_assignments spacex_drone_ship_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spacex_drone_ship_assignments
    ADD CONSTRAINT spacex_drone_ship_assignments_pkey PRIMARY KEY (launch_id);


--
-- Name: spacex_drone_ships spacex_drone_ships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spacex_drone_ships
    ADD CONSTRAINT spacex_drone_ships_pkey PRIMARY KEY (slug);


--
-- Name: stripe_customers stripe_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_pkey PRIMARY KEY (user_id);


--
-- Name: stripe_customers stripe_customers_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (user_id);


--
-- Name: subscriptions subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (key);


--
-- Name: tipjar_customers tipjar_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipjar_customers
    ADD CONSTRAINT tipjar_customers_pkey PRIMARY KEY (user_id);


--
-- Name: tipjar_customers tipjar_customers_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipjar_customers
    ADD CONSTRAINT tipjar_customers_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: trajectory_product_lineage trajectory_product_lineage_launch_id_product_version_genera_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_product_lineage
    ADD CONSTRAINT trajectory_product_lineage_launch_id_product_version_genera_key UNIQUE (launch_id, product_version, generated_at, source_ref_id);


--
-- Name: trajectory_product_lineage trajectory_product_lineage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_product_lineage
    ADD CONSTRAINT trajectory_product_lineage_pkey PRIMARY KEY (id);


--
-- Name: trajectory_source_contracts trajectory_source_contracts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_source_contracts
    ADD CONSTRAINT trajectory_source_contracts_pkey PRIMARY KEY (id);


--
-- Name: trajectory_source_documents trajectory_source_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_source_documents
    ADD CONSTRAINT trajectory_source_documents_pkey PRIMARY KEY (id);


--
-- Name: trajectory_source_documents trajectory_source_documents_url_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_source_documents
    ADD CONSTRAINT trajectory_source_documents_url_sha256_key UNIQUE (url, sha256);


--
-- Name: user_sign_in_events user_sign_in_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sign_in_events
    ADD CONSTRAINT user_sign_in_events_pkey PRIMARY KEY (id);


--
-- Name: user_surface_summary user_surface_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_surface_summary
    ADD CONSTRAINT user_surface_summary_pkey PRIMARY KEY (user_id);


--
-- Name: watchlist_rules watchlist_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_rules
    ADD CONSTRAINT watchlist_rules_pkey PRIMARY KEY (id);


--
-- Name: watchlists watchlists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_pkey PRIMARY KEY (id);


--
-- Name: webhook_events webhook_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_events
    ADD CONSTRAINT webhook_events_pkey PRIMARY KEY (id);


--
-- Name: ws45_forecast_parse_runs ws45_forecast_parse_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_forecast_parse_runs
    ADD CONSTRAINT ws45_forecast_parse_runs_pkey PRIMARY KEY (id);


--
-- Name: ws45_launch_forecasts ws45_launch_forecasts_pdf_url_pdf_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_launch_forecasts
    ADD CONSTRAINT ws45_launch_forecasts_pdf_url_pdf_sha256_key UNIQUE (pdf_url, pdf_sha256);


--
-- Name: ws45_launch_forecasts ws45_launch_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_launch_forecasts
    ADD CONSTRAINT ws45_launch_forecasts_pkey PRIMARY KEY (id);


--
-- Name: ws45_live_weather_snapshots ws45_live_weather_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_live_weather_snapshots
    ADD CONSTRAINT ws45_live_weather_snapshots_pkey PRIMARY KEY (id);


--
-- Name: ws45_planning_forecasts ws45_planning_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_planning_forecasts
    ADD CONSTRAINT ws45_planning_forecasts_pkey PRIMARY KEY (id);


--
-- Name: ws45_planning_forecasts ws45_planning_forecasts_product_kind_pdf_url_pdf_sha256_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_planning_forecasts
    ADD CONSTRAINT ws45_planning_forecasts_product_kind_pdf_url_pdf_sha256_key UNIQUE (product_kind, pdf_url, pdf_sha256);


--
-- Name: admin_access_override_events_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_access_override_events_user_created_at_idx ON public.admin_access_override_events USING btree (user_id, created_at DESC);


--
-- Name: admin_access_overrides_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX admin_access_overrides_updated_at_idx ON public.admin_access_overrides USING btree (updated_at DESC);


--
-- Name: ar_camera_guide_sessions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_camera_guide_sessions_created_at_idx ON public.ar_camera_guide_sessions USING btree (created_at DESC);


--
-- Name: ar_camera_guide_sessions_launch_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_camera_guide_sessions_launch_created_at_idx ON public.ar_camera_guide_sessions USING btree (launch_id, created_at DESC);


--
-- Name: ar_camera_guide_sessions_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_camera_guide_sessions_launch_id_idx ON public.ar_camera_guide_sessions USING btree (launch_id);


--
-- Name: ar_camera_guide_sessions_release_profile_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_camera_guide_sessions_release_profile_created_at_idx ON public.ar_camera_guide_sessions USING btree (release_profile, created_at DESC) WHERE (release_profile IS NOT NULL);


--
-- Name: ar_camera_guide_sessions_runtime_family_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ar_camera_guide_sessions_runtime_family_created_at_idx ON public.ar_camera_guide_sessions USING btree (runtime_family, created_at DESC);


--
-- Name: artemis_budget_lines_fiscal_year_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_budget_lines_fiscal_year_idx ON public.artemis_budget_lines USING btree (fiscal_year DESC);


--
-- Name: artemis_budget_lines_program_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_budget_lines_program_idx ON public.artemis_budget_lines USING btree (program);


--
-- Name: artemis_budget_lines_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_budget_lines_source_document_id_idx ON public.artemis_budget_lines USING btree (source_document_id);


--
-- Name: artemis_content_items_kind_pub_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_content_items_kind_pub_idx ON public.artemis_content_items USING btree (kind, published_at DESC NULLS LAST, captured_at DESC);


--
-- Name: artemis_content_items_mission_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_content_items_mission_kind_idx ON public.artemis_content_items USING btree (mission_key, kind, overall_score DESC, published_at DESC NULLS LAST);


--
-- Name: artemis_content_items_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_content_items_source_idx ON public.artemis_content_items USING btree (source_tier, source_class, source_type, overall_score DESC);


--
-- Name: artemis_content_items_source_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_content_items_source_key_idx ON public.artemis_content_items USING btree (source_key);


--
-- Name: artemis_content_scores_item_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_content_scores_item_time_idx ON public.artemis_content_scores USING btree (content_item_id, evaluated_at DESC);


--
-- Name: artemis_contract_actions_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_actions_contract_idx ON public.artemis_contract_actions USING btree (contract_id, action_date DESC NULLS LAST);


--
-- Name: artemis_contract_actions_missing_notice_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_actions_missing_notice_updated_idx ON public.artemis_contract_actions USING btree (updated_at DESC, contract_id, solicitation_id) WHERE ((solicitation_id IS NOT NULL) AND (sam_notice_id IS NULL));


--
-- Name: artemis_contract_actions_missing_solicitation_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_actions_missing_solicitation_updated_idx ON public.artemis_contract_actions USING btree (updated_at DESC, contract_id) WHERE (solicitation_id IS NULL);


--
-- Name: artemis_contract_actions_solicitation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_actions_solicitation_idx ON public.artemis_contract_actions USING btree (solicitation_id);


--
-- Name: artemis_contract_actions_source_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_actions_source_document_idx ON public.artemis_contract_actions USING btree (source_document_id);


--
-- Name: artemis_contract_actions_updated_action_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_actions_updated_action_contract_idx ON public.artemis_contract_actions USING btree (updated_at DESC, action_date DESC NULLS LAST, contract_id DESC);


--
-- Name: artemis_contract_budget_map_budget_line_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contract_budget_map_budget_line_idx ON public.artemis_contract_budget_map USING btree (budget_line_id, confidence DESC);


--
-- Name: artemis_contracts_base_award_updated_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contracts_base_award_updated_id_idx ON public.artemis_contracts USING btree (base_award_date DESC NULLS LAST, updated_at DESC, id DESC);


--
-- Name: artemis_contracts_mission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contracts_mission_idx ON public.artemis_contracts USING btree (mission_key, updated_at DESC);


--
-- Name: artemis_contracts_piid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contracts_piid_idx ON public.artemis_contracts USING btree (piid);


--
-- Name: artemis_contracts_piid_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contracts_piid_ref_idx ON public.artemis_contracts USING btree (piid, referenced_idv_piid);


--
-- Name: artemis_contracts_source_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contracts_source_document_idx ON public.artemis_contracts USING btree (source_document_id);


--
-- Name: artemis_contracts_updated_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_contracts_updated_id_idx ON public.artemis_contracts USING btree (updated_at DESC, id DESC);


--
-- Name: artemis_entities_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_entities_type_idx ON public.artemis_entities USING btree (entity_type);


--
-- Name: artemis_mission_components_mission_component_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX artemis_mission_components_mission_component_key ON public.artemis_mission_components USING btree (mission_key, component_normalized);


--
-- Name: artemis_mission_components_mission_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_mission_components_mission_sort_idx ON public.artemis_mission_components USING btree (mission_key, sort_order, updated_at DESC);


--
-- Name: artemis_mission_components_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_mission_components_source_document_id_idx ON public.artemis_mission_components USING btree (source_document_id);


--
-- Name: artemis_opportunity_notices_ptype_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_opportunity_notices_ptype_idx ON public.artemis_opportunity_notices USING btree (ptype, posted_date DESC NULLS LAST);


--
-- Name: artemis_opportunity_notices_solicitation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_opportunity_notices_solicitation_idx ON public.artemis_opportunity_notices USING btree (solicitation_id, posted_date DESC NULLS LAST);


--
-- Name: artemis_opportunity_notices_source_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_opportunity_notices_source_document_idx ON public.artemis_opportunity_notices USING btree (source_document_id);


--
-- Name: artemis_people_mission_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX artemis_people_mission_name_key ON public.artemis_people USING btree (mission_key, name_normalized);


--
-- Name: artemis_people_mission_sort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_people_mission_sort_idx ON public.artemis_people USING btree (mission_key, sort_order, updated_at DESC);


--
-- Name: artemis_people_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_people_source_document_id_idx ON public.artemis_people USING btree (source_document_id);


--
-- Name: artemis_procurement_awards_awarded_on_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_procurement_awards_awarded_on_idx ON public.artemis_procurement_awards USING btree (awarded_on DESC);


--
-- Name: artemis_procurement_awards_program_scope_awarded_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_procurement_awards_program_scope_awarded_idx ON public.artemis_procurement_awards USING btree (program_scope, awarded_on DESC, updated_at DESC);


--
-- Name: artemis_procurement_awards_scope_awarded_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_procurement_awards_scope_awarded_updated_idx ON public.artemis_procurement_awards USING btree (program_scope, awarded_on DESC, updated_at DESC) WHERE (program_scope IS NOT NULL);


--
-- Name: artemis_procurement_awards_source_doc_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_procurement_awards_source_doc_updated_idx ON public.artemis_procurement_awards USING btree (source_document_id, updated_at DESC, awarded_on DESC) WHERE (source_document_id IS NOT NULL);


--
-- Name: artemis_procurement_awards_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_procurement_awards_source_document_id_idx ON public.artemis_procurement_awards USING btree (source_document_id);


--
-- Name: artemis_program_procurement_cache_mission_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_program_procurement_cache_mission_order_idx ON public.artemis_program_procurement_cache USING btree (mission_key, updated_at DESC, awarded_on DESC NULLS LAST, contract_key DESC);


--
-- Name: artemis_program_procurement_cache_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_program_procurement_cache_order_idx ON public.artemis_program_procurement_cache USING btree (updated_at DESC, awarded_on DESC NULLS LAST, contract_key DESC);


--
-- Name: artemis_sam_contract_award_rows_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_sam_contract_award_rows_contract_idx ON public.artemis_sam_contract_award_rows USING btree (contract_id, updated_at DESC);


--
-- Name: artemis_sam_contract_award_rows_piid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_sam_contract_award_rows_piid_idx ON public.artemis_sam_contract_award_rows USING btree (piid, referenced_idv_piid);


--
-- Name: artemis_sam_contract_award_rows_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_sam_contract_award_rows_scope_idx ON public.artemis_sam_contract_award_rows USING btree (program_scope, updated_at DESC);


--
-- Name: artemis_sam_contract_award_rows_solicitation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_sam_contract_award_rows_solicitation_idx ON public.artemis_sam_contract_award_rows USING btree (solicitation_id);


--
-- Name: artemis_sam_contract_award_rows_source_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_sam_contract_award_rows_source_document_idx ON public.artemis_sam_contract_award_rows USING btree (source_document_id);


--
-- Name: artemis_social_accounts_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_social_accounts_active_idx ON public.artemis_social_accounts USING btree (active, mission_scope, source_tier);


--
-- Name: artemis_social_accounts_platform_handle_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX artemis_social_accounts_platform_handle_key ON public.artemis_social_accounts USING btree (platform, handle_normalized);


--
-- Name: artemis_source_documents_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_source_documents_fetched_at_idx ON public.artemis_source_documents USING btree (fetched_at DESC);


--
-- Name: artemis_source_documents_source_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_source_documents_source_key_idx ON public.artemis_source_documents USING btree (source_key);


--
-- Name: artemis_source_documents_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_source_documents_source_type_idx ON public.artemis_source_documents USING btree (source_type);


--
-- Name: artemis_source_registry_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_source_registry_active_idx ON public.artemis_source_registry USING btree (active, source_tier, source_type);


--
-- Name: artemis_spending_timeseries_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_spending_timeseries_contract_idx ON public.artemis_spending_timeseries USING btree (contract_id, fiscal_year DESC, fiscal_month DESC);


--
-- Name: artemis_timeline_events_announced_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_timeline_events_announced_time_idx ON public.artemis_timeline_events USING btree (announced_time DESC);


--
-- Name: artemis_timeline_events_mission_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_timeline_events_mission_time_idx ON public.artemis_timeline_events USING btree (mission_key, event_time DESC NULLS LAST);


--
-- Name: artemis_timeline_events_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_timeline_events_source_document_id_idx ON public.artemis_timeline_events USING btree (source_document_id);


--
-- Name: artemis_timeline_events_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_timeline_events_source_type_idx ON public.artemis_timeline_events USING btree (source_type);


--
-- Name: artemis_timeline_events_supersedes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX artemis_timeline_events_supersedes_idx ON public.artemis_timeline_events USING btree (supersedes_event_id);


--
-- Name: billing_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_events_type_idx ON public.billing_events USING btree (event_type);


--
-- Name: billing_events_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX billing_events_user_id_idx ON public.billing_events USING btree (user_id);


--
-- Name: blue_origin_contract_actions_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contract_actions_contract_idx ON public.blue_origin_contract_actions USING btree (contract_id, action_date DESC NULLS LAST);


--
-- Name: blue_origin_contract_actions_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contract_actions_source_document_id_idx ON public.blue_origin_contract_actions USING btree (source_document_id);


--
-- Name: blue_origin_contract_vehicle_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contract_vehicle_contract_idx ON public.blue_origin_contract_vehicle_map USING btree (contract_id, confidence DESC);


--
-- Name: blue_origin_contract_vehicle_map_engine_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contract_vehicle_map_engine_slug_idx ON public.blue_origin_contract_vehicle_map USING btree (engine_slug);


--
-- Name: blue_origin_contract_vehicle_map_vehicle_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contract_vehicle_map_vehicle_slug_idx ON public.blue_origin_contract_vehicle_map USING btree (vehicle_slug);


--
-- Name: blue_origin_contracts_mission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contracts_mission_idx ON public.blue_origin_contracts USING btree (mission_key, awarded_on DESC NULLS LAST);


--
-- Name: blue_origin_contracts_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contracts_source_document_id_idx ON public.blue_origin_contracts USING btree (source_document_id);


--
-- Name: blue_origin_contracts_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_contracts_updated_idx ON public.blue_origin_contracts USING btree (updated_at DESC);


--
-- Name: blue_origin_engines_mission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_engines_mission_idx ON public.blue_origin_engines USING btree (mission_key, updated_at DESC);


--
-- Name: blue_origin_engines_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_engines_source_document_id_idx ON public.blue_origin_engines USING btree (source_document_id);


--
-- Name: blue_origin_flights_mission_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_flights_mission_date_idx ON public.blue_origin_flights USING btree (mission_key, launch_date DESC NULLS LAST);


--
-- Name: blue_origin_ingest_checkpoints_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_ingest_checkpoints_status_idx ON public.blue_origin_ingest_checkpoints USING btree (status);


--
-- Name: blue_origin_ingest_checkpoints_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_ingest_checkpoints_updated_at_idx ON public.blue_origin_ingest_checkpoints USING btree (updated_at DESC);


--
-- Name: blue_origin_opportunity_notices_solicitation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_opportunity_notices_solicitation_idx ON public.blue_origin_opportunity_notices USING btree (solicitation_id, posted_date DESC NULLS LAST);


--
-- Name: blue_origin_opportunity_notices_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_opportunity_notices_source_document_id_idx ON public.blue_origin_opportunity_notices USING btree (source_document_id);


--
-- Name: blue_origin_passengers_launch_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blue_origin_passengers_launch_name_key ON public.blue_origin_passengers USING btree (launch_id, name_normalized);


--
-- Name: blue_origin_passengers_mission_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_passengers_mission_date_idx ON public.blue_origin_passengers USING btree (mission_key, launch_date DESC NULLS LAST);


--
-- Name: blue_origin_passengers_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_passengers_source_document_id_idx ON public.blue_origin_passengers USING btree (source_document_id);


--
-- Name: blue_origin_passengers_traveler_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_passengers_traveler_slug_idx ON public.blue_origin_passengers USING btree (traveler_slug);


--
-- Name: blue_origin_payloads_launch_name_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX blue_origin_payloads_launch_name_key ON public.blue_origin_payloads USING btree (launch_id, name_normalized);


--
-- Name: blue_origin_payloads_mission_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_payloads_mission_date_idx ON public.blue_origin_payloads USING btree (mission_key, launch_date DESC NULLS LAST);


--
-- Name: blue_origin_payloads_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_payloads_source_document_id_idx ON public.blue_origin_payloads USING btree (source_document_id);


--
-- Name: blue_origin_people_profiles_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_people_profiles_name_idx ON public.blue_origin_people_profiles USING btree (name);


--
-- Name: blue_origin_source_documents_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_source_documents_fetched_at_idx ON public.blue_origin_source_documents USING btree (fetched_at DESC);


--
-- Name: blue_origin_source_documents_source_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_source_documents_source_key_idx ON public.blue_origin_source_documents USING btree (source_key);


--
-- Name: blue_origin_source_documents_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_source_documents_source_type_idx ON public.blue_origin_source_documents USING btree (source_type);


--
-- Name: blue_origin_spending_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_spending_contract_idx ON public.blue_origin_spending_timeseries USING btree (contract_id, fiscal_year DESC, fiscal_month DESC);


--
-- Name: blue_origin_timeline_events_announced_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_timeline_events_announced_time_idx ON public.blue_origin_timeline_events USING btree (announced_time DESC);


--
-- Name: blue_origin_timeline_events_mission_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_timeline_events_mission_time_idx ON public.blue_origin_timeline_events USING btree (mission_key, event_time DESC NULLS LAST);


--
-- Name: blue_origin_timeline_events_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_timeline_events_source_document_id_idx ON public.blue_origin_timeline_events USING btree (source_document_id);


--
-- Name: blue_origin_timeline_events_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_timeline_events_source_type_idx ON public.blue_origin_timeline_events USING btree (source_type);


--
-- Name: blue_origin_traveler_sources_flight_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_traveler_sources_flight_code_idx ON public.blue_origin_traveler_sources USING btree (flight_code);


--
-- Name: blue_origin_traveler_sources_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_traveler_sources_slug_idx ON public.blue_origin_traveler_sources USING btree (traveler_slug);


--
-- Name: blue_origin_traveler_sources_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_traveler_sources_source_document_id_idx ON public.blue_origin_traveler_sources USING btree (source_document_id);


--
-- Name: blue_origin_traveler_sources_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_traveler_sources_source_type_idx ON public.blue_origin_traveler_sources USING btree (source_type);


--
-- Name: blue_origin_traveler_sources_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_traveler_sources_updated_at_idx ON public.blue_origin_traveler_sources USING btree (updated_at DESC);


--
-- Name: blue_origin_travelers_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_travelers_updated_at_idx ON public.blue_origin_travelers USING btree (updated_at DESC);


--
-- Name: blue_origin_vehicle_engine_engine_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_vehicle_engine_engine_idx ON public.blue_origin_vehicle_engine_map USING btree (engine_slug, updated_at DESC);


--
-- Name: blue_origin_vehicles_mission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_vehicles_mission_idx ON public.blue_origin_vehicles USING btree (mission_key, updated_at DESC);


--
-- Name: blue_origin_vehicles_source_document_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX blue_origin_vehicles_source_document_id_idx ON public.blue_origin_vehicles USING btree (source_document_id);


--
-- Name: calendar_feeds_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX calendar_feeds_token_key ON public.calendar_feeds USING btree (token);


--
-- Name: calendar_feeds_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX calendar_feeds_user_idx ON public.calendar_feeds USING btree (user_id, created_at DESC);


--
-- Name: canonical_contracts_cache_list_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_list_idx ON public.canonical_contracts_cache USING btree (sort_exact_rank, sort_date DESC NULLS LAST, scope, title, uid);


--
-- Name: canonical_contracts_cache_refreshed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_refreshed_idx ON public.canonical_contracts_cache USING btree (cache_refreshed_at DESC);


--
-- Name: canonical_contracts_cache_scope_award_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_scope_award_idx ON public.canonical_contracts_cache USING btree (scope, usaspending_award_id) WHERE (usaspending_award_id IS NOT NULL);


--
-- Name: canonical_contracts_cache_scope_contract_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_scope_contract_key_idx ON public.canonical_contracts_cache USING btree (scope, contract_key);


--
-- Name: canonical_contracts_cache_scope_list_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_scope_list_idx ON public.canonical_contracts_cache USING btree (scope, sort_exact_rank, sort_date DESC NULLS LAST, title, uid);


--
-- Name: canonical_contracts_cache_scope_piid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_scope_piid_idx ON public.canonical_contracts_cache USING btree (scope, piid) WHERE (piid IS NOT NULL);


--
-- Name: canonical_contracts_cache_search_text_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_search_text_trgm_idx ON public.canonical_contracts_cache USING gin (search_text extensions.gin_trgm_ops) WHERE (search_text <> ''::text);


--
-- Name: canonical_contracts_cache_story_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX canonical_contracts_cache_story_key_idx ON public.canonical_contracts_cache USING btree (story_key) WHERE (story_key IS NOT NULL);


--
-- Name: celestrak_datasets_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX celestrak_datasets_due_idx ON public.celestrak_datasets USING btree (dataset_type, enabled, last_attempt_at);


--
-- Name: celestrak_datasets_success_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX celestrak_datasets_success_idx ON public.celestrak_datasets USING btree (dataset_type, enabled, last_success_at);


--
-- Name: celestrak_intdes_datasets_catalog_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX celestrak_intdes_datasets_catalog_state_idx ON public.celestrak_intdes_datasets USING btree (catalog_state, last_checked_at DESC);


--
-- Name: celestrak_intdes_datasets_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX celestrak_intdes_datasets_due_idx ON public.celestrak_intdes_datasets USING btree (enabled, last_attempt_at);


--
-- Name: celestrak_intdes_datasets_success_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX celestrak_intdes_datasets_success_idx ON public.celestrak_intdes_datasets USING btree (enabled, last_success_at);


--
-- Name: discount_campaign_provider_artifacts_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discount_campaign_provider_artifacts_campaign_idx ON public.discount_campaign_provider_artifacts USING btree (campaign_id);


--
-- Name: discount_campaign_provider_artifacts_provider_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discount_campaign_provider_artifacts_provider_status_idx ON public.discount_campaign_provider_artifacts USING btree (provider, status, starts_at, ends_at);


--
-- Name: discount_campaign_provider_artifacts_scope_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX discount_campaign_provider_artifacts_scope_uidx ON public.discount_campaign_provider_artifacts USING btree (campaign_id, provider, artifact_kind);


--
-- Name: discount_campaign_targets_campaign_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX discount_campaign_targets_campaign_email_uidx ON public.discount_campaign_targets USING btree (campaign_id, lower(email)) WHERE (email IS NOT NULL);


--
-- Name: discount_campaign_targets_campaign_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discount_campaign_targets_campaign_idx ON public.discount_campaign_targets USING btree (campaign_id);


--
-- Name: discount_campaign_targets_campaign_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX discount_campaign_targets_campaign_user_uidx ON public.discount_campaign_targets USING btree (campaign_id, user_id) WHERE (user_id IS NOT NULL);


--
-- Name: discount_campaigns_product_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discount_campaigns_product_status_idx ON public.discount_campaigns USING btree (product_key, status, starts_at, ends_at);


--
-- Name: embed_widgets_preset_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embed_widgets_preset_id_idx ON public.embed_widgets USING btree (preset_id);


--
-- Name: embed_widgets_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX embed_widgets_token_key ON public.embed_widgets USING btree (token);


--
-- Name: embed_widgets_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embed_widgets_user_idx ON public.embed_widgets USING btree (user_id, created_at DESC);


--
-- Name: embed_widgets_watchlist_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX embed_widgets_watchlist_id_idx ON public.embed_widgets USING btree (watchlist_id);


--
-- Name: faa_launch_match_dirty_launches_last_queued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_launch_match_dirty_launches_last_queued_idx ON public.faa_launch_match_dirty_launches USING btree (last_queued_at);


--
-- Name: faa_launch_matches_auto_record_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_launch_matches_auto_record_updated_idx ON public.faa_launch_matches USING btree (match_origin, faa_tfr_record_id, updated_at DESC, id DESC);


--
-- Name: faa_launch_matches_faa_tfr_shape_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_launch_matches_faa_tfr_shape_id_idx ON public.faa_launch_matches USING btree (faa_tfr_shape_id);


--
-- Name: faa_launch_matches_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_launch_matches_launch_idx ON public.faa_launch_matches USING btree (launch_id, match_status, matched_at DESC);


--
-- Name: faa_launch_matches_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_launch_matches_record_idx ON public.faa_launch_matches USING btree (faa_tfr_record_id, match_status, matched_at DESC);


--
-- Name: faa_launch_matches_record_launch_origin_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX faa_launch_matches_record_launch_origin_uidx ON public.faa_launch_matches USING btree (faa_tfr_record_id, launch_id, match_origin) WHERE (launch_id IS NOT NULL);


--
-- Name: faa_launch_matches_record_null_launch_origin_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX faa_launch_matches_record_null_launch_origin_uidx ON public.faa_launch_matches USING btree (faa_tfr_record_id, match_origin) WHERE (launch_id IS NULL);


--
-- Name: faa_notam_details_faa_tfr_record_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_notam_details_faa_tfr_record_id_idx ON public.faa_notam_details USING btree (faa_tfr_record_id);


--
-- Name: faa_notam_details_notam_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_notam_details_notam_id_idx ON public.faa_notam_details USING btree (notam_id, fetched_at DESC);


--
-- Name: faa_tfr_records_mod_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_tfr_records_mod_at_idx ON public.faa_tfr_records USING btree (mod_at DESC);


--
-- Name: faa_tfr_records_notam_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_tfr_records_notam_id_idx ON public.faa_tfr_records USING btree (notam_id);


--
-- Name: faa_tfr_records_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_tfr_records_status_idx ON public.faa_tfr_records USING btree (status, has_shape);


--
-- Name: faa_tfr_records_valid_window_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_tfr_records_valid_window_gist ON public.faa_tfr_records USING gist (valid_window);


--
-- Name: faa_tfr_shapes_bbox_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_tfr_shapes_bbox_idx ON public.faa_tfr_shapes USING btree (bbox_min_lat, bbox_max_lat, bbox_min_lon, bbox_max_lon);


--
-- Name: faa_tfr_shapes_record_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX faa_tfr_shapes_record_idx ON public.faa_tfr_shapes USING btree (faa_tfr_record_id);


--
-- Name: feedback_submissions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_submissions_created_at_idx ON public.feedback_submissions USING btree (created_at DESC);


--
-- Name: feedback_submissions_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_submissions_launch_id_idx ON public.feedback_submissions USING btree (launch_id);


--
-- Name: feedback_submissions_lower_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_submissions_lower_email_idx ON public.feedback_submissions USING btree (lower(email));


--
-- Name: feedback_submissions_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feedback_submissions_user_id_idx ON public.feedback_submissions USING btree (user_id);


--
-- Name: ingestion_runs_job_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_runs_job_started_idx ON public.ingestion_runs USING btree (job_name, started_at DESC);


--
-- Name: ingestion_runs_job_success_ended_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_runs_job_success_ended_idx ON public.ingestion_runs USING btree (job_name, success, ended_at DESC) WHERE (ended_at IS NOT NULL);


--
-- Name: ingestion_runs_started_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_runs_started_at_idx ON public.ingestion_runs USING btree (started_at DESC);


--
-- Name: jep_background_light_cells_feature_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_background_light_cells_feature_period_idx ON public.jep_background_light_cells USING btree (observer_feature_key, period_start_date DESC, source_key);


--
-- Name: jep_background_light_cells_source_period_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_background_light_cells_source_period_idx ON public.jep_background_light_cells USING btree (source_key, period_start_date DESC, updated_at DESC);


--
-- Name: jep_corridor_cache_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_corridor_cache_launch_idx ON public.jep_corridor_cache USING btree (launch_id, fetched_at DESC);


--
-- Name: jep_feature_snapshots_family_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_feature_snapshots_family_model_idx ON public.jep_feature_snapshots USING btree (feature_family, model_version, computed_at DESC);


--
-- Name: jep_feature_snapshots_launch_observer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_feature_snapshots_launch_observer_idx ON public.jep_feature_snapshots USING btree (launch_id, observer_location_hash, computed_at DESC);


--
-- Name: jep_horizon_masks_observer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_horizon_masks_observer_idx ON public.jep_horizon_masks USING btree (observer_lat_bucket, observer_lon_bucket);


--
-- Name: jep_moon_ephemerides_feature_sample_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_moon_ephemerides_feature_sample_idx ON public.jep_moon_ephemerides USING btree (observer_feature_key, sample_at DESC);


--
-- Name: jep_moon_ephemerides_launch_observer_sample_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_moon_ephemerides_launch_observer_sample_idx ON public.jep_moon_ephemerides USING btree (launch_id, observer_location_hash, sample_at);


--
-- Name: jep_observer_locations_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_observer_locations_last_seen_idx ON public.jep_observer_locations USING btree (last_seen_at DESC);


--
-- Name: jep_outcome_reports_launch_reported_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_outcome_reports_launch_reported_idx ON public.jep_outcome_reports USING btree (launch_id, reported_at DESC);


--
-- Name: jep_outcome_reports_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_outcome_reports_outcome_idx ON public.jep_outcome_reports USING btree (outcome, reported_at DESC);


--
-- Name: jep_outcome_reports_reported_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_outcome_reports_reported_at_idx ON public.jep_outcome_reports USING btree (reported_at DESC);


--
-- Name: jep_profiles_vehicle_mission_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_profiles_vehicle_mission_idx ON public.jep_profiles USING btree (vehicle_slug, mission_type);


--
-- Name: jep_source_fetch_runs_source_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_source_fetch_runs_source_started_idx ON public.jep_source_fetch_runs USING btree (source_key, started_at DESC);


--
-- Name: jep_source_fetch_runs_status_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_source_fetch_runs_status_started_idx ON public.jep_source_fetch_runs USING btree (status, started_at DESC);


--
-- Name: jep_source_versions_source_release_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_source_versions_source_release_idx ON public.jep_source_versions USING btree (source_key, release_at DESC NULLS LAST, fetched_at DESC);


--
-- Name: jep_vehicle_priors_config_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_vehicle_priors_config_idx ON public.jep_vehicle_priors USING btree (ll2_rocket_config_id, pad_state);


--
-- Name: jep_vehicle_priors_provider_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX jep_vehicle_priors_provider_state_idx ON public.jep_vehicle_priors USING btree (provider_key, pad_state);


--
-- Name: launch_external_resources_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_external_resources_launch_idx ON public.launch_external_resources USING btree (launch_id, source, content_type);


--
-- Name: launch_external_resources_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_external_resources_source_idx ON public.launch_external_resources USING btree (source, content_type, fetched_at DESC);


--
-- Name: launch_filter_presets_default_one_per_user; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX launch_filter_presets_default_one_per_user ON public.launch_filter_presets USING btree (user_id) WHERE is_default;


--
-- Name: launch_filter_presets_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_filter_presets_user_idx ON public.launch_filter_presets USING btree (user_id, created_at DESC);


--
-- Name: launch_jep_score_candidates_launch_observer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_score_candidates_launch_observer_idx ON public.launch_jep_score_candidates USING btree (launch_id, observer_location_hash, computed_at DESC);


--
-- Name: launch_jep_score_candidates_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_score_candidates_model_idx ON public.launch_jep_score_candidates USING btree (model_version, computed_at DESC);


--
-- Name: launch_jep_scores_computed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_scores_computed_idx ON public.launch_jep_scores USING btree (computed_at DESC);


--
-- Name: launch_jep_scores_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_scores_expires_idx ON public.launch_jep_scores USING btree (expires_at);


--
-- Name: launch_jep_scores_launch_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_scores_launch_hash_idx ON public.launch_jep_scores USING btree (launch_id, observer_location_hash, expires_at);


--
-- Name: launch_jep_scores_observer_computed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_scores_observer_computed_idx ON public.launch_jep_scores USING btree (observer_location_hash, computed_at DESC);


--
-- Name: launch_jep_scores_probability_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_scores_probability_idx ON public.launch_jep_scores USING btree (launch_id, observer_location_hash, probability DESC);


--
-- Name: launch_jep_scores_snapshot_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_jep_scores_snapshot_idx ON public.launch_jep_scores USING btree (snapshot_at DESC) WHERE (snapshot_at IS NOT NULL);


--
-- Name: launch_notification_prefs_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_notification_prefs_launch_idx ON public.launch_notification_preferences USING btree (launch_id);


--
-- Name: launch_notification_prefs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_notification_prefs_user_idx ON public.launch_notification_preferences USING btree (user_id);


--
-- Name: launch_object_inventory_snapshot_items_norad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_object_inventory_snapshot_items_norad_idx ON public.launch_object_inventory_snapshot_items USING btree (norad_cat_id);


--
-- Name: launch_object_inventory_snapshot_items_snapshot_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_object_inventory_snapshot_items_snapshot_type_idx ON public.launch_object_inventory_snapshot_items USING btree (snapshot_id, object_type, object_id);


--
-- Name: launch_object_inventory_snapshots_designator_captured_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_object_inventory_snapshots_designator_captured_idx ON public.launch_object_inventory_snapshots USING btree (launch_designator, captured_at DESC);


--
-- Name: launch_pad_preview_cache_hard_expire_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_pad_preview_cache_hard_expire_at_idx ON public.launch_pad_preview_cache USING btree (hard_expire_at);


--
-- Name: launch_pad_preview_cache_ll2_pad_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_pad_preview_cache_ll2_pad_id_idx ON public.launch_pad_preview_cache USING btree (ll2_pad_id);


--
-- Name: launch_refresh_state_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_refresh_state_launch_id_idx ON public.launch_refresh_state USING btree (launch_id);


--
-- Name: launch_refresh_state_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_refresh_state_scope_idx ON public.launch_refresh_state USING btree (scope);


--
-- Name: launch_social_candidates_dedupe_key_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX launch_social_candidates_dedupe_key_uidx ON public.launch_social_candidates USING btree (dedupe_key);


--
-- Name: launch_social_candidates_external_post_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_social_candidates_external_post_idx ON public.launch_social_candidates USING btree (external_post_id);


--
-- Name: launch_social_candidates_launch_platform_fetched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_social_candidates_launch_platform_fetched_idx ON public.launch_social_candidates USING btree (launch_id, platform, fetched_at DESC);


--
-- Name: launch_social_matches_active_one_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX launch_social_matches_active_one_uidx ON public.launch_social_matches USING btree (launch_id, platform) WHERE active;


--
-- Name: launch_social_matches_launch_platform_matched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_social_matches_launch_platform_matched_idx ON public.launch_social_matches USING btree (launch_id, platform, matched_at DESC);


--
-- Name: launch_social_matches_launch_platform_post_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX launch_social_matches_launch_platform_post_uidx ON public.launch_social_matches USING btree (launch_id, platform, external_post_id);


--
-- Name: launch_trajectory_constraints_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_trajectory_constraints_launch_idx ON public.launch_trajectory_constraints USING btree (launch_id);


--
-- Name: launch_trajectory_constraints_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_trajectory_constraints_run_idx ON public.launch_trajectory_constraints USING btree (ingestion_run_id);


--
-- Name: launch_trajectory_products_generated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_trajectory_products_generated_idx ON public.launch_trajectory_products USING btree (generated_at DESC);


--
-- Name: launch_trajectory_products_ingestion_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_trajectory_products_ingestion_run_id_idx ON public.launch_trajectory_products USING btree (ingestion_run_id);


--
-- Name: launch_trajectory_products_quality_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_trajectory_products_quality_idx ON public.launch_trajectory_products USING btree (confidence_tier, freshness_state, generated_at DESC);


--
-- Name: launch_updates_detected_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_updates_detected_idx ON public.launch_updates USING btree (detected_at DESC);


--
-- Name: launch_updates_launch_id_detected_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_updates_launch_id_detected_at_idx ON public.launch_updates USING btree (launch_id, detected_at DESC);


--
-- Name: launch_updates_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_updates_launch_id_idx ON public.launch_updates USING btree (launch_id);


--
-- Name: launch_weather_issued_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_weather_issued_at_idx ON public.launch_weather USING btree (issued_at DESC);


--
-- Name: launch_weather_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_weather_launch_id_idx ON public.launch_weather USING btree (launch_id);


--
-- Name: launch_weather_launch_id_source_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX launch_weather_launch_id_source_uidx ON public.launch_weather USING btree (launch_id, source);


--
-- Name: launch_weather_valid_start_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launch_weather_valid_start_idx ON public.launch_weather USING btree (valid_start DESC);


--
-- Name: launches_filter_pad_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_filter_pad_state_idx ON public.launches USING btree (hidden, pad_country_code, pad_state) WHERE ((pad_state IS NOT NULL) AND (pad_state <> ''::text));


--
-- Name: launches_filter_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_filter_provider_idx ON public.launches USING btree (hidden, pad_country_code, provider) WHERE ((provider IS NOT NULL) AND (provider <> ''::text));


--
-- Name: launches_filter_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_filter_status_idx ON public.launches USING btree (hidden, pad_country_code, status_name) WHERE ((status_name IS NOT NULL) AND (status_name <> ''::text));


--
-- Name: launches_last_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_last_updated_idx ON public.launches USING btree (last_updated_source);


--
-- Name: launches_launch_designator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_launch_designator_idx ON public.launches USING btree (launch_designator);


--
-- Name: launches_ll2_agency_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_ll2_agency_id_idx ON public.launches USING btree (ll2_agency_id);


--
-- Name: launches_ll2_rocket_config_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_ll2_rocket_config_id_idx ON public.launches USING btree (ll2_rocket_config_id);


--
-- Name: launches_net_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_net_idx ON public.launches USING btree (net);


--
-- Name: launches_pad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_pad_idx ON public.launches USING btree (ll2_pad_id);


--
-- Name: launches_pad_short_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_pad_short_code_idx ON public.launches USING btree (pad_short_code);


--
-- Name: launches_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_provider_idx ON public.launches USING btree (provider);


--
-- Name: launches_public_cache_filter_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_filter_provider_idx ON public.launches_public_cache USING btree (hidden, pad_country_code, provider) WHERE ((provider IS NOT NULL) AND (provider <> ''::text));


--
-- Name: launches_public_cache_filter_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_filter_state_idx ON public.launches_public_cache USING btree (hidden, pad_country_code, pad_state) WHERE ((pad_state IS NOT NULL) AND (pad_state <> ''::text));


--
-- Name: launches_public_cache_filter_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_filter_status_idx ON public.launches_public_cache USING btree (hidden, pad_country_code, status_name) WHERE ((status_name IS NOT NULL) AND (status_name <> ''::text));


--
-- Name: launches_public_cache_launch_designator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_launch_designator_idx ON public.launches_public_cache USING btree (launch_designator) WHERE ((launch_designator IS NOT NULL) AND (launch_designator <> ''::text));


--
-- Name: launches_public_cache_ll2_agency_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_ll2_agency_id_idx ON public.launches_public_cache USING btree (ll2_agency_id);


--
-- Name: launches_public_cache_ll2_launch_uuid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_ll2_launch_uuid_idx ON public.launches_public_cache USING btree (ll2_launch_uuid);


--
-- Name: launches_public_cache_ll2_pad_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_ll2_pad_id_idx ON public.launches_public_cache USING btree (ll2_pad_id);


--
-- Name: launches_public_cache_ll2_rocket_config_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_ll2_rocket_config_id_idx ON public.launches_public_cache USING btree (ll2_rocket_config_id);


--
-- Name: launches_public_cache_mission_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_mission_name_trgm_idx ON public.launches_public_cache USING gin (mission_name extensions.gin_trgm_ops) WHERE (mission_name IS NOT NULL);


--
-- Name: launches_public_cache_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_name_trgm_idx ON public.launches_public_cache USING gin (name extensions.gin_trgm_ops) WHERE (name IS NOT NULL);


--
-- Name: launches_public_cache_net_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_net_idx ON public.launches_public_cache USING btree (net);


--
-- Name: launches_public_cache_pad_country_net_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_pad_country_net_provider_idx ON public.launches_public_cache USING btree (pad_country_code, net, provider);


--
-- Name: launches_public_cache_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_provider_idx ON public.launches_public_cache USING btree (provider);


--
-- Name: launches_public_cache_provider_key_generated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_provider_key_generated_idx ON public.launches_public_cache USING btree (lower(btrim(provider)), cache_generated_at DESC) WHERE ((provider IS NOT NULL) AND (btrim(provider) <> ''::text) AND (lower(btrim(provider)) <> 'unknown'::text));


--
-- Name: launches_public_cache_provider_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_provider_trgm_idx ON public.launches_public_cache USING gin (provider extensions.gin_trgm_ops) WHERE (provider IS NOT NULL);


--
-- Name: launches_public_cache_rocket_family_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_rocket_family_trgm_idx ON public.launches_public_cache USING gin (rocket_family extensions.gin_trgm_ops) WHERE (rocket_family IS NOT NULL);


--
-- Name: launches_public_cache_rocket_full_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_rocket_full_name_idx ON public.launches_public_cache USING btree (rocket_full_name);


--
-- Name: launches_public_cache_rocket_full_name_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_rocket_full_name_trgm_idx ON public.launches_public_cache USING gin (rocket_full_name extensions.gin_trgm_ops) WHERE (rocket_full_name IS NOT NULL);


--
-- Name: launches_public_cache_vehicle_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_vehicle_idx ON public.launches_public_cache USING btree (vehicle);


--
-- Name: launches_public_cache_vehicle_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_public_cache_vehicle_trgm_idx ON public.launches_public_cache USING gin (vehicle extensions.gin_trgm_ops) WHERE (vehicle IS NOT NULL);


--
-- Name: launches_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX launches_updated_at_idx ON public.launches USING btree (updated_at);


--
-- Name: legal_acceptances_user_document_version_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX legal_acceptances_user_document_version_uidx ON public.legal_acceptances USING btree (user_id, document_key, document_version);


--
-- Name: legal_acceptances_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX legal_acceptances_user_idx ON public.legal_acceptances USING btree (user_id, accepted_at DESC);


--
-- Name: ll2_astronaut_launches_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_astronaut_launches_launch_idx ON public.ll2_astronaut_launches USING btree (launch_id);


--
-- Name: ll2_astronaut_launches_ll2_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_astronaut_launches_ll2_idx ON public.ll2_astronaut_launches USING btree (ll2_launch_uuid);


--
-- Name: ll2_astronauts_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_astronauts_agency_idx ON public.ll2_astronauts USING btree (agency_id);


--
-- Name: ll2_astronauts_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_astronauts_name_idx ON public.ll2_astronauts USING btree (name);


--
-- Name: ll2_catalog_public_cache_country_codes_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_catalog_public_cache_country_codes_gin ON public.ll2_catalog_public_cache USING gin (country_codes);


--
-- Name: ll2_catalog_public_cache_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_catalog_public_cache_name_idx ON public.ll2_catalog_public_cache USING btree (name);


--
-- Name: ll2_catalog_public_cache_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_catalog_public_cache_type_idx ON public.ll2_catalog_public_cache USING btree (entity_type);


--
-- Name: ll2_docking_events_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_docking_events_launch_idx ON public.ll2_docking_events USING btree (launch_id);


--
-- Name: ll2_docking_events_station_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_docking_events_station_idx ON public.ll2_docking_events USING btree (space_station_id);


--
-- Name: ll2_event_launches_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_event_launches_launch_id_idx ON public.ll2_event_launches USING btree (launch_id);


--
-- Name: ll2_events_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_events_date_idx ON public.ll2_events USING btree (date DESC);


--
-- Name: ll2_events_last_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_events_last_updated_idx ON public.ll2_events USING btree (last_updated_source DESC);


--
-- Name: ll2_expeditions_station_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_expeditions_station_idx ON public.ll2_expeditions USING btree (space_station_id);


--
-- Name: ll2_launch_landings_landing_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_launch_landings_landing_idx ON public.ll2_launch_landings USING btree (ll2_landing_id);


--
-- Name: ll2_launch_landings_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_launch_landings_launch_idx ON public.ll2_launch_landings USING btree (launch_id, fetched_at DESC);


--
-- Name: ll2_launcher_launches_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_launcher_launches_launch_idx ON public.ll2_launcher_launches USING btree (launch_id);


--
-- Name: ll2_launcher_launches_ll2_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_launcher_launches_ll2_idx ON public.ll2_launcher_launches USING btree (ll2_launch_uuid);


--
-- Name: ll2_launchers_config_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_launchers_config_idx ON public.ll2_launchers USING btree (launcher_config_id);


--
-- Name: ll2_launchers_serial_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_launchers_serial_idx ON public.ll2_launchers USING btree (serial_number);


--
-- Name: ll2_pads_ll2_location_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_pads_ll2_location_id_idx ON public.ll2_pads USING btree (ll2_location_id);


--
-- Name: ll2_payload_flight_docking_events_docking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payload_flight_docking_events_docking_idx ON public.ll2_payload_flight_docking_events USING btree (ll2_payload_flight_id, docking);


--
-- Name: ll2_payload_flights_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payload_flights_launch_id_idx ON public.ll2_payload_flights USING btree (launch_id);


--
-- Name: ll2_payload_flights_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payload_flights_launch_idx ON public.ll2_payload_flights USING btree (ll2_launch_uuid, active);


--
-- Name: ll2_payload_flights_ll2_landing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payload_flights_ll2_landing_id_idx ON public.ll2_payload_flights USING btree (ll2_landing_id);


--
-- Name: ll2_payload_flights_payload_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payload_flights_payload_idx ON public.ll2_payload_flights USING btree (ll2_payload_id);


--
-- Name: ll2_payload_types_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payload_types_name_idx ON public.ll2_payload_types USING btree (name);


--
-- Name: ll2_payloads_manufacturer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payloads_manufacturer_idx ON public.ll2_payloads USING btree (manufacturer_id);


--
-- Name: ll2_payloads_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payloads_name_idx ON public.ll2_payloads USING btree (name);


--
-- Name: ll2_payloads_operator_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payloads_operator_idx ON public.ll2_payloads USING btree (operator_id);


--
-- Name: ll2_payloads_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_payloads_type_idx ON public.ll2_payloads USING btree (payload_type_id);


--
-- Name: ll2_space_stations_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_space_stations_name_idx ON public.ll2_space_stations USING btree (name);


--
-- Name: ll2_spacecraft_config_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_config_agency_idx ON public.ll2_spacecraft_configurations USING btree (agency_id);


--
-- Name: ll2_spacecraft_config_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_config_name_idx ON public.ll2_spacecraft_configurations USING btree (name);


--
-- Name: ll2_spacecraft_configs_agency_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_configs_agency_idx ON public.ll2_spacecraft_configs USING btree (agency_id);


--
-- Name: ll2_spacecraft_configs_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_configs_type_idx ON public.ll2_spacecraft_configs USING btree (spacecraft_type_id);


--
-- Name: ll2_spacecraft_flight_docking_events_docking_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_flight_docking_events_docking_idx ON public.ll2_spacecraft_flight_docking_events USING btree (ll2_spacecraft_flight_id, docking);


--
-- Name: ll2_spacecraft_flights_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_flights_launch_id_idx ON public.ll2_spacecraft_flights USING btree (launch_id);


--
-- Name: ll2_spacecraft_flights_launch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_flights_launch_idx ON public.ll2_spacecraft_flights USING btree (ll2_launch_uuid, active);


--
-- Name: ll2_spacecraft_flights_ll2_landing_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_flights_ll2_landing_id_idx ON public.ll2_spacecraft_flights USING btree (ll2_landing_id);


--
-- Name: ll2_spacecraft_flights_spacecraft_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_flights_spacecraft_idx ON public.ll2_spacecraft_flights USING btree (ll2_spacecraft_id);


--
-- Name: ll2_spacecraft_types_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecraft_types_name_idx ON public.ll2_spacecraft_types USING btree (name);


--
-- Name: ll2_spacecrafts_config_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecrafts_config_idx ON public.ll2_spacecrafts USING btree (spacecraft_config_id);


--
-- Name: ll2_spacecrafts_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ll2_spacecrafts_name_idx ON public.ll2_spacecrafts USING btree (name);


--
-- Name: managed_scheduler_jobs_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX managed_scheduler_jobs_due_idx ON public.managed_scheduler_jobs USING btree (enabled, next_run_at);


--
-- Name: managed_scheduler_queue_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX managed_scheduler_queue_claim_idx ON public.managed_scheduler_queue USING btree (status, scheduled_for, id);


--
-- Name: managed_scheduler_queue_finished_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX managed_scheduler_queue_finished_idx ON public.managed_scheduler_queue USING btree (status, COALESCE(finished_at, created_at));


--
-- Name: managed_scheduler_queue_job_scheduled_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX managed_scheduler_queue_job_scheduled_uniq ON public.managed_scheduler_queue USING btree (cron_job_name, scheduled_for);


--
-- Name: mobile_auth_risk_events_session_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_auth_risk_events_session_created_idx ON public.mobile_auth_risk_events USING btree (session_id, created_at DESC);


--
-- Name: mobile_auth_risk_sessions_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_auth_risk_sessions_created_at_idx ON public.mobile_auth_risk_sessions USING btree (created_at DESC);


--
-- Name: mobile_auth_risk_sessions_email_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_auth_risk_sessions_email_hash_idx ON public.mobile_auth_risk_sessions USING btree (email_hash);


--
-- Name: mobile_auth_risk_sessions_installation_hash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_auth_risk_sessions_installation_hash_idx ON public.mobile_auth_risk_sessions USING btree (installation_hash);


--
-- Name: mobile_auth_risk_sessions_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_auth_risk_sessions_user_created_at_idx ON public.mobile_auth_risk_sessions USING btree (user_id, created_at DESC);


--
-- Name: mobile_push_installations_v2_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_push_installations_v2_active_idx ON public.mobile_push_installations_v2 USING btree (owner_kind, is_active, updated_at DESC);


--
-- Name: mobile_push_installations_v2_guest_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_installations_v2_guest_unique_idx ON public.mobile_push_installations_v2 USING btree (installation_id, platform) WHERE (owner_kind = 'guest'::text);


--
-- Name: mobile_push_installations_v2_user_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_installations_v2_user_unique_idx ON public.mobile_push_installations_v2 USING btree (user_id, platform, installation_id) WHERE (owner_kind = 'user'::text);


--
-- Name: mobile_push_outbox_v2_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_push_outbox_v2_owner_idx ON public.mobile_push_outbox_v2 USING btree (owner_kind, user_id, installation_id, scheduled_for DESC);


--
-- Name: mobile_push_outbox_v2_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_push_outbox_v2_status_idx ON public.mobile_push_outbox_v2 USING btree (status, scheduled_for);


--
-- Name: mobile_push_rules_v2_guest_all_us_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_guest_all_us_unique_idx ON public.mobile_push_rules_v2 USING btree (installation_id) WHERE ((owner_kind = 'guest'::text) AND (scope_kind = 'all_us'::text));


--
-- Name: mobile_push_rules_v2_guest_launch_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_guest_launch_unique_idx ON public.mobile_push_rules_v2 USING btree (installation_id, launch_id) WHERE ((owner_kind = 'guest'::text) AND (scope_kind = 'launch'::text));


--
-- Name: mobile_push_rules_v2_guest_state_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_guest_state_unique_idx ON public.mobile_push_rules_v2 USING btree (installation_id, state) WHERE ((owner_kind = 'guest'::text) AND (scope_kind = 'state'::text));


--
-- Name: mobile_push_rules_v2_owner_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX mobile_push_rules_v2_owner_updated_idx ON public.mobile_push_rules_v2 USING btree (owner_kind, user_id, installation_id, updated_at DESC);


--
-- Name: mobile_push_rules_v2_user_all_launches_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_user_all_launches_unique_idx ON public.mobile_push_rules_v2 USING btree (user_id) WHERE ((owner_kind = 'user'::text) AND (scope_kind = 'all_launches'::text));


--
-- Name: mobile_push_rules_v2_user_all_us_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_user_all_us_unique_idx ON public.mobile_push_rules_v2 USING btree (user_id) WHERE ((owner_kind = 'user'::text) AND (scope_kind = 'all_us'::text));


--
-- Name: mobile_push_rules_v2_user_follow_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_user_follow_unique_idx ON public.mobile_push_rules_v2 USING btree (user_id, follow_rule_type, follow_rule_value) WHERE ((owner_kind = 'user'::text) AND (scope_kind = 'follow'::text));


--
-- Name: mobile_push_rules_v2_user_launch_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_user_launch_unique_idx ON public.mobile_push_rules_v2 USING btree (user_id, launch_id) WHERE ((owner_kind = 'user'::text) AND (scope_kind = 'launch'::text));


--
-- Name: mobile_push_rules_v2_user_preset_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_user_preset_unique_idx ON public.mobile_push_rules_v2 USING btree (user_id, filter_preset_id) WHERE ((owner_kind = 'user'::text) AND (scope_kind = 'preset'::text));


--
-- Name: mobile_push_rules_v2_user_state_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX mobile_push_rules_v2_user_state_unique_idx ON public.mobile_push_rules_v2 USING btree (user_id, state) WHERE ((owner_kind = 'user'::text) AND (scope_kind = 'state'::text));


--
-- Name: navcen_bnm_hazard_areas_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_hazard_areas_fetched_at_idx ON public.navcen_bnm_hazard_areas USING btree (created_at DESC);


--
-- Name: navcen_bnm_hazard_areas_matched_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_hazard_areas_matched_launch_id_idx ON public.navcen_bnm_hazard_areas USING btree (matched_launch_id);


--
-- Name: navcen_bnm_hazard_areas_message_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_hazard_areas_message_id_idx ON public.navcen_bnm_hazard_areas USING btree (message_id);


--
-- Name: navcen_bnm_hazard_areas_navcen_guid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_hazard_areas_navcen_guid_idx ON public.navcen_bnm_hazard_areas USING btree (navcen_guid);


--
-- Name: navcen_bnm_hazard_areas_valid_window_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_hazard_areas_valid_window_gist ON public.navcen_bnm_hazard_areas USING gist (valid_window);


--
-- Name: navcen_bnm_messages_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_messages_fetched_at_idx ON public.navcen_bnm_messages USING btree (fetched_at DESC);


--
-- Name: navcen_bnm_messages_navcen_guid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_messages_navcen_guid_idx ON public.navcen_bnm_messages USING btree (navcen_guid);


--
-- Name: navcen_bnm_messages_valid_window_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX navcen_bnm_messages_valid_window_gist ON public.navcen_bnm_messages USING gist (valid_window);


--
-- Name: notification_alert_rules_filter_preset_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_alert_rules_filter_preset_unique_idx ON public.notification_alert_rules USING btree (user_id, filter_preset_id) WHERE (kind = 'filter_preset'::text);


--
-- Name: notification_alert_rules_follow_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_alert_rules_follow_unique_idx ON public.notification_alert_rules USING btree (user_id, follow_rule_type, follow_rule_value) WHERE (kind = 'follow'::text);


--
-- Name: notification_alert_rules_region_us_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_alert_rules_region_us_unique_idx ON public.notification_alert_rules USING btree (user_id) WHERE (kind = 'region_us'::text);


--
-- Name: notification_alert_rules_state_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_alert_rules_state_unique_idx ON public.notification_alert_rules USING btree (user_id, state) WHERE (kind = 'state'::text);


--
-- Name: notification_alert_rules_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_alert_rules_user_idx ON public.notification_alert_rules USING btree (user_id, updated_at DESC);


--
-- Name: notification_push_destinations_v3_owner_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_push_destinations_v3_owner_active_idx ON public.notification_push_destinations_v3 USING btree (owner_kind, owner_key, is_active, updated_at DESC);


--
-- Name: notification_push_destinations_v3_owner_key_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_push_destinations_v3_owner_key_unique_idx ON public.notification_push_destinations_v3 USING btree (owner_key, destination_key);


--
-- Name: notification_push_devices_active_user_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_push_devices_active_user_updated_idx ON public.notification_push_devices USING btree (user_id, is_active, updated_at DESC);


--
-- Name: notification_push_devices_user_platform_installation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_push_devices_user_platform_installation_idx ON public.notification_push_devices USING btree (user_id, platform, installation_id);


--
-- Name: notification_push_devices_user_platform_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_push_devices_user_platform_token_idx ON public.notification_push_devices USING btree (user_id, platform, token);


--
-- Name: notification_push_devices_user_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_push_devices_user_updated_idx ON public.notification_push_devices USING btree (user_id, updated_at DESC);


--
-- Name: notification_rules_v3_following_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_rules_v3_following_idx ON public.notification_rules_v3 USING btree (owner_kind, owner_key, visible_in_following, updated_at DESC) WHERE (visible_in_following IS TRUE);


--
-- Name: notification_rules_v3_owner_scope_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_rules_v3_owner_scope_unique_idx ON public.notification_rules_v3 USING btree (owner_key, scope_kind, scope_key);


--
-- Name: notification_rules_v3_owner_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_rules_v3_owner_updated_idx ON public.notification_rules_v3 USING btree (owner_kind, owner_key, updated_at DESC);


--
-- Name: notifications_outbox_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_outbox_launch_id_idx ON public.notifications_outbox USING btree (launch_id);


--
-- Name: notifications_outbox_owner_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_outbox_owner_status_idx ON public.notifications_outbox USING btree (owner_kind, owner_key, status, scheduled_for);


--
-- Name: notifications_outbox_push_destination_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_outbox_push_destination_idx ON public.notifications_outbox USING btree (push_destination_id, status, scheduled_for) WHERE (push_destination_id IS NOT NULL);


--
-- Name: notifications_outbox_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_outbox_status_idx ON public.notifications_outbox USING btree (status, scheduled_for);


--
-- Name: notifications_outbox_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_outbox_user_id_idx ON public.notifications_outbox USING btree (user_id);


--
-- Name: nws_points_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nws_points_fetched_at_idx ON public.nws_points USING btree (fetched_at DESC);


--
-- Name: nws_points_grid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX nws_points_grid_idx ON public.nws_points USING btree (grid_id, grid_x, grid_y);


--
-- Name: nws_points_ll2_pad_id_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX nws_points_ll2_pad_id_uidx ON public.nws_points USING btree (ll2_pad_id) WHERE (ll2_pad_id IS NOT NULL);


--
-- Name: ops_alerts_resolved_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_alerts_resolved_idx ON public.ops_alerts USING btree (resolved, severity, last_seen_at DESC);


--
-- Name: ops_metrics_samples_1m_metric_sampled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_metrics_samples_1m_metric_sampled_idx ON public.ops_metrics_samples_1m USING btree (metric_key, sampled_at DESC);


--
-- Name: ops_metrics_samples_1m_sampled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_metrics_samples_1m_sampled_idx ON public.ops_metrics_samples_1m USING btree (sampled_at DESC);


--
-- Name: ops_metrics_samples_1m_uniq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ops_metrics_samples_1m_uniq_idx ON public.ops_metrics_samples_1m USING btree (sampled_at, metric_key, labels);


--
-- Name: ops_metrics_samples_5m_metric_sampled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_metrics_samples_5m_metric_sampled_idx ON public.ops_metrics_samples_5m USING btree (metric_key, sampled_at DESC);


--
-- Name: ops_metrics_samples_5m_sampled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_metrics_samples_5m_sampled_idx ON public.ops_metrics_samples_5m USING btree (sampled_at DESC);


--
-- Name: ops_metrics_samples_5m_uniq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ops_metrics_samples_5m_uniq_idx ON public.ops_metrics_samples_5m USING btree (sampled_at, metric_key, labels);


--
-- Name: orbit_elements_epoch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_elements_epoch_idx ON public.orbit_elements USING btree (epoch);


--
-- Name: orbit_elements_norad_epoch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_elements_norad_epoch_idx ON public.orbit_elements USING btree (norad_cat_id, epoch DESC);


--
-- Name: orbit_elements_source_epoch_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_elements_source_epoch_idx ON public.orbit_elements USING btree (source, epoch DESC);


--
-- Name: orbit_elements_supgp_group_or_source_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX orbit_elements_supgp_group_or_source_trgm_idx ON public.orbit_elements USING gin (group_or_source extensions.gin_trgm_ops) WHERE ((source = 'supgp'::text) AND (group_or_source IS NOT NULL));


--
-- Name: premium_claims_checkout_session_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX premium_claims_checkout_session_uidx ON public.premium_claims USING btree (checkout_session_id) WHERE (checkout_session_id IS NOT NULL);


--
-- Name: premium_claims_provider_event_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX premium_claims_provider_event_uidx ON public.premium_claims USING btree (provider, provider_event_id) WHERE (provider_event_id IS NOT NULL);


--
-- Name: premium_claims_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX premium_claims_status_idx ON public.premium_claims USING btree (status, updated_at DESC);


--
-- Name: premium_claims_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX premium_claims_user_idx ON public.premium_claims USING btree (user_id, updated_at DESC);


--
-- Name: premium_onboarding_allow_creates_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX premium_onboarding_allow_creates_claim_idx ON public.premium_onboarding_allow_creates USING btree (claim_id, expires_at DESC) WHERE (claim_id IS NOT NULL);


--
-- Name: premium_onboarding_allow_creates_claim_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX premium_onboarding_allow_creates_claim_uidx ON public.premium_onboarding_allow_creates USING btree (claim_id) WHERE (claim_id IS NOT NULL);


--
-- Name: premium_onboarding_allow_creates_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX premium_onboarding_allow_creates_expires_idx ON public.premium_onboarding_allow_creates USING btree (expires_at DESC);


--
-- Name: premium_onboarding_allow_creates_provider_email_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX premium_onboarding_allow_creates_provider_email_uidx ON public.premium_onboarding_allow_creates USING btree (provider, email_normalized);


--
-- Name: premium_onboarding_intents_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX premium_onboarding_intents_expires_idx ON public.premium_onboarding_intents USING btree (expires_at DESC);


--
-- Name: premium_onboarding_intents_viewer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX premium_onboarding_intents_viewer_idx ON public.premium_onboarding_intents USING btree (viewer_id, updated_at DESC);


--
-- Name: profiles_calendar_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_calendar_token_key ON public.profiles USING btree (calendar_token);


--
-- Name: profiles_embed_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_embed_token_key ON public.profiles USING btree (embed_token);


--
-- Name: profiles_marketing_unsubscribe_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX profiles_marketing_unsubscribe_token_key ON public.profiles USING btree (marketing_unsubscribe_token);


--
-- Name: program_contract_story_candidates_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_candidates_scope_status_idx ON public.program_contract_story_candidates USING btree (program_scope, status, confidence_tier, updated_at DESC);


--
-- Name: program_contract_story_candidates_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_candidates_source_idx ON public.program_contract_story_candidates USING btree (source_type, source_record_key);


--
-- Name: program_contract_story_candidates_story_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_candidates_story_idx ON public.program_contract_story_candidates USING btree (candidate_story_key) WHERE (candidate_story_key IS NOT NULL);


--
-- Name: program_contract_story_discoveries_scope_identifier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_discoveries_scope_identifier_idx ON public.program_contract_story_discoveries USING btree (program_scope, piid, solicitation_id, notice_id);


--
-- Name: program_contract_story_discoveries_scope_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_discoveries_scope_status_idx ON public.program_contract_story_discoveries USING btree (program_scope, join_status, published_at DESC, updated_at DESC);


--
-- Name: program_contract_story_discoveries_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_discoveries_source_idx ON public.program_contract_story_discoveries USING btree (source_type, source_record_key);


--
-- Name: program_contract_story_discoveries_story_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_discoveries_story_idx ON public.program_contract_story_discoveries USING btree (best_candidate_story_key) WHERE (best_candidate_story_key IS NOT NULL);


--
-- Name: program_contract_story_links_scope_award_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_award_idx ON public.program_contract_story_links USING btree (program_scope, primary_usaspending_award_id);


--
-- Name: program_contract_story_links_scope_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_contract_idx ON public.program_contract_story_links USING btree (program_scope, primary_contract_key);


--
-- Name: program_contract_story_links_scope_notice_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_notice_idx ON public.program_contract_story_links USING btree (program_scope, primary_notice_id);


--
-- Name: program_contract_story_links_scope_piid_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_piid_idx ON public.program_contract_story_links USING btree (program_scope, primary_piid);


--
-- Name: program_contract_story_links_scope_solicitation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_solicitation_idx ON public.program_contract_story_links USING btree (program_scope, primary_solicitation_id);


--
-- Name: program_contract_story_links_scope_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_updated_idx ON public.program_contract_story_links USING btree (program_scope, updated_at DESC);


--
-- Name: program_contract_story_links_scope_updated_story_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_links_scope_updated_story_idx ON public.program_contract_story_links USING btree (program_scope, updated_at DESC, story_key);


--
-- Name: program_contract_story_source_links_scope_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_source_links_scope_source_idx ON public.program_contract_story_source_links USING btree (program_scope, source_type, updated_at DESC);


--
-- Name: program_contract_story_source_links_story_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_contract_story_source_links_story_idx ON public.program_contract_story_source_links USING btree (story_key, source_type, published_at DESC, updated_at DESC);


--
-- Name: program_usaspending_scope_reviews_scope_updated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_usaspending_scope_reviews_scope_updated_idx ON public.program_usaspending_scope_reviews USING btree (program_scope, updated_at DESC);


--
-- Name: program_usaspending_scope_reviews_tier_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX program_usaspending_scope_reviews_tier_idx ON public.program_usaspending_scope_reviews USING btree (program_scope, auto_tier, final_tier, review_status);


--
-- Name: providers_public_cache_name_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX providers_public_cache_name_idx ON public.providers_public_cache USING btree (name);


--
-- Name: purchase_entitlements_provider_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_entitlements_provider_status_idx ON public.purchase_entitlements USING btree (provider, status);


--
-- Name: purchase_entitlements_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_entitlements_user_idx ON public.purchase_entitlements USING btree (user_id);


--
-- Name: purchase_events_provider_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_events_provider_idx ON public.purchase_events USING btree (provider, created_at DESC);


--
-- Name: purchase_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_events_user_idx ON public.purchase_events USING btree (user_id, created_at DESC);


--
-- Name: purchase_provider_customers_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX purchase_provider_customers_user_idx ON public.purchase_provider_customers USING btree (user_id);


--
-- Name: rss_feeds_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX rss_feeds_token_key ON public.rss_feeds USING btree (token);


--
-- Name: rss_feeds_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rss_feeds_user_idx ON public.rss_feeds USING btree (user_id, created_at DESC);


--
-- Name: sam_awards_extract_jobs_contract_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_awards_extract_jobs_contract_idx ON public.sam_awards_extract_jobs USING btree (contract_id, updated_at DESC);


--
-- Name: sam_awards_extract_jobs_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_awards_extract_jobs_status_idx ON public.sam_awards_extract_jobs USING btree (status, updated_at);


--
-- Name: sam_entity_registry_cage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_entity_registry_cage_idx ON public.sam_entity_registry USING btree (cage);


--
-- Name: sam_entity_registry_parent_uei_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_entity_registry_parent_uei_idx ON public.sam_entity_registry USING btree (parent_uei);


--
-- Name: sam_entity_registry_uei_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_entity_registry_uei_idx ON public.sam_entity_registry USING btree (uei);


--
-- Name: sam_query_fingerprints_cooldown_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_query_fingerprints_cooldown_idx ON public.sam_query_fingerprints USING btree (cooldown_until);


--
-- Name: sam_query_fingerprints_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_query_fingerprints_endpoint_idx ON public.sam_query_fingerprints USING btree (endpoint, updated_at DESC);


--
-- Name: sam_query_fingerprints_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_query_fingerprints_retry_idx ON public.sam_query_fingerprints USING btree (next_retry_at);


--
-- Name: sam_query_partitions_retry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_query_partitions_retry_idx ON public.sam_query_partitions USING btree (next_retry_at);


--
-- Name: sam_query_partitions_scan_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sam_query_partitions_scan_idx ON public.sam_query_partitions USING btree (endpoint, status, last_scanned_at);


--
-- Name: satellite_group_memberships_group_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX satellite_group_memberships_group_last_seen_idx ON public.satellite_group_memberships USING btree (group_code, last_seen_at DESC);


--
-- Name: satellite_group_memberships_norad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX satellite_group_memberships_norad_idx ON public.satellite_group_memberships USING btree (norad_cat_id);


--
-- Name: satellites_intl_des_pattern_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX satellites_intl_des_pattern_idx ON public.satellites USING btree (intl_des text_pattern_ops);


--
-- Name: satellites_object_type_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX satellites_object_type_owner_idx ON public.satellites USING btree (object_type, owner);


--
-- Name: satellites_owner_updated_norad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX satellites_owner_updated_norad_idx ON public.satellites USING btree (owner, satcat_updated_at DESC, norad_cat_id DESC) WHERE ((owner IS NOT NULL) AND (owner <> ''::text));


--
-- Name: satellites_satcat_updated_norad_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX satellites_satcat_updated_norad_idx ON public.satellites USING btree (satcat_updated_at DESC, norad_cat_id DESC) WHERE (norad_cat_id IS NOT NULL);


--
-- Name: search_documents_doc_type_published_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_documents_doc_type_published_idx ON public.search_documents USING btree (doc_type, published_at DESC NULLS LAST);


--
-- Name: search_documents_search_vector_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_documents_search_vector_idx ON public.search_documents USING gin (search_vector);


--
-- Name: search_documents_source_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_documents_source_type_idx ON public.search_documents USING btree (source_type);


--
-- Name: search_documents_title_alias_prefix_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_documents_title_alias_prefix_idx ON public.search_documents USING btree (title_alias_text text_pattern_ops);


--
-- Name: search_documents_title_alias_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_documents_title_alias_trgm_idx ON public.search_documents USING gin (title_alias_text extensions.gin_trgm_ops);


--
-- Name: search_documents_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX search_documents_updated_at_idx ON public.search_documents USING btree (updated_at DESC);


--
-- Name: snapi_item_launches_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snapi_item_launches_launch_id_idx ON public.snapi_item_launches USING btree (launch_id);


--
-- Name: snapi_items_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snapi_items_published_at_idx ON public.snapi_items USING btree (published_at DESC);


--
-- Name: snapi_items_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX snapi_items_updated_at_idx ON public.snapi_items USING btree (updated_at DESC);


--
-- Name: social_accounts_platform_provider_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_accounts_platform_provider_active_idx ON public.social_accounts USING btree (platform, provider_key, active, priority);


--
-- Name: social_accounts_platform_provider_handle_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_accounts_platform_provider_handle_uidx ON public.social_accounts USING btree (platform, provider_key, handle);


--
-- Name: social_posts_dispatch_claim_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_dispatch_claim_idx ON public.social_posts USING btree (status, platform, post_type, scheduled_for, thread_segment_index, created_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: social_posts_launch_root_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_posts_launch_root_uidx ON public.social_posts USING btree (launch_id, platform, base_day, thread_segment_index) WHERE (post_type = 'launch_day'::text);


--
-- Name: social_posts_launch_update_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_launch_update_idx ON public.social_posts USING btree (launch_update_id);


--
-- Name: social_posts_mission_brief_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_posts_mission_brief_uidx ON public.social_posts USING btree (launch_id, platform, base_day, thread_segment_index) WHERE (post_type = 'mission_brief'::text);


--
-- Name: social_posts_mission_drop_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_posts_mission_drop_uidx ON public.social_posts USING btree (launch_id, platform, base_day, thread_segment_index) WHERE (post_type = 'mission_drop'::text);


--
-- Name: social_posts_no_launch_day_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_posts_no_launch_day_uidx ON public.social_posts USING btree (platform, base_day, thread_segment_index) WHERE (post_type = 'no_launch_day'::text);


--
-- Name: social_posts_reply_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_reply_parent_idx ON public.social_posts USING btree (reply_to_social_post_id, status);


--
-- Name: social_posts_send_lock_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_send_lock_id_idx ON public.social_posts USING btree (send_lock_id) WHERE (send_lock_id IS NOT NULL);


--
-- Name: social_posts_send_lock_stale_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_send_lock_stale_idx ON public.social_posts USING btree (status, send_locked_at) WHERE (status = 'sending'::text);


--
-- Name: social_posts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX social_posts_status_idx ON public.social_posts USING btree (status, scheduled_for);


--
-- Name: social_posts_update_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX social_posts_update_uidx ON public.social_posts USING btree (launch_update_id, platform, post_type, thread_segment_index) WHERE (launch_update_id IS NOT NULL);


--
-- Name: spacex_drone_ship_assignments_last_verified_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spacex_drone_ship_assignments_last_verified_idx ON public.spacex_drone_ship_assignments USING btree (last_verified_at DESC);


--
-- Name: spacex_drone_ship_assignments_launch_library_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spacex_drone_ship_assignments_launch_library_id_idx ON public.spacex_drone_ship_assignments USING btree (launch_library_id);


--
-- Name: spacex_drone_ship_assignments_ship_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spacex_drone_ship_assignments_ship_slug_idx ON public.spacex_drone_ship_assignments USING btree (ship_slug, landing_time DESC);


--
-- Name: spacex_drone_ship_assignments_source_landing_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX spacex_drone_ship_assignments_source_landing_uniq ON public.spacex_drone_ship_assignments USING btree (source, source_landing_id) WHERE (source_landing_id IS NOT NULL);


--
-- Name: spacex_drone_ships_wikidata_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX spacex_drone_ships_wikidata_id_uniq ON public.spacex_drone_ships USING btree (wikidata_id) WHERE (wikidata_id IS NOT NULL);


--
-- Name: stripe_customers_last_subscription_sync_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX stripe_customers_last_subscription_sync_at_idx ON public.stripe_customers USING btree (last_subscription_sync_at);


--
-- Name: subscriptions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_status_idx ON public.subscriptions USING btree (status);


--
-- Name: system_settings_updated_by_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX system_settings_updated_by_idx ON public.system_settings USING btree (updated_by);


--
-- Name: trajectory_product_lineage_constraint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_product_lineage_constraint_idx ON public.trajectory_product_lineage USING btree (constraint_id);


--
-- Name: trajectory_product_lineage_doc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_product_lineage_doc_idx ON public.trajectory_product_lineage USING btree (source_document_id);


--
-- Name: trajectory_product_lineage_ingestion_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_product_lineage_ingestion_run_id_idx ON public.trajectory_product_lineage USING btree (ingestion_run_id);


--
-- Name: trajectory_product_lineage_launch_generated_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_product_lineage_launch_generated_idx ON public.trajectory_product_lineage USING btree (launch_id, generated_at DESC);


--
-- Name: trajectory_source_contracts_ingestion_run_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_source_contracts_ingestion_run_id_idx ON public.trajectory_source_contracts USING btree (ingestion_run_id);


--
-- Name: trajectory_source_contracts_launch_eval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_source_contracts_launch_eval_idx ON public.trajectory_source_contracts USING btree (launch_id, evaluated_at DESC);


--
-- Name: trajectory_source_contracts_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_source_contracts_status_idx ON public.trajectory_source_contracts USING btree (status, confidence_tier, freshness_state);


--
-- Name: trajectory_source_documents_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_source_documents_fetched_at_idx ON public.trajectory_source_documents USING btree (fetched_at DESC);


--
-- Name: trajectory_source_documents_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trajectory_source_documents_url_idx ON public.trajectory_source_documents USING btree (url);


--
-- Name: user_sign_in_events_platform_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sign_in_events_platform_created_at_idx ON public.user_sign_in_events USING btree (platform, created_at DESC);


--
-- Name: user_sign_in_events_risk_session_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sign_in_events_risk_session_created_at_idx ON public.user_sign_in_events USING btree (risk_session_id, created_at DESC);


--
-- Name: user_sign_in_events_user_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_sign_in_events_user_created_at_idx ON public.user_sign_in_events USING btree (user_id, created_at DESC);


--
-- Name: user_surface_summary_last_sign_in_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_surface_summary_last_sign_in_idx ON public.user_surface_summary USING btree (last_sign_in_platform, updated_at DESC);


--
-- Name: watchlist_rules_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX watchlist_rules_unique_idx ON public.watchlist_rules USING btree (watchlist_id, rule_type, rule_value);


--
-- Name: watchlist_rules_watchlist_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX watchlist_rules_watchlist_idx ON public.watchlist_rules USING btree (watchlist_id);


--
-- Name: watchlists_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX watchlists_user_idx ON public.watchlists USING btree (user_id, created_at);


--
-- Name: webhook_events_source_event_id_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX webhook_events_source_event_id_key ON public.webhook_events USING btree (source, event_id);


--
-- Name: ws45_forecast_parse_runs_document_family_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_forecast_parse_runs_document_family_idx ON public.ws45_forecast_parse_runs USING btree (document_family, created_at DESC);


--
-- Name: ws45_forecast_parse_runs_forecast_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_forecast_parse_runs_forecast_idx ON public.ws45_forecast_parse_runs USING btree (forecast_id, created_at DESC);


--
-- Name: ws45_forecast_parse_runs_parser_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_forecast_parse_runs_parser_version_idx ON public.ws45_forecast_parse_runs USING btree (parser_version, created_at DESC);


--
-- Name: ws45_forecast_parse_runs_publish_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_forecast_parse_runs_publish_idx ON public.ws45_forecast_parse_runs USING btree (publish_eligible, created_at DESC);


--
-- Name: ws45_launch_forecasts_document_family_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_document_family_idx ON public.ws45_launch_forecasts USING btree (document_family, fetched_at DESC);


--
-- Name: ws45_launch_forecasts_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_fetched_at_idx ON public.ws45_launch_forecasts USING btree (fetched_at DESC);


--
-- Name: ws45_launch_forecasts_issued_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_issued_at_idx ON public.ws45_launch_forecasts USING btree (issued_at DESC);


--
-- Name: ws45_launch_forecasts_matched_launch_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_matched_launch_id_idx ON public.ws45_launch_forecasts USING btree (matched_launch_id);


--
-- Name: ws45_launch_forecasts_mission_tokens_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_mission_tokens_gin ON public.ws45_launch_forecasts USING gin (mission_tokens);


--
-- Name: ws45_launch_forecasts_parse_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_parse_status_idx ON public.ws45_launch_forecasts USING btree (parse_status, fetched_at DESC);


--
-- Name: ws45_launch_forecasts_pdf_url_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_pdf_url_idx ON public.ws45_launch_forecasts USING btree (pdf_url);


--
-- Name: ws45_launch_forecasts_publish_eligible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_publish_eligible_idx ON public.ws45_launch_forecasts USING btree (publish_eligible, fetched_at DESC);


--
-- Name: ws45_launch_forecasts_valid_window_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_launch_forecasts_valid_window_gist ON public.ws45_launch_forecasts USING gist (valid_window);


--
-- Name: ws45_live_weather_snapshots_fetched_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_live_weather_snapshots_fetched_at_idx ON public.ws45_live_weather_snapshots USING btree (fetched_at DESC);


--
-- Name: ws45_planning_forecasts_product_fetched_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_planning_forecasts_product_fetched_idx ON public.ws45_planning_forecasts USING btree (product_kind, fetched_at DESC);


--
-- Name: ws45_planning_forecasts_product_issued_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_planning_forecasts_product_issued_idx ON public.ws45_planning_forecasts USING btree (product_kind, issued_at DESC);


--
-- Name: ws45_planning_forecasts_publish_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_planning_forecasts_publish_idx ON public.ws45_planning_forecasts USING btree (publish_eligible, fetched_at DESC);


--
-- Name: ws45_planning_forecasts_valid_window_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ws45_planning_forecasts_valid_window_gist ON public.ws45_planning_forecasts USING gist (valid_window);


--
-- Name: launch_refresh_state launch_refresh_state_broadcast_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER launch_refresh_state_broadcast_trigger AFTER INSERT OR UPDATE ON public.launch_refresh_state FOR EACH ROW EXECUTE FUNCTION public.broadcast_launch_refresh_state_changes();


--
-- Name: profiles profiles_block_role_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_block_role_change BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.block_profile_role_change();


--
-- Name: search_documents search_documents_set_generated_fields; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER search_documents_set_generated_fields BEFORE INSERT OR UPDATE ON public.search_documents FOR EACH ROW EXECUTE FUNCTION public.search_documents_update_generated_fields();


--
-- Name: system_settings system_settings_sync_ops_metrics_collect_schedule; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER system_settings_sync_ops_metrics_collect_schedule AFTER INSERT OR UPDATE OF value ON public.system_settings FOR EACH ROW WHEN ((new.key = 'ops_metrics_collection_enabled'::text)) EXECUTE FUNCTION public.trg_sync_ops_metrics_collect_schedule();


--
-- Name: faa_launch_matches touch_launch_refresh_state_faa_launch_matches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_faa_launch_matches AFTER INSERT OR DELETE OR UPDATE ON public.faa_launch_matches FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: launch_external_resources touch_launch_refresh_state_launch_external_resources; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_launch_external_resources AFTER INSERT OR DELETE OR UPDATE ON public.launch_external_resources FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: launch_weather touch_launch_refresh_state_launch_weather; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_launch_weather AFTER INSERT OR DELETE OR UPDATE ON public.launch_weather FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: launches touch_launch_refresh_state_live_launches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_live_launches AFTER INSERT OR DELETE OR UPDATE ON public.launches FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_live_launches();


--
-- Name: ll2_event_launches touch_launch_refresh_state_ll2_event_launches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_ll2_event_launches AFTER INSERT OR DELETE OR UPDATE ON public.ll2_event_launches FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: ll2_events touch_launch_refresh_state_ll2_events; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_ll2_events AFTER INSERT OR DELETE OR UPDATE ON public.ll2_events FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_ll2_events();


--
-- Name: ll2_launch_landings touch_launch_refresh_state_ll2_launch_landings; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_ll2_launch_landings AFTER INSERT OR DELETE OR UPDATE ON public.ll2_launch_landings FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: ll2_payload_flights touch_launch_refresh_state_payload_flights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_payload_flights AFTER INSERT OR DELETE OR UPDATE ON public.ll2_payload_flights FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_manifest_tables();


--
-- Name: launches_public_cache touch_launch_refresh_state_public_cache; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_public_cache AFTER INSERT OR DELETE OR UPDATE ON public.launches_public_cache FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_public_cache();


--
-- Name: snapi_item_launches touch_launch_refresh_state_snapi_item_launches; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_snapi_item_launches AFTER INSERT OR DELETE OR UPDATE ON public.snapi_item_launches FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: snapi_items touch_launch_refresh_state_snapi_items; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_snapi_items AFTER INSERT OR DELETE OR UPDATE ON public.snapi_items FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_snapi_items();


--
-- Name: ll2_spacecraft_flights touch_launch_refresh_state_spacecraft_flights; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_spacecraft_flights AFTER INSERT OR DELETE OR UPDATE ON public.ll2_spacecraft_flights FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_manifest_tables();


--
-- Name: launch_trajectory_constraints touch_launch_refresh_state_trajectory_constraints; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_trajectory_constraints AFTER INSERT OR DELETE OR UPDATE ON public.launch_trajectory_constraints FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: launch_trajectory_products touch_launch_refresh_state_trajectory_products; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_trajectory_products AFTER INSERT OR DELETE OR UPDATE ON public.launch_trajectory_products FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('launch_id');


--
-- Name: ws45_launch_forecasts touch_launch_refresh_state_ws45_launch_forecasts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_ws45_launch_forecasts AFTER INSERT OR DELETE OR UPDATE ON public.ws45_launch_forecasts FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_named_launch_column('matched_launch_id');


--
-- Name: ws45_live_weather_snapshots touch_launch_refresh_state_ws45_live_weather_snapshots; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_ws45_live_weather_snapshots AFTER INSERT OR DELETE OR UPDATE ON public.ws45_live_weather_snapshots FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_ws45_live_weather();


--
-- Name: ws45_planning_forecasts touch_launch_refresh_state_ws45_planning_forecasts; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER touch_launch_refresh_state_ws45_planning_forecasts AFTER INSERT OR DELETE OR UPDATE ON public.ws45_planning_forecasts FOR EACH ROW EXECUTE FUNCTION public.handle_launch_refresh_state_from_ws45_planning();


--
-- Name: launches trg_log_launch_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_log_launch_update AFTER UPDATE ON public.launches FOR EACH ROW EXECUTE FUNCTION public.log_launch_update();


--
-- Name: launches trg_mark_launch_dirty_for_faa_match; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mark_launch_dirty_for_faa_match AFTER INSERT OR UPDATE OF net, window_start, window_end, pad_latitude, pad_longitude, hidden ON public.launches FOR EACH ROW EXECUTE FUNCTION public.mark_launch_dirty_for_faa_match();


--
-- Name: launch_trajectory_constraints trg_mark_launch_trajectory_constraint_dirty_for_faa_match; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_mark_launch_trajectory_constraint_dirty_for_faa_match AFTER INSERT OR DELETE OR UPDATE ON public.launch_trajectory_constraints FOR EACH ROW EXECUTE FUNCTION public.mark_launch_trajectory_constraint_dirty_for_faa_match();


--
-- Name: launches trg_schedule_faa_launch_match_followup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_schedule_faa_launch_match_followup AFTER INSERT OR UPDATE OF hidden, net, window_start, window_end, pad_latitude, pad_longitude, pad_name, pad_short_code, pad_state, pad_country_code ON public.launches FOR EACH ROW EXECUTE FUNCTION public.schedule_faa_launch_match_followup();


--
-- Name: admin_access_override_events admin_access_override_events_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_access_override_events
    ADD CONSTRAINT admin_access_override_events_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(user_id);


--
-- Name: admin_access_override_events admin_access_override_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_access_override_events
    ADD CONSTRAINT admin_access_override_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: admin_access_overrides admin_access_overrides_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_access_overrides
    ADD CONSTRAINT admin_access_overrides_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(user_id);


--
-- Name: admin_access_overrides admin_access_overrides_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_access_overrides
    ADD CONSTRAINT admin_access_overrides_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: apple_sign_in_tokens apple_sign_in_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apple_sign_in_tokens
    ADD CONSTRAINT apple_sign_in_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ar_camera_guide_sessions ar_camera_guide_sessions_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ar_camera_guide_sessions
    ADD CONSTRAINT ar_camera_guide_sessions_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: artemis_budget_lines artemis_budget_lines_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_budget_lines
    ADD CONSTRAINT artemis_budget_lines_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_content_items artemis_content_items_source_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_content_items
    ADD CONSTRAINT artemis_content_items_source_key_fkey FOREIGN KEY (source_key) REFERENCES public.artemis_source_registry(source_key) ON DELETE SET NULL;


--
-- Name: artemis_content_scores artemis_content_scores_content_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_content_scores
    ADD CONSTRAINT artemis_content_scores_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.artemis_content_items(id) ON DELETE CASCADE;


--
-- Name: artemis_contract_actions artemis_contract_actions_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_actions
    ADD CONSTRAINT artemis_contract_actions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.artemis_contracts(id) ON DELETE CASCADE;


--
-- Name: artemis_contract_actions artemis_contract_actions_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_actions
    ADD CONSTRAINT artemis_contract_actions_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_contract_budget_map artemis_contract_budget_map_budget_line_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_budget_map
    ADD CONSTRAINT artemis_contract_budget_map_budget_line_id_fkey FOREIGN KEY (budget_line_id) REFERENCES public.artemis_budget_lines(id) ON DELETE CASCADE;


--
-- Name: artemis_contract_budget_map artemis_contract_budget_map_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contract_budget_map
    ADD CONSTRAINT artemis_contract_budget_map_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.artemis_contracts(id) ON DELETE CASCADE;


--
-- Name: artemis_contracts artemis_contracts_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_contracts
    ADD CONSTRAINT artemis_contracts_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_mission_components artemis_mission_components_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_mission_components
    ADD CONSTRAINT artemis_mission_components_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_opportunity_notices artemis_opportunity_notices_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_opportunity_notices
    ADD CONSTRAINT artemis_opportunity_notices_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_people artemis_people_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_people
    ADD CONSTRAINT artemis_people_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_procurement_awards artemis_procurement_awards_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_procurement_awards
    ADD CONSTRAINT artemis_procurement_awards_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_program_procurement_cache artemis_program_procurement_cache_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_program_procurement_cache
    ADD CONSTRAINT artemis_program_procurement_cache_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.artemis_contracts(id) ON DELETE CASCADE;


--
-- Name: artemis_program_procurement_cache artemis_program_procurement_cache_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_program_procurement_cache
    ADD CONSTRAINT artemis_program_procurement_cache_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_sam_contract_award_rows artemis_sam_contract_award_rows_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_sam_contract_award_rows
    ADD CONSTRAINT artemis_sam_contract_award_rows_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.artemis_contracts(id) ON DELETE CASCADE;


--
-- Name: artemis_sam_contract_award_rows artemis_sam_contract_award_rows_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_sam_contract_award_rows
    ADD CONSTRAINT artemis_sam_contract_award_rows_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: artemis_spending_timeseries artemis_spending_timeseries_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_spending_timeseries
    ADD CONSTRAINT artemis_spending_timeseries_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.artemis_contracts(id) ON DELETE CASCADE;


--
-- Name: artemis_timeline_events artemis_timeline_events_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_timeline_events
    ADD CONSTRAINT artemis_timeline_events_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE CASCADE;


--
-- Name: artemis_timeline_events artemis_timeline_events_supersedes_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.artemis_timeline_events
    ADD CONSTRAINT artemis_timeline_events_supersedes_event_id_fkey FOREIGN KEY (supersedes_event_id) REFERENCES public.artemis_timeline_events(id) ON DELETE SET NULL;


--
-- Name: billing_events billing_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: blue_origin_contract_actions blue_origin_contract_actions_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_actions
    ADD CONSTRAINT blue_origin_contract_actions_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.blue_origin_contracts(id) ON DELETE CASCADE;


--
-- Name: blue_origin_contract_actions blue_origin_contract_actions_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_actions
    ADD CONSTRAINT blue_origin_contract_actions_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_contract_vehicle_map blue_origin_contract_vehicle_map_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_vehicle_map
    ADD CONSTRAINT blue_origin_contract_vehicle_map_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.blue_origin_contracts(id) ON DELETE CASCADE;


--
-- Name: blue_origin_contract_vehicle_map blue_origin_contract_vehicle_map_engine_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_vehicle_map
    ADD CONSTRAINT blue_origin_contract_vehicle_map_engine_slug_fkey FOREIGN KEY (engine_slug) REFERENCES public.blue_origin_engines(engine_slug) ON DELETE SET NULL;


--
-- Name: blue_origin_contract_vehicle_map blue_origin_contract_vehicle_map_vehicle_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contract_vehicle_map
    ADD CONSTRAINT blue_origin_contract_vehicle_map_vehicle_slug_fkey FOREIGN KEY (vehicle_slug) REFERENCES public.blue_origin_vehicles(vehicle_slug) ON DELETE SET NULL;


--
-- Name: blue_origin_contracts blue_origin_contracts_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_contracts
    ADD CONSTRAINT blue_origin_contracts_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_engines blue_origin_engines_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_engines
    ADD CONSTRAINT blue_origin_engines_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_opportunity_notices blue_origin_opportunity_notices_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_opportunity_notices
    ADD CONSTRAINT blue_origin_opportunity_notices_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_passengers blue_origin_passengers_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_passengers
    ADD CONSTRAINT blue_origin_passengers_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_payloads blue_origin_payloads_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_payloads
    ADD CONSTRAINT blue_origin_payloads_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_spending_timeseries blue_origin_spending_timeseries_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_spending_timeseries
    ADD CONSTRAINT blue_origin_spending_timeseries_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.blue_origin_contracts(id) ON DELETE CASCADE;


--
-- Name: blue_origin_timeline_events blue_origin_timeline_events_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_timeline_events
    ADD CONSTRAINT blue_origin_timeline_events_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_traveler_sources blue_origin_traveler_sources_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_traveler_sources
    ADD CONSTRAINT blue_origin_traveler_sources_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: blue_origin_traveler_sources blue_origin_traveler_sources_traveler_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_traveler_sources
    ADD CONSTRAINT blue_origin_traveler_sources_traveler_slug_fkey FOREIGN KEY (traveler_slug) REFERENCES public.blue_origin_travelers(traveler_slug) ON DELETE CASCADE;


--
-- Name: blue_origin_vehicle_engine_map blue_origin_vehicle_engine_map_engine_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_vehicle_engine_map
    ADD CONSTRAINT blue_origin_vehicle_engine_map_engine_slug_fkey FOREIGN KEY (engine_slug) REFERENCES public.blue_origin_engines(engine_slug) ON DELETE CASCADE;


--
-- Name: blue_origin_vehicle_engine_map blue_origin_vehicle_engine_map_vehicle_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_vehicle_engine_map
    ADD CONSTRAINT blue_origin_vehicle_engine_map_vehicle_slug_fkey FOREIGN KEY (vehicle_slug) REFERENCES public.blue_origin_vehicles(vehicle_slug) ON DELETE CASCADE;


--
-- Name: blue_origin_vehicles blue_origin_vehicles_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blue_origin_vehicles
    ADD CONSTRAINT blue_origin_vehicles_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.blue_origin_source_documents(id) ON DELETE SET NULL;


--
-- Name: calendar_feeds calendar_feeds_source_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_source_preset_id_fkey FOREIGN KEY (source_preset_id) REFERENCES public.launch_filter_presets(id) ON DELETE SET NULL;


--
-- Name: calendar_feeds calendar_feeds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_feeds
    ADD CONSTRAINT calendar_feeds_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: celestrak_intdes_datasets celestrak_intdes_datasets_latest_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.celestrak_intdes_datasets
    ADD CONSTRAINT celestrak_intdes_datasets_latest_snapshot_id_fkey FOREIGN KEY (latest_snapshot_id) REFERENCES public.launch_object_inventory_snapshots(id) ON DELETE SET NULL;


--
-- Name: discount_campaign_provider_artifacts discount_campaign_provider_artifacts_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaign_provider_artifacts
    ADD CONSTRAINT discount_campaign_provider_artifacts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.discount_campaigns(id) ON DELETE CASCADE;


--
-- Name: discount_campaign_targets discount_campaign_targets_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaign_targets
    ADD CONSTRAINT discount_campaign_targets_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.discount_campaigns(id) ON DELETE CASCADE;


--
-- Name: discount_campaign_targets discount_campaign_targets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaign_targets
    ADD CONSTRAINT discount_campaign_targets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: discount_campaigns discount_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaigns
    ADD CONSTRAINT discount_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: discount_campaigns discount_campaigns_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_campaigns
    ADD CONSTRAINT discount_campaigns_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: embed_widgets embed_widgets_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embed_widgets
    ADD CONSTRAINT embed_widgets_preset_id_fkey FOREIGN KEY (preset_id) REFERENCES public.launch_filter_presets(id) ON DELETE SET NULL;


--
-- Name: embed_widgets embed_widgets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embed_widgets
    ADD CONSTRAINT embed_widgets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: embed_widgets embed_widgets_watchlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.embed_widgets
    ADD CONSTRAINT embed_widgets_watchlist_id_fkey FOREIGN KEY (watchlist_id) REFERENCES public.watchlists(id) ON DELETE SET NULL;


--
-- Name: faa_launch_match_dirty_launches faa_launch_match_dirty_launches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_launch_match_dirty_launches
    ADD CONSTRAINT faa_launch_match_dirty_launches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: faa_launch_matches faa_launch_matches_faa_tfr_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_launch_matches
    ADD CONSTRAINT faa_launch_matches_faa_tfr_record_id_fkey FOREIGN KEY (faa_tfr_record_id) REFERENCES public.faa_tfr_records(id) ON DELETE CASCADE;


--
-- Name: faa_launch_matches faa_launch_matches_faa_tfr_shape_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_launch_matches
    ADD CONSTRAINT faa_launch_matches_faa_tfr_shape_id_fkey FOREIGN KEY (faa_tfr_shape_id) REFERENCES public.faa_tfr_shapes(id) ON DELETE SET NULL;


--
-- Name: faa_launch_matches faa_launch_matches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_launch_matches
    ADD CONSTRAINT faa_launch_matches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: faa_notam_details faa_notam_details_faa_tfr_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_notam_details
    ADD CONSTRAINT faa_notam_details_faa_tfr_record_id_fkey FOREIGN KEY (faa_tfr_record_id) REFERENCES public.faa_tfr_records(id) ON DELETE SET NULL;


--
-- Name: faa_tfr_shapes faa_tfr_shapes_faa_tfr_record_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.faa_tfr_shapes
    ADD CONSTRAINT faa_tfr_shapes_faa_tfr_record_id_fkey FOREIGN KEY (faa_tfr_record_id) REFERENCES public.faa_tfr_records(id) ON DELETE CASCADE;


--
-- Name: feedback_submissions feedback_submissions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feedback_submissions
    ADD CONSTRAINT feedback_submissions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: jep_background_light_cells jep_background_light_cells_source_fetch_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_background_light_cells
    ADD CONSTRAINT jep_background_light_cells_source_fetch_run_id_fkey FOREIGN KEY (source_fetch_run_id) REFERENCES public.jep_source_fetch_runs(id) ON DELETE SET NULL;


--
-- Name: jep_background_light_cells jep_background_light_cells_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_background_light_cells
    ADD CONSTRAINT jep_background_light_cells_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.jep_source_versions(id) ON DELETE SET NULL;


--
-- Name: jep_corridor_cache jep_corridor_cache_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_corridor_cache
    ADD CONSTRAINT jep_corridor_cache_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: jep_feature_snapshots jep_feature_snapshots_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_feature_snapshots
    ADD CONSTRAINT jep_feature_snapshots_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: jep_horizon_masks jep_horizon_masks_building_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_horizon_masks
    ADD CONSTRAINT jep_horizon_masks_building_source_version_id_fkey FOREIGN KEY (building_source_version_id) REFERENCES public.jep_source_versions(id) ON DELETE SET NULL;


--
-- Name: jep_horizon_masks jep_horizon_masks_dem_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_horizon_masks
    ADD CONSTRAINT jep_horizon_masks_dem_source_version_id_fkey FOREIGN KEY (dem_source_version_id) REFERENCES public.jep_source_versions(id) ON DELETE SET NULL;


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_qa_fetch_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_qa_fetch_run_id_fkey FOREIGN KEY (qa_fetch_run_id) REFERENCES public.jep_source_fetch_runs(id) ON DELETE SET NULL;


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_qa_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_qa_version_id_fkey FOREIGN KEY (qa_version_id) REFERENCES public.jep_source_versions(id) ON DELETE SET NULL;


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_source_fetch_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_source_fetch_run_id_fkey FOREIGN KEY (source_fetch_run_id) REFERENCES public.jep_source_fetch_runs(id) ON DELETE SET NULL;


--
-- Name: jep_moon_ephemerides jep_moon_ephemerides_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_moon_ephemerides
    ADD CONSTRAINT jep_moon_ephemerides_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.jep_source_versions(id) ON DELETE SET NULL;


--
-- Name: jep_outcome_reports jep_outcome_reports_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_outcome_reports
    ADD CONSTRAINT jep_outcome_reports_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: jep_outcome_reports jep_outcome_reports_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_outcome_reports
    ADD CONSTRAINT jep_outcome_reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: jep_source_fetch_runs jep_source_fetch_runs_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_source_fetch_runs
    ADD CONSTRAINT jep_source_fetch_runs_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.jep_source_versions(id) ON DELETE SET NULL;


--
-- Name: jep_vehicle_priors jep_vehicle_priors_ll2_rocket_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.jep_vehicle_priors
    ADD CONSTRAINT jep_vehicle_priors_ll2_rocket_config_id_fkey FOREIGN KEY (ll2_rocket_config_id) REFERENCES public.ll2_rocket_configs(ll2_config_id) ON DELETE SET NULL;


--
-- Name: launch_external_resources launch_external_resources_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_external_resources
    ADD CONSTRAINT launch_external_resources_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_filter_presets launch_filter_presets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_filter_presets
    ADD CONSTRAINT launch_filter_presets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: launch_jep_score_candidates launch_jep_score_candidates_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_jep_score_candidates
    ADD CONSTRAINT launch_jep_score_candidates_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_jep_scores launch_jep_scores_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_jep_scores
    ADD CONSTRAINT launch_jep_scores_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_notification_preferences launch_notification_preferences_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_notification_preferences
    ADD CONSTRAINT launch_notification_preferences_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_notification_preferences launch_notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_notification_preferences
    ADD CONSTRAINT launch_notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: launch_object_inventory_snapshot_items launch_object_inventory_snapshot_items_snapshot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_object_inventory_snapshot_items
    ADD CONSTRAINT launch_object_inventory_snapshot_items_snapshot_id_fkey FOREIGN KEY (snapshot_id) REFERENCES public.launch_object_inventory_snapshots(id) ON DELETE CASCADE;


--
-- Name: launch_pad_preview_cache launch_pad_preview_cache_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_pad_preview_cache
    ADD CONSTRAINT launch_pad_preview_cache_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: launch_pad_preview_cache launch_pad_preview_cache_ll2_pad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_pad_preview_cache
    ADD CONSTRAINT launch_pad_preview_cache_ll2_pad_id_fkey FOREIGN KEY (ll2_pad_id) REFERENCES public.ll2_pads(ll2_pad_id) ON DELETE SET NULL;


--
-- Name: launch_refresh_state launch_refresh_state_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_refresh_state
    ADD CONSTRAINT launch_refresh_state_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_social_candidates launch_social_candidates_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_social_candidates
    ADD CONSTRAINT launch_social_candidates_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_social_matches launch_social_matches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_social_matches
    ADD CONSTRAINT launch_social_matches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_trajectory_constraints launch_trajectory_constraints_ingestion_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_constraints
    ADD CONSTRAINT launch_trajectory_constraints_ingestion_run_id_fkey FOREIGN KEY (ingestion_run_id) REFERENCES public.ingestion_runs(id) ON DELETE SET NULL;


--
-- Name: launch_trajectory_constraints launch_trajectory_constraints_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_constraints
    ADD CONSTRAINT launch_trajectory_constraints_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_trajectory_products launch_trajectory_products_ingestion_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_products
    ADD CONSTRAINT launch_trajectory_products_ingestion_run_id_fkey FOREIGN KEY (ingestion_run_id) REFERENCES public.ingestion_runs(id) ON DELETE SET NULL;


--
-- Name: launch_trajectory_products launch_trajectory_products_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_trajectory_products
    ADD CONSTRAINT launch_trajectory_products_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_updates launch_updates_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_updates
    ADD CONSTRAINT launch_updates_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launch_weather launch_weather_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launch_weather
    ADD CONSTRAINT launch_weather_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: launches launches_ll2_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches
    ADD CONSTRAINT launches_ll2_agency_id_fkey FOREIGN KEY (ll2_agency_id) REFERENCES public.ll2_agencies(ll2_agency_id);


--
-- Name: launches launches_ll2_pad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches
    ADD CONSTRAINT launches_ll2_pad_id_fkey FOREIGN KEY (ll2_pad_id) REFERENCES public.ll2_pads(ll2_pad_id);


--
-- Name: launches launches_ll2_rocket_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches
    ADD CONSTRAINT launches_ll2_rocket_config_id_fkey FOREIGN KEY (ll2_rocket_config_id) REFERENCES public.ll2_rocket_configs(ll2_config_id);


--
-- Name: launches_public_cache launches_public_cache_ll2_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches_public_cache
    ADD CONSTRAINT launches_public_cache_ll2_agency_id_fkey FOREIGN KEY (ll2_agency_id) REFERENCES public.ll2_agencies(ll2_agency_id) ON DELETE SET NULL;


--
-- Name: launches_public_cache launches_public_cache_ll2_pad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches_public_cache
    ADD CONSTRAINT launches_public_cache_ll2_pad_id_fkey FOREIGN KEY (ll2_pad_id) REFERENCES public.ll2_pads(ll2_pad_id) ON DELETE SET NULL;


--
-- Name: launches_public_cache launches_public_cache_ll2_rocket_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.launches_public_cache
    ADD CONSTRAINT launches_public_cache_ll2_rocket_config_id_fkey FOREIGN KEY (ll2_rocket_config_id) REFERENCES public.ll2_rocket_configs(ll2_config_id) ON DELETE SET NULL;


--
-- Name: legal_acceptances legal_acceptances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legal_acceptances
    ADD CONSTRAINT legal_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ll2_astronaut_launches ll2_astronaut_launches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_astronaut_launches
    ADD CONSTRAINT ll2_astronaut_launches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: ll2_astronaut_launches ll2_astronaut_launches_ll2_astronaut_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_astronaut_launches
    ADD CONSTRAINT ll2_astronaut_launches_ll2_astronaut_id_fkey FOREIGN KEY (ll2_astronaut_id) REFERENCES public.ll2_astronauts(ll2_astronaut_id) ON DELETE CASCADE;


--
-- Name: ll2_event_launches ll2_event_launches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_event_launches
    ADD CONSTRAINT ll2_event_launches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: ll2_event_launches ll2_event_launches_ll2_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_event_launches
    ADD CONSTRAINT ll2_event_launches_ll2_event_id_fkey FOREIGN KEY (ll2_event_id) REFERENCES public.ll2_events(ll2_event_id) ON DELETE CASCADE;


--
-- Name: ll2_launch_landings ll2_launch_landings_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launch_landings
    ADD CONSTRAINT ll2_launch_landings_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: ll2_launch_landings ll2_launch_landings_ll2_landing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launch_landings
    ADD CONSTRAINT ll2_launch_landings_ll2_landing_id_fkey FOREIGN KEY (ll2_landing_id) REFERENCES public.ll2_landings(ll2_landing_id) ON DELETE CASCADE;


--
-- Name: ll2_launcher_launches ll2_launcher_launches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launcher_launches
    ADD CONSTRAINT ll2_launcher_launches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: ll2_launcher_launches ll2_launcher_launches_ll2_launcher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_launcher_launches
    ADD CONSTRAINT ll2_launcher_launches_ll2_launcher_id_fkey FOREIGN KEY (ll2_launcher_id) REFERENCES public.ll2_launchers(ll2_launcher_id) ON DELETE CASCADE;


--
-- Name: ll2_pads ll2_pads_ll2_location_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_pads
    ADD CONSTRAINT ll2_pads_ll2_location_id_fkey FOREIGN KEY (ll2_location_id) REFERENCES public.ll2_locations(ll2_location_id);


--
-- Name: ll2_payload_flight_docking_events ll2_payload_flight_docking_events_ll2_payload_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_flight_docking_events
    ADD CONSTRAINT ll2_payload_flight_docking_events_ll2_payload_flight_id_fkey FOREIGN KEY (ll2_payload_flight_id) REFERENCES public.ll2_payload_flights(ll2_payload_flight_id) ON DELETE CASCADE;


--
-- Name: ll2_payload_flights ll2_payload_flights_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_flights
    ADD CONSTRAINT ll2_payload_flights_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: ll2_payload_flights ll2_payload_flights_ll2_landing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_flights
    ADD CONSTRAINT ll2_payload_flights_ll2_landing_id_fkey FOREIGN KEY (ll2_landing_id) REFERENCES public.ll2_landings(ll2_landing_id);


--
-- Name: ll2_payload_flights ll2_payload_flights_ll2_payload_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payload_flights
    ADD CONSTRAINT ll2_payload_flights_ll2_payload_id_fkey FOREIGN KEY (ll2_payload_id) REFERENCES public.ll2_payloads(ll2_payload_id);


--
-- Name: ll2_payloads ll2_payloads_manufacturer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payloads
    ADD CONSTRAINT ll2_payloads_manufacturer_id_fkey FOREIGN KEY (manufacturer_id) REFERENCES public.ll2_agencies(ll2_agency_id);


--
-- Name: ll2_payloads ll2_payloads_operator_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payloads
    ADD CONSTRAINT ll2_payloads_operator_id_fkey FOREIGN KEY (operator_id) REFERENCES public.ll2_agencies(ll2_agency_id);


--
-- Name: ll2_payloads ll2_payloads_payload_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_payloads
    ADD CONSTRAINT ll2_payloads_payload_type_id_fkey FOREIGN KEY (payload_type_id) REFERENCES public.ll2_payload_types(ll2_payload_type_id);


--
-- Name: ll2_spacecraft_configs ll2_spacecraft_configs_agency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_configs
    ADD CONSTRAINT ll2_spacecraft_configs_agency_id_fkey FOREIGN KEY (agency_id) REFERENCES public.ll2_agencies(ll2_agency_id);


--
-- Name: ll2_spacecraft_configs ll2_spacecraft_configs_spacecraft_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_configs
    ADD CONSTRAINT ll2_spacecraft_configs_spacecraft_type_id_fkey FOREIGN KEY (spacecraft_type_id) REFERENCES public.ll2_spacecraft_types(ll2_spacecraft_type_id);


--
-- Name: ll2_spacecraft_flight_docking_events ll2_spacecraft_flight_docking_eve_ll2_spacecraft_flight_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_flight_docking_events
    ADD CONSTRAINT ll2_spacecraft_flight_docking_eve_ll2_spacecraft_flight_id_fkey FOREIGN KEY (ll2_spacecraft_flight_id) REFERENCES public.ll2_spacecraft_flights(ll2_spacecraft_flight_id) ON DELETE CASCADE;


--
-- Name: ll2_spacecraft_flights ll2_spacecraft_flights_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_flights
    ADD CONSTRAINT ll2_spacecraft_flights_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: ll2_spacecraft_flights ll2_spacecraft_flights_ll2_landing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_flights
    ADD CONSTRAINT ll2_spacecraft_flights_ll2_landing_id_fkey FOREIGN KEY (ll2_landing_id) REFERENCES public.ll2_landings(ll2_landing_id);


--
-- Name: ll2_spacecraft_flights ll2_spacecraft_flights_ll2_spacecraft_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecraft_flights
    ADD CONSTRAINT ll2_spacecraft_flights_ll2_spacecraft_id_fkey FOREIGN KEY (ll2_spacecraft_id) REFERENCES public.ll2_spacecrafts(ll2_spacecraft_id);


--
-- Name: ll2_spacecrafts ll2_spacecrafts_spacecraft_config_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ll2_spacecrafts
    ADD CONSTRAINT ll2_spacecrafts_spacecraft_config_id_fkey FOREIGN KEY (spacecraft_config_id) REFERENCES public.ll2_spacecraft_configs(ll2_spacecraft_config_id);


--
-- Name: managed_scheduler_queue managed_scheduler_queue_cron_job_name_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.managed_scheduler_queue
    ADD CONSTRAINT managed_scheduler_queue_cron_job_name_fkey FOREIGN KEY (cron_job_name) REFERENCES public.managed_scheduler_jobs(cron_job_name) ON DELETE CASCADE;


--
-- Name: mobile_auth_risk_events mobile_auth_risk_events_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_risk_events
    ADD CONSTRAINT mobile_auth_risk_events_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.mobile_auth_risk_sessions(id) ON DELETE CASCADE;


--
-- Name: mobile_auth_risk_sessions mobile_auth_risk_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_auth_risk_sessions
    ADD CONSTRAINT mobile_auth_risk_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: mobile_push_installations_v2 mobile_push_installations_v2_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_installations_v2
    ADD CONSTRAINT mobile_push_installations_v2_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: mobile_push_outbox_v2 mobile_push_outbox_v2_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_outbox_v2
    ADD CONSTRAINT mobile_push_outbox_v2_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: mobile_push_outbox_v2 mobile_push_outbox_v2_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_outbox_v2
    ADD CONSTRAINT mobile_push_outbox_v2_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: mobile_push_rules_v2 mobile_push_rules_v2_filter_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_rules_v2
    ADD CONSTRAINT mobile_push_rules_v2_filter_preset_id_fkey FOREIGN KEY (filter_preset_id) REFERENCES public.launch_filter_presets(id) ON DELETE CASCADE;


--
-- Name: mobile_push_rules_v2 mobile_push_rules_v2_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_rules_v2
    ADD CONSTRAINT mobile_push_rules_v2_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: mobile_push_rules_v2 mobile_push_rules_v2_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mobile_push_rules_v2
    ADD CONSTRAINT mobile_push_rules_v2_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: navcen_bnm_hazard_areas navcen_bnm_hazard_areas_matched_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navcen_bnm_hazard_areas
    ADD CONSTRAINT navcen_bnm_hazard_areas_matched_launch_id_fkey FOREIGN KEY (matched_launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: navcen_bnm_hazard_areas navcen_bnm_hazard_areas_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.navcen_bnm_hazard_areas
    ADD CONSTRAINT navcen_bnm_hazard_areas_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.navcen_bnm_messages(id) ON DELETE CASCADE;


--
-- Name: notification_alert_rules notification_alert_rules_filter_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_alert_rules
    ADD CONSTRAINT notification_alert_rules_filter_preset_id_fkey FOREIGN KEY (filter_preset_id) REFERENCES public.launch_filter_presets(id) ON DELETE CASCADE;


--
-- Name: notification_alert_rules notification_alert_rules_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_alert_rules
    ADD CONSTRAINT notification_alert_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: notification_push_destinations_v3 notification_push_destinations_v3_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_destinations_v3
    ADD CONSTRAINT notification_push_destinations_v3_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: notification_push_devices notification_push_devices_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_push_devices
    ADD CONSTRAINT notification_push_devices_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notification_rules_v3 notification_rules_v3_filter_preset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules_v3
    ADD CONSTRAINT notification_rules_v3_filter_preset_id_fkey FOREIGN KEY (filter_preset_id) REFERENCES public.launch_filter_presets(id) ON DELETE CASCADE;


--
-- Name: notification_rules_v3 notification_rules_v3_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules_v3
    ADD CONSTRAINT notification_rules_v3_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: notification_rules_v3 notification_rules_v3_rocket_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules_v3
    ADD CONSTRAINT notification_rules_v3_rocket_id_fkey FOREIGN KEY (rocket_id) REFERENCES public.ll2_rocket_configs(ll2_config_id) ON DELETE SET NULL;


--
-- Name: notification_rules_v3 notification_rules_v3_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_rules_v3
    ADD CONSTRAINT notification_rules_v3_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: notification_usage_monthly notification_usage_monthly_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_usage_monthly
    ADD CONSTRAINT notification_usage_monthly_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: notifications_outbox notifications_outbox_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: notifications_outbox notifications_outbox_push_destination_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_push_destination_id_fkey FOREIGN KEY (push_destination_id) REFERENCES public.notification_push_destinations_v3(id) ON DELETE SET NULL;


--
-- Name: notifications_outbox notifications_outbox_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications_outbox
    ADD CONSTRAINT notifications_outbox_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: nws_points nws_points_ll2_pad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nws_points
    ADD CONSTRAINT nws_points_ll2_pad_id_fkey FOREIGN KEY (ll2_pad_id) REFERENCES public.ll2_pads(ll2_pad_id) ON DELETE SET NULL;


--
-- Name: orbit_elements orbit_elements_norad_cat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orbit_elements
    ADD CONSTRAINT orbit_elements_norad_cat_id_fkey FOREIGN KEY (norad_cat_id) REFERENCES public.satellites(norad_cat_id) ON DELETE CASCADE;


--
-- Name: premium_claims premium_claims_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_claims
    ADD CONSTRAINT premium_claims_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: premium_onboarding_allow_creates premium_onboarding_allow_creates_claim_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_onboarding_allow_creates
    ADD CONSTRAINT premium_onboarding_allow_creates_claim_id_fkey FOREIGN KEY (claim_id) REFERENCES public.premium_claims(id) ON DELETE CASCADE;


--
-- Name: premium_onboarding_allow_creates premium_onboarding_allow_creates_onboarding_intent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_onboarding_allow_creates
    ADD CONSTRAINT premium_onboarding_allow_creates_onboarding_intent_id_fkey FOREIGN KEY (onboarding_intent_id) REFERENCES public.premium_onboarding_intents(id) ON DELETE SET NULL;


--
-- Name: premium_onboarding_intents premium_onboarding_intents_viewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.premium_onboarding_intents
    ADD CONSTRAINT premium_onboarding_intents_viewer_id_fkey FOREIGN KEY (viewer_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: privacy_preferences privacy_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_preferences
    ADD CONSTRAINT privacy_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: profiles profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: program_contract_story_discoveries program_contract_story_discoveries_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_discoveries
    ADD CONSTRAINT program_contract_story_discoveries_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: program_contract_story_source_links program_contract_story_source_links_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_source_links
    ADD CONSTRAINT program_contract_story_source_links_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: program_contract_story_source_links program_contract_story_source_links_story_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.program_contract_story_source_links
    ADD CONSTRAINT program_contract_story_source_links_story_key_fkey FOREIGN KEY (story_key) REFERENCES public.program_contract_story_links(story_key) ON DELETE CASCADE;


--
-- Name: purchase_entitlements purchase_entitlements_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_entitlements
    ADD CONSTRAINT purchase_entitlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: purchase_events purchase_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_events
    ADD CONSTRAINT purchase_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE SET NULL;


--
-- Name: purchase_provider_customers purchase_provider_customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_provider_customers
    ADD CONSTRAINT purchase_provider_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: rss_feeds rss_feeds_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rss_feeds
    ADD CONSTRAINT rss_feeds_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: sam_awards_extract_jobs sam_awards_extract_jobs_contract_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_awards_extract_jobs
    ADD CONSTRAINT sam_awards_extract_jobs_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.artemis_contracts(id) ON DELETE CASCADE;


--
-- Name: sam_awards_extract_jobs sam_awards_extract_jobs_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sam_awards_extract_jobs
    ADD CONSTRAINT sam_awards_extract_jobs_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.artemis_source_documents(id) ON DELETE SET NULL;


--
-- Name: satellite_group_memberships satellite_group_memberships_norad_cat_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.satellite_group_memberships
    ADD CONSTRAINT satellite_group_memberships_norad_cat_id_fkey FOREIGN KEY (norad_cat_id) REFERENCES public.satellites(norad_cat_id) ON DELETE CASCADE;


--
-- Name: snapi_item_events snapi_item_events_snapi_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_item_events
    ADD CONSTRAINT snapi_item_events_snapi_uid_fkey FOREIGN KEY (snapi_uid) REFERENCES public.snapi_items(snapi_uid) ON DELETE CASCADE;


--
-- Name: snapi_item_launches snapi_item_launches_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_item_launches
    ADD CONSTRAINT snapi_item_launches_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: snapi_item_launches snapi_item_launches_snapi_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.snapi_item_launches
    ADD CONSTRAINT snapi_item_launches_snapi_uid_fkey FOREIGN KEY (snapi_uid) REFERENCES public.snapi_items(snapi_uid) ON DELETE CASCADE;


--
-- Name: social_posts social_posts_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: social_posts social_posts_launch_update_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_launch_update_id_fkey FOREIGN KEY (launch_update_id) REFERENCES public.launch_updates(id) ON DELETE CASCADE;


--
-- Name: social_posts social_posts_reply_to_social_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.social_posts
    ADD CONSTRAINT social_posts_reply_to_social_post_id_fkey FOREIGN KEY (reply_to_social_post_id) REFERENCES public.social_posts(id) ON DELETE SET NULL;


--
-- Name: spacex_drone_ship_assignments spacex_drone_ship_assignments_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spacex_drone_ship_assignments
    ADD CONSTRAINT spacex_drone_ship_assignments_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: spacex_drone_ship_assignments spacex_drone_ship_assignments_ship_slug_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spacex_drone_ship_assignments
    ADD CONSTRAINT spacex_drone_ship_assignments_ship_slug_fkey FOREIGN KEY (ship_slug) REFERENCES public.spacex_drone_ships(slug) ON DELETE SET NULL;


--
-- Name: stripe_customers stripe_customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.stripe_customers
    ADD CONSTRAINT stripe_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: system_settings system_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.profiles(user_id);


--
-- Name: tipjar_customers tipjar_customers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tipjar_customers
    ADD CONSTRAINT tipjar_customers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: trajectory_product_lineage trajectory_product_lineage_constraint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_product_lineage
    ADD CONSTRAINT trajectory_product_lineage_constraint_id_fkey FOREIGN KEY (constraint_id) REFERENCES public.launch_trajectory_constraints(id) ON DELETE SET NULL;


--
-- Name: trajectory_product_lineage trajectory_product_lineage_ingestion_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_product_lineage
    ADD CONSTRAINT trajectory_product_lineage_ingestion_run_id_fkey FOREIGN KEY (ingestion_run_id) REFERENCES public.ingestion_runs(id) ON DELETE SET NULL;


--
-- Name: trajectory_product_lineage trajectory_product_lineage_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_product_lineage
    ADD CONSTRAINT trajectory_product_lineage_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: trajectory_product_lineage trajectory_product_lineage_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_product_lineage
    ADD CONSTRAINT trajectory_product_lineage_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.trajectory_source_documents(id) ON DELETE SET NULL;


--
-- Name: trajectory_source_contracts trajectory_source_contracts_ingestion_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_source_contracts
    ADD CONSTRAINT trajectory_source_contracts_ingestion_run_id_fkey FOREIGN KEY (ingestion_run_id) REFERENCES public.ingestion_runs(id) ON DELETE SET NULL;


--
-- Name: trajectory_source_contracts trajectory_source_contracts_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trajectory_source_contracts
    ADD CONSTRAINT trajectory_source_contracts_launch_id_fkey FOREIGN KEY (launch_id) REFERENCES public.launches(id) ON DELETE CASCADE;


--
-- Name: user_sign_in_events user_sign_in_events_risk_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sign_in_events
    ADD CONSTRAINT user_sign_in_events_risk_session_id_fkey FOREIGN KEY (risk_session_id) REFERENCES public.mobile_auth_risk_sessions(id) ON DELETE SET NULL;


--
-- Name: user_sign_in_events user_sign_in_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sign_in_events
    ADD CONSTRAINT user_sign_in_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: user_surface_summary user_surface_summary_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_surface_summary
    ADD CONSTRAINT user_surface_summary_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: watchlist_rules watchlist_rules_watchlist_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlist_rules
    ADD CONSTRAINT watchlist_rules_watchlist_id_fkey FOREIGN KEY (watchlist_id) REFERENCES public.watchlists(id) ON DELETE CASCADE;


--
-- Name: watchlists watchlists_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.watchlists
    ADD CONSTRAINT watchlists_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(user_id) ON DELETE CASCADE;


--
-- Name: ws45_forecast_parse_runs ws45_forecast_parse_runs_forecast_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_forecast_parse_runs
    ADD CONSTRAINT ws45_forecast_parse_runs_forecast_id_fkey FOREIGN KEY (forecast_id) REFERENCES public.ws45_launch_forecasts(id) ON DELETE CASCADE;


--
-- Name: ws45_launch_forecasts ws45_launch_forecasts_matched_launch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ws45_launch_forecasts
    ADD CONSTRAINT ws45_launch_forecasts_matched_launch_id_fkey FOREIGN KEY (matched_launch_id) REFERENCES public.launches(id) ON DELETE SET NULL;


--
-- Name: launch_jep_scores admin delete launch jep scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin delete launch jep scores" ON public.launch_jep_scores FOR DELETE USING (( SELECT public.is_admin() AS is_admin));


--
-- Name: ops_alerts admin delete ops alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin delete ops alerts" ON public.ops_alerts FOR DELETE USING (public.is_admin());


--
-- Name: admin_access_overrides admin deletes own access override; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin deletes own access override" ON public.admin_access_overrides FOR DELETE USING (((auth.uid() = user_id) AND public.is_admin()));


--
-- Name: launch_jep_scores admin insert launch jep scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin insert launch jep scores" ON public.launch_jep_scores FOR INSERT WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: ops_alerts admin insert ops alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin insert ops alerts" ON public.ops_alerts FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: ws45_forecast_parse_runs admin insert ws45 forecast parse runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin insert ws45 forecast parse runs" ON public.ws45_forecast_parse_runs FOR INSERT WITH CHECK (public.is_admin());


--
-- Name: celestrak_datasets admin manage celestrak datasets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage celestrak datasets" ON public.celestrak_datasets USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: celestrak_intdes_datasets admin manage celestrak intdes datasets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage celestrak intdes datasets" ON public.celestrak_intdes_datasets USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_background_light_cells admin manage jep background light cells; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep background light cells" ON public.jep_background_light_cells USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_corridor_cache admin manage jep corridor cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep corridor cache" ON public.jep_corridor_cache USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_feature_snapshots admin manage jep feature snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep feature snapshots" ON public.jep_feature_snapshots USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_horizon_masks admin manage jep horizon masks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep horizon masks" ON public.jep_horizon_masks USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_moon_ephemerides admin manage jep moon ephemerides; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep moon ephemerides" ON public.jep_moon_ephemerides USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_observer_locations admin manage jep observer locations; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep observer locations" ON public.jep_observer_locations USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_outcome_reports admin manage jep outcome reports; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep outcome reports" ON public.jep_outcome_reports USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_profiles admin manage jep profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep profiles" ON public.jep_profiles USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_source_fetch_runs admin manage jep source fetch runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep source fetch runs" ON public.jep_source_fetch_runs USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_source_versions admin manage jep source versions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep source versions" ON public.jep_source_versions USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: jep_vehicle_priors admin manage jep vehicle priors; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage jep vehicle priors" ON public.jep_vehicle_priors USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: launch_jep_score_candidates admin manage launch jep score candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage launch jep score candidates" ON public.launch_jep_score_candidates USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: launch_object_inventory_snapshot_items admin manage launch object inventory snapshot items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage launch object inventory snapshot items" ON public.launch_object_inventory_snapshot_items USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: launch_object_inventory_snapshots admin manage launch object inventory snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage launch object inventory snapshots" ON public.launch_object_inventory_snapshots USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: nws_points admin manage nws points; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage nws points" ON public.nws_points USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: social_posts admin manage social posts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage social posts" ON public.social_posts USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: system_settings admin manage system settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin manage system settings" ON public.system_settings USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: ar_camera_guide_sessions admin read ar camera guide sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read ar camera guide sessions" ON public.ar_camera_guide_sessions FOR SELECT USING (public.is_admin());


--
-- Name: artemis_content_scores admin read artemis content scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read artemis content scores" ON public.artemis_content_scores FOR SELECT USING (public.is_admin());


--
-- Name: artemis_ingest_checkpoints admin read artemis ingest checkpoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read artemis ingest checkpoints" ON public.artemis_ingest_checkpoints FOR SELECT USING (public.is_admin());


--
-- Name: artemis_source_documents admin read artemis source documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read artemis source documents" ON public.artemis_source_documents FOR SELECT USING (public.is_admin());


--
-- Name: billing_events admin read billing events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read billing events" ON public.billing_events FOR SELECT USING (public.is_admin());


--
-- Name: faa_notam_details admin read faa notam details; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read faa notam details" ON public.faa_notam_details FOR SELECT USING (public.is_admin());


--
-- Name: feedback_submissions admin read feedback submissions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read feedback submissions" ON public.feedback_submissions FOR SELECT USING (public.is_admin());


--
-- Name: ingestion_runs admin read ingestion runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read ingestion runs" ON public.ingestion_runs FOR SELECT USING (public.is_admin());


--
-- Name: launch_trajectory_constraints admin read launch trajectory constraints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read launch trajectory constraints" ON public.launch_trajectory_constraints FOR SELECT USING (public.is_admin());


--
-- Name: launch_updates admin read launch updates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read launch updates" ON public.launch_updates FOR SELECT USING (public.is_admin());


--
-- Name: navcen_bnm_hazard_areas admin read navcen bnm hazard areas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read navcen bnm hazard areas" ON public.navcen_bnm_hazard_areas FOR SELECT USING (public.is_admin());


--
-- Name: navcen_bnm_messages admin read navcen bnm messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read navcen bnm messages" ON public.navcen_bnm_messages FOR SELECT USING (public.is_admin());


--
-- Name: notification_usage_monthly admin read notification usage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read notification usage" ON public.notification_usage_monthly FOR SELECT USING (public.is_admin());


--
-- Name: notifications_outbox admin read notifications outbox; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read notifications outbox" ON public.notifications_outbox FOR SELECT USING (public.is_admin());


--
-- Name: ops_alerts admin read ops alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read ops alerts" ON public.ops_alerts FOR SELECT USING (public.is_admin());


--
-- Name: ops_metrics_samples_1m admin read ops metrics 1m; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read ops metrics 1m" ON public.ops_metrics_samples_1m FOR SELECT USING (public.is_admin());


--
-- Name: ops_metrics_samples_5m admin read ops metrics 5m; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read ops metrics 5m" ON public.ops_metrics_samples_5m FOR SELECT USING (public.is_admin());


--
-- Name: orbit_elements admin read orbit elements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read orbit elements" ON public.orbit_elements FOR SELECT USING (public.is_admin());


--
-- Name: satellite_group_memberships admin read satellite group memberships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read satellite group memberships" ON public.satellite_group_memberships FOR SELECT USING (public.is_admin());


--
-- Name: satellites admin read satellites; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read satellites" ON public.satellites FOR SELECT USING (public.is_admin());


--
-- Name: trajectory_product_lineage admin read trajectory product lineage; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read trajectory product lineage" ON public.trajectory_product_lineage FOR SELECT USING (public.is_admin());


--
-- Name: trajectory_source_contracts admin read trajectory source contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read trajectory source contracts" ON public.trajectory_source_contracts FOR SELECT USING (public.is_admin());


--
-- Name: trajectory_source_documents admin read trajectory source documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read trajectory source documents" ON public.trajectory_source_documents FOR SELECT USING (public.is_admin());


--
-- Name: webhook_events admin read webhook events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read webhook events" ON public.webhook_events FOR SELECT USING (public.is_admin());


--
-- Name: ws45_forecast_parse_runs admin read ws45 forecast parse runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin read ws45 forecast parse runs" ON public.ws45_forecast_parse_runs FOR SELECT USING (public.is_admin());


--
-- Name: launch_jep_scores admin update launch jep scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin update launch jep scores" ON public.launch_jep_scores FOR UPDATE USING (( SELECT public.is_admin() AS is_admin)) WITH CHECK (( SELECT public.is_admin() AS is_admin));


--
-- Name: ops_alerts admin update ops alerts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin update ops alerts" ON public.ops_alerts FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: ws45_forecast_parse_runs admin update ws45 forecast parse runs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin update ws45 forecast parse runs" ON public.ws45_forecast_parse_runs FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());


--
-- Name: admin_access_overrides admin updates own access override; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin updates own access override" ON public.admin_access_overrides FOR UPDATE USING (((auth.uid() = user_id) AND public.is_admin())) WITH CHECK (((auth.uid() = user_id) AND public.is_admin()));


--
-- Name: admin_access_overrides admin writes own access override; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin writes own access override" ON public.admin_access_overrides FOR INSERT WITH CHECK (((auth.uid() = user_id) AND public.is_admin()));


--
-- Name: admin_access_override_events admin writes own access override events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admin writes own access override events" ON public.admin_access_override_events FOR INSERT WITH CHECK (((auth.uid() = user_id) AND (auth.uid() = updated_by) AND public.is_admin()));


--
-- Name: admin_access_override_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_access_override_events ENABLE ROW LEVEL SECURITY;

--
-- Name: admin_access_overrides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.admin_access_overrides ENABLE ROW LEVEL SECURITY;

--
-- Name: api_rate_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.api_rate_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: apple_sign_in_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.apple_sign_in_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: ar_camera_guide_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ar_camera_guide_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_budget_lines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_budget_lines ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_content_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_content_items ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_content_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_content_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_contract_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_contract_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_contract_budget_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_contract_budget_map ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_entities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_entities ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_ingest_checkpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_ingest_checkpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_mission_components; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_mission_components ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_mission_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_mission_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_opportunity_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_opportunity_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_people; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_people ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_procurement_awards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_procurement_awards ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_program_procurement_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_program_procurement_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_sam_contract_award_rows; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_sam_contract_award_rows ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_social_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_social_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_source_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_source_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_source_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_source_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_spending_timeseries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_spending_timeseries ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_timeline_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.artemis_timeline_events ENABLE ROW LEVEL SECURITY;

--
-- Name: billing_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_contract_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_contract_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_contract_vehicle_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_contract_vehicle_map ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_engines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_engines ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_flights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_flights ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_ingest_checkpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_ingest_checkpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_mission_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_mission_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_opportunity_notices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_opportunity_notices ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_passengers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_passengers ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_payloads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_payloads ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_people_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_people_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_source_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_source_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_spending_timeseries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_spending_timeseries ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_timeline_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_timeline_events ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_traveler_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_traveler_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_travelers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_travelers ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_vehicle_engine_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_vehicle_engine_map ENABLE ROW LEVEL SECURITY;

--
-- Name: blue_origin_vehicles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.blue_origin_vehicles ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_feeds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_feeds ENABLE ROW LEVEL SECURITY;

--
-- Name: canonical_contracts_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.canonical_contracts_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: celestrak_datasets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.celestrak_datasets ENABLE ROW LEVEL SECURITY;

--
-- Name: celestrak_intdes_datasets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.celestrak_intdes_datasets ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_campaign_provider_artifacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_campaign_provider_artifacts ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_campaign_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_campaign_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: embed_widgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.embed_widgets ENABLE ROW LEVEL SECURITY;

--
-- Name: faa_launch_match_dirty_launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faa_launch_match_dirty_launches ENABLE ROW LEVEL SECURITY;

--
-- Name: faa_launch_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faa_launch_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: faa_notam_details; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faa_notam_details ENABLE ROW LEVEL SECURITY;

--
-- Name: faa_tfr_records; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faa_tfr_records ENABLE ROW LEVEL SECURITY;

--
-- Name: faa_tfr_shapes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.faa_tfr_shapes ENABLE ROW LEVEL SECURITY;

--
-- Name: feedback_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feedback_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: ingestion_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ingestion_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_background_light_cells; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_background_light_cells ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_corridor_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_corridor_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_feature_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_feature_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_horizon_masks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_horizon_masks ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_moon_ephemerides; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_moon_ephemerides ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_observer_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_observer_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_outcome_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_outcome_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_source_fetch_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_source_fetch_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_source_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_source_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: jep_vehicle_priors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.jep_vehicle_priors ENABLE ROW LEVEL SECURITY;

--
-- Name: job_locks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.job_locks ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_expected_satellite_payloads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_expected_satellite_payloads ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_external_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_external_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_filter_presets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_filter_presets ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_jep_score_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_jep_score_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_jep_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_jep_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_object_inventory_snapshot_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_object_inventory_snapshot_items ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_object_inventory_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_object_inventory_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_pad_preview_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_pad_preview_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_refresh_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_refresh_state ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_social_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_social_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_social_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_social_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_trajectory_constraints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_trajectory_constraints ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_trajectory_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_trajectory_products ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_updates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_updates ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_weather; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launch_weather ENABLE ROW LEVEL SECURITY;

--
-- Name: launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launches ENABLE ROW LEVEL SECURITY;

--
-- Name: launches_public_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.launches_public_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: legal_acceptances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_agencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_agencies ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_astronaut_launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_astronaut_launches ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_astronauts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_astronauts ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_catalog_public_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_catalog_public_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_docking_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_docking_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_event_launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_event_launches ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_expeditions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_expeditions ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_landings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_landings ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_launch_landings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_launch_landings ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_launcher_launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_launcher_launches ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_launchers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_launchers ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_locations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_locations ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_pads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_pads ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_payload_flight_docking_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_payload_flight_docking_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_payload_flights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_payload_flights ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_payload_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_payload_types ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_payloads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_payloads ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_rocket_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_rocket_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_space_stations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_space_stations ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_spacecraft_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_spacecraft_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_spacecraft_configurations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_spacecraft_configurations ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_spacecraft_flight_docking_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_spacecraft_flight_docking_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_spacecraft_flights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_spacecraft_flights ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_spacecraft_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_spacecraft_types ENABLE ROW LEVEL SECURITY;

--
-- Name: ll2_spacecrafts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ll2_spacecrafts ENABLE ROW LEVEL SECURITY;

--
-- Name: managed_scheduler_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.managed_scheduler_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: managed_scheduler_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.managed_scheduler_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_auth_risk_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_auth_risk_events ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_auth_risk_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_auth_risk_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_push_installations_v2; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_push_installations_v2 ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_push_outbox_v2; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_push_outbox_v2 ENABLE ROW LEVEL SECURITY;

--
-- Name: mobile_push_rules_v2; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.mobile_push_rules_v2 ENABLE ROW LEVEL SECURITY;

--
-- Name: navcen_bnm_hazard_areas; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.navcen_bnm_hazard_areas ENABLE ROW LEVEL SECURITY;

--
-- Name: navcen_bnm_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.navcen_bnm_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_alert_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_alert_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_push_destinations_v3; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_push_destinations_v3 ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_push_devices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_push_devices ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_rules_v3; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_rules_v3 ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_usage_monthly; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_usage_monthly ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: nws_points; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nws_points ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_metrics_samples_1m; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_metrics_samples_1m ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_metrics_samples_5m; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_metrics_samples_5m ENABLE ROW LEVEL SECURITY;

--
-- Name: orbit_elements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.orbit_elements ENABLE ROW LEVEL SECURITY;

--
-- Name: launch_trajectory_products paid read launch trajectory products; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "paid read launch trajectory products" ON public.launch_trajectory_products FOR SELECT USING ((public.is_paid_user() OR public.is_admin()));


--
-- Name: launch_weather paid read launch weather; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "paid read launch weather" ON public.launch_weather FOR SELECT USING ((public.is_paid_user() OR public.is_admin()));


--
-- Name: launches paid read launches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "paid read launches" ON public.launches FOR SELECT USING ((public.is_paid_user() OR public.is_admin()));


--
-- Name: ws45_launch_forecasts paid read ws45 launch forecasts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "paid read ws45 launch forecasts" ON public.ws45_launch_forecasts FOR SELECT USING ((public.is_paid_user() OR public.is_admin()));


--
-- Name: ws45_live_weather_snapshots paid read ws45 live weather snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "paid read ws45 live weather snapshots" ON public.ws45_live_weather_snapshots FOR SELECT USING ((public.is_paid_user() OR public.is_admin()));


--
-- Name: ws45_planning_forecasts paid read ws45 planning forecasts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "paid read ws45 planning forecasts" ON public.ws45_planning_forecasts FOR SELECT USING ((public.is_paid_user() OR public.is_admin()));


--
-- Name: launch_refresh_state premium read live launch refresh state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "premium read live launch refresh state" ON public.launch_refresh_state FOR SELECT USING (((scope = ANY (ARRAY['feed_live'::text, 'detail_live'::text])) AND (( SELECT public.is_paid_user() AS is_paid_user) OR ( SELECT public.is_admin() AS is_admin))));


--
-- Name: premium_claims; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.premium_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: premium_onboarding_allow_creates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.premium_onboarding_allow_creates ENABLE ROW LEVEL SECURITY;

--
-- Name: premium_onboarding_intents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.premium_onboarding_intents ENABLE ROW LEVEL SECURITY;

--
-- Name: privacy_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.privacy_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles read own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles read own" ON public.profiles FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: profiles profiles update own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "profiles update own" ON public.profiles FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: program_contract_story_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_contract_story_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: program_contract_story_discoveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_contract_story_discoveries ENABLE ROW LEVEL SECURITY;

--
-- Name: program_contract_story_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_contract_story_links ENABLE ROW LEVEL SECURITY;

--
-- Name: program_contract_story_source_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_contract_story_source_links ENABLE ROW LEVEL SECURITY;

--
-- Name: program_usaspending_scope_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.program_usaspending_scope_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: providers_public_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.providers_public_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_budget_lines public read artemis budget lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis budget lines" ON public.artemis_budget_lines FOR SELECT USING (true);


--
-- Name: artemis_content_items public read artemis content items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis content items" ON public.artemis_content_items FOR SELECT USING (true);


--
-- Name: artemis_contract_actions public read artemis contract actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis contract actions" ON public.artemis_contract_actions FOR SELECT USING (true);


--
-- Name: artemis_contract_budget_map public read artemis contract budget map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis contract budget map" ON public.artemis_contract_budget_map FOR SELECT USING (true);


--
-- Name: artemis_contracts public read artemis contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis contracts" ON public.artemis_contracts FOR SELECT USING (true);


--
-- Name: artemis_entities public read artemis entities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis entities" ON public.artemis_entities FOR SELECT USING (true);


--
-- Name: artemis_mission_components public read artemis mission components; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis mission components" ON public.artemis_mission_components FOR SELECT USING (true);


--
-- Name: artemis_mission_snapshots public read artemis mission snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis mission snapshots" ON public.artemis_mission_snapshots FOR SELECT USING (true);


--
-- Name: artemis_opportunity_notices public read artemis opportunity notices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis opportunity notices" ON public.artemis_opportunity_notices FOR SELECT USING (true);


--
-- Name: artemis_people public read artemis people; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis people" ON public.artemis_people FOR SELECT USING (true);


--
-- Name: artemis_procurement_awards public read artemis procurement awards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis procurement awards" ON public.artemis_procurement_awards FOR SELECT USING (true);


--
-- Name: artemis_program_procurement_cache public read artemis program procurement cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis program procurement cache" ON public.artemis_program_procurement_cache FOR SELECT USING (true);


--
-- Name: artemis_sam_contract_award_rows public read artemis sam contract award rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis sam contract award rows" ON public.artemis_sam_contract_award_rows FOR SELECT USING (true);


--
-- Name: artemis_social_accounts public read artemis social accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis social accounts" ON public.artemis_social_accounts FOR SELECT USING (true);


--
-- Name: artemis_source_registry public read artemis source registry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis source registry" ON public.artemis_source_registry FOR SELECT USING (true);


--
-- Name: artemis_spending_timeseries public read artemis spending timeseries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis spending timeseries" ON public.artemis_spending_timeseries FOR SELECT USING (true);


--
-- Name: artemis_timeline_events public read artemis timeline events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read artemis timeline events" ON public.artemis_timeline_events FOR SELECT USING (true);


--
-- Name: blue_origin_contract_actions public read blue origin contract actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin contract actions" ON public.blue_origin_contract_actions FOR SELECT USING (true);


--
-- Name: blue_origin_contract_vehicle_map public read blue origin contract vehicle map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin contract vehicle map" ON public.blue_origin_contract_vehicle_map FOR SELECT USING (true);


--
-- Name: blue_origin_contracts public read blue origin contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin contracts" ON public.blue_origin_contracts FOR SELECT USING (true);


--
-- Name: blue_origin_engines public read blue origin engines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin engines" ON public.blue_origin_engines FOR SELECT USING (true);


--
-- Name: blue_origin_flights public read blue origin flights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin flights" ON public.blue_origin_flights FOR SELECT USING (true);


--
-- Name: blue_origin_ingest_checkpoints public read blue origin ingest checkpoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin ingest checkpoints" ON public.blue_origin_ingest_checkpoints FOR SELECT USING (true);


--
-- Name: blue_origin_mission_snapshots public read blue origin mission snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin mission snapshots" ON public.blue_origin_mission_snapshots FOR SELECT USING (true);


--
-- Name: blue_origin_opportunity_notices public read blue origin opportunity notices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin opportunity notices" ON public.blue_origin_opportunity_notices FOR SELECT USING (true);


--
-- Name: blue_origin_passengers public read blue origin passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin passengers" ON public.blue_origin_passengers FOR SELECT USING (true);


--
-- Name: blue_origin_payloads public read blue origin payloads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin payloads" ON public.blue_origin_payloads FOR SELECT USING (true);


--
-- Name: blue_origin_people_profiles public read blue origin people profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin people profiles" ON public.blue_origin_people_profiles FOR SELECT USING (true);


--
-- Name: blue_origin_source_documents public read blue origin source documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin source documents" ON public.blue_origin_source_documents FOR SELECT USING (true);


--
-- Name: blue_origin_spending_timeseries public read blue origin spending timeseries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin spending timeseries" ON public.blue_origin_spending_timeseries FOR SELECT USING (true);


--
-- Name: blue_origin_timeline_events public read blue origin timeline; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin timeline" ON public.blue_origin_timeline_events FOR SELECT USING (true);


--
-- Name: blue_origin_traveler_sources public read blue origin traveler sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin traveler sources" ON public.blue_origin_traveler_sources FOR SELECT USING (true);


--
-- Name: blue_origin_travelers public read blue origin travelers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin travelers" ON public.blue_origin_travelers FOR SELECT USING (true);


--
-- Name: blue_origin_vehicle_engine_map public read blue origin vehicle engine map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin vehicle engine map" ON public.blue_origin_vehicle_engine_map FOR SELECT USING (true);


--
-- Name: blue_origin_vehicles public read blue origin vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read blue origin vehicles" ON public.blue_origin_vehicles FOR SELECT USING (true);


--
-- Name: faa_launch_matches public read faa launch matches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read faa launch matches" ON public.faa_launch_matches FOR SELECT USING (true);


--
-- Name: faa_tfr_records public read faa tfr records; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read faa tfr records" ON public.faa_tfr_records FOR SELECT USING (true);


--
-- Name: faa_tfr_shapes public read faa tfr shapes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read faa tfr shapes" ON public.faa_tfr_shapes FOR SELECT USING (true);


--
-- Name: launch_external_resources public read launch external resources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read launch external resources" ON public.launch_external_resources FOR SELECT USING (true);


--
-- Name: launch_jep_scores public read launch jep scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read launch jep scores" ON public.launch_jep_scores FOR SELECT USING (true);


--
-- Name: ll2_astronaut_launches public read ll2 astronaut launches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 astronaut launches" ON public.ll2_astronaut_launches FOR SELECT USING (true);


--
-- Name: ll2_catalog_public_cache public read ll2 catalog cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 catalog cache" ON public.ll2_catalog_public_cache FOR SELECT USING (true);


--
-- Name: ll2_event_launches public read ll2 event launches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 event launches" ON public.ll2_event_launches FOR SELECT USING (true);


--
-- Name: ll2_events public read ll2 events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 events" ON public.ll2_events FOR SELECT USING (true);


--
-- Name: ll2_landings public read ll2 landings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 landings" ON public.ll2_landings FOR SELECT USING (true);


--
-- Name: ll2_launch_landings public read ll2 launch landings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 launch landings" ON public.ll2_launch_landings FOR SELECT USING (true);


--
-- Name: ll2_launcher_launches public read ll2 launcher launches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 launcher launches" ON public.ll2_launcher_launches FOR SELECT USING (true);


--
-- Name: ll2_launchers public read ll2 launchers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 launchers" ON public.ll2_launchers FOR SELECT USING (true);


--
-- Name: ll2_payload_flight_docking_events public read ll2 payload flight docking events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 payload flight docking events" ON public.ll2_payload_flight_docking_events FOR SELECT USING (true);


--
-- Name: ll2_payload_flights public read ll2 payload flights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 payload flights" ON public.ll2_payload_flights FOR SELECT USING (true);


--
-- Name: ll2_payload_types public read ll2 payload types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 payload types" ON public.ll2_payload_types FOR SELECT USING (true);


--
-- Name: ll2_payloads public read ll2 payloads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 payloads" ON public.ll2_payloads FOR SELECT USING (true);


--
-- Name: ll2_spacecraft_configs public read ll2 spacecraft configs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 spacecraft configs" ON public.ll2_spacecraft_configs FOR SELECT USING (true);


--
-- Name: ll2_spacecraft_flight_docking_events public read ll2 spacecraft flight docking events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 spacecraft flight docking events" ON public.ll2_spacecraft_flight_docking_events FOR SELECT USING (true);


--
-- Name: ll2_spacecraft_flights public read ll2 spacecraft flights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 spacecraft flights" ON public.ll2_spacecraft_flights FOR SELECT USING (true);


--
-- Name: ll2_spacecraft_types public read ll2 spacecraft types; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 spacecraft types" ON public.ll2_spacecraft_types FOR SELECT USING (true);


--
-- Name: ll2_spacecrafts public read ll2 spacecrafts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read ll2 spacecrafts" ON public.ll2_spacecrafts FOR SELECT USING (true);


--
-- Name: program_contract_story_discoveries public read program contract story discoveries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read program contract story discoveries" ON public.program_contract_story_discoveries FOR SELECT USING (true);


--
-- Name: program_contract_story_links public read program contract story links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read program contract story links" ON public.program_contract_story_links FOR SELECT USING (true);


--
-- Name: program_contract_story_source_links public read program contract story source links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read program contract story source links" ON public.program_contract_story_source_links FOR SELECT USING (true);


--
-- Name: program_usaspending_scope_reviews public read program usaspending scope reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read program usaspending scope reviews" ON public.program_usaspending_scope_reviews FOR SELECT USING (true);


--
-- Name: providers_public_cache public read providers cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read providers cache" ON public.providers_public_cache FOR SELECT USING (true);


--
-- Name: launches_public_cache public read public cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read public cache" ON public.launches_public_cache FOR SELECT USING (true);


--
-- Name: launch_refresh_state public read public launch refresh state; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read public launch refresh state" ON public.launch_refresh_state FOR SELECT USING ((scope = ANY (ARRAY['feed_public'::text, 'detail_public'::text])));


--
-- Name: search_documents public read search documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read search documents" ON public.search_documents FOR SELECT USING (true);


--
-- Name: snapi_item_events public read snapi item events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read snapi item events" ON public.snapi_item_events FOR SELECT USING (true);


--
-- Name: snapi_item_launches public read snapi item launches; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read snapi item launches" ON public.snapi_item_launches FOR SELECT USING (true);


--
-- Name: snapi_items public read snapi items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read snapi items" ON public.snapi_items FOR SELECT USING (true);


--
-- Name: spacex_drone_ship_assignments public read spacex drone ship assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read spacex drone ship assignments" ON public.spacex_drone_ship_assignments FOR SELECT USING (true);


--
-- Name: spacex_drone_ships public read spacex drone ships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "public read spacex drone ships" ON public.spacex_drone_ships FOR SELECT USING (true);


--
-- Name: purchase_entitlements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_entitlements ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_events ENABLE ROW LEVEL SECURITY;

--
-- Name: purchase_provider_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.purchase_provider_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: rss_feeds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.rss_feeds ENABLE ROW LEVEL SECURITY;

--
-- Name: sam_awards_extract_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sam_awards_extract_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: sam_entity_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sam_entity_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: sam_query_fingerprints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sam_query_fingerprints ENABLE ROW LEVEL SECURITY;

--
-- Name: sam_query_partitions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sam_query_partitions ENABLE ROW LEVEL SECURITY;

--
-- Name: satellite_group_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.satellite_group_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: satellites; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.satellites ENABLE ROW LEVEL SECURITY;

--
-- Name: search_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: search_sync_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: artemis_sam_contract_award_rows service role delete artemis sam contract award rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role delete artemis sam contract award rows" ON public.artemis_sam_contract_award_rows FOR DELETE TO service_role USING (true);


--
-- Name: artemis_sam_contract_award_rows service role insert artemis sam contract award rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role insert artemis sam contract award rows" ON public.artemis_sam_contract_award_rows FOR INSERT TO service_role WITH CHECK (true);


--
-- Name: artemis_budget_lines service role manage artemis budget lines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis budget lines" ON public.artemis_budget_lines TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_content_items service role manage artemis content items; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis content items" ON public.artemis_content_items TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_content_scores service role manage artemis content scores; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis content scores" ON public.artemis_content_scores TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_contract_actions service role manage artemis contract actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis contract actions" ON public.artemis_contract_actions TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_contract_budget_map service role manage artemis contract budget map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis contract budget map" ON public.artemis_contract_budget_map TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_contracts service role manage artemis contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis contracts" ON public.artemis_contracts TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_entities service role manage artemis entities; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis entities" ON public.artemis_entities TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_ingest_checkpoints service role manage artemis ingest checkpoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis ingest checkpoints" ON public.artemis_ingest_checkpoints TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_mission_components service role manage artemis mission components; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis mission components" ON public.artemis_mission_components TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_mission_snapshots service role manage artemis mission snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis mission snapshots" ON public.artemis_mission_snapshots TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_opportunity_notices service role manage artemis opportunity notices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis opportunity notices" ON public.artemis_opportunity_notices TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_people service role manage artemis people; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis people" ON public.artemis_people TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_procurement_awards service role manage artemis procurement awards; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis procurement awards" ON public.artemis_procurement_awards TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_social_accounts service role manage artemis social accounts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis social accounts" ON public.artemis_social_accounts TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_source_documents service role manage artemis source documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis source documents" ON public.artemis_source_documents TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_source_registry service role manage artemis source registry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis source registry" ON public.artemis_source_registry TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_spending_timeseries service role manage artemis spending timeseries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis spending timeseries" ON public.artemis_spending_timeseries TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_timeline_events service role manage artemis timeline events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage artemis timeline events" ON public.artemis_timeline_events TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_contract_actions service role manage blue origin contract actions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin contract actions" ON public.blue_origin_contract_actions TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_contract_vehicle_map service role manage blue origin contract vehicle map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin contract vehicle map" ON public.blue_origin_contract_vehicle_map TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_contracts service role manage blue origin contracts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin contracts" ON public.blue_origin_contracts TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_engines service role manage blue origin engines; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin engines" ON public.blue_origin_engines TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_flights service role manage blue origin flights; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin flights" ON public.blue_origin_flights TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_ingest_checkpoints service role manage blue origin ingest checkpoints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin ingest checkpoints" ON public.blue_origin_ingest_checkpoints TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_mission_snapshots service role manage blue origin mission snapshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin mission snapshots" ON public.blue_origin_mission_snapshots TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_opportunity_notices service role manage blue origin opportunity notices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin opportunity notices" ON public.blue_origin_opportunity_notices TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_passengers service role manage blue origin passengers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin passengers" ON public.blue_origin_passengers TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_payloads service role manage blue origin payloads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin payloads" ON public.blue_origin_payloads TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_people_profiles service role manage blue origin people profiles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin people profiles" ON public.blue_origin_people_profiles TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_source_documents service role manage blue origin source documents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin source documents" ON public.blue_origin_source_documents TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_spending_timeseries service role manage blue origin spending timeseries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin spending timeseries" ON public.blue_origin_spending_timeseries TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_timeline_events service role manage blue origin timeline; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin timeline" ON public.blue_origin_timeline_events TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_traveler_sources service role manage blue origin traveler sources; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin traveler sources" ON public.blue_origin_traveler_sources TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_travelers service role manage blue origin travelers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin travelers" ON public.blue_origin_travelers TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_vehicle_engine_map service role manage blue origin vehicle engine map; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin vehicle engine map" ON public.blue_origin_vehicle_engine_map TO service_role USING (true) WITH CHECK (true);


--
-- Name: blue_origin_vehicles service role manage blue origin vehicles; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage blue origin vehicles" ON public.blue_origin_vehicles TO service_role USING (true) WITH CHECK (true);


--
-- Name: canonical_contracts_cache service role manage canonical contracts cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage canonical contracts cache" ON public.canonical_contracts_cache TO service_role USING (true) WITH CHECK (true);


--
-- Name: legal_acceptances service role manage legal acceptances; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage legal acceptances" ON public.legal_acceptances USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: notification_push_destinations_v3 service role manage notification push destinations v3; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage notification push destinations v3" ON public.notification_push_destinations_v3 TO service_role USING (true) WITH CHECK (true);


--
-- Name: notification_rules_v3 service role manage notification rules v3; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage notification rules v3" ON public.notification_rules_v3 TO service_role USING (true) WITH CHECK (true);


--
-- Name: ops_metrics_samples_1m service role manage ops metrics 1m; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage ops metrics 1m" ON public.ops_metrics_samples_1m TO service_role USING (true) WITH CHECK (true);


--
-- Name: ops_metrics_samples_5m service role manage ops metrics 5m; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage ops metrics 5m" ON public.ops_metrics_samples_5m TO service_role USING (true) WITH CHECK (true);


--
-- Name: premium_claims service role manage premium claims; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage premium claims" ON public.premium_claims TO service_role USING (true) WITH CHECK (true);


--
-- Name: premium_onboarding_allow_creates service role manage premium onboarding allow creates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage premium onboarding allow creates" ON public.premium_onboarding_allow_creates USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: premium_onboarding_intents service role manage premium onboarding intents; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage premium onboarding intents" ON public.premium_onboarding_intents USING ((auth.role() = 'service_role'::text)) WITH CHECK ((auth.role() = 'service_role'::text));


--
-- Name: program_contract_story_candidates service role manage program contract story candidates; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage program contract story candidates" ON public.program_contract_story_candidates TO service_role USING (true) WITH CHECK (true);


--
-- Name: program_contract_story_discoveries service role manage program contract story discoveries; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage program contract story discoveries" ON public.program_contract_story_discoveries TO service_role USING (true) WITH CHECK (true);


--
-- Name: program_contract_story_links service role manage program contract story links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage program contract story links" ON public.program_contract_story_links TO service_role USING (true) WITH CHECK (true);


--
-- Name: program_contract_story_source_links service role manage program contract story source links; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage program contract story source links" ON public.program_contract_story_source_links TO service_role USING (true) WITH CHECK (true);


--
-- Name: program_usaspending_scope_reviews service role manage program usaspending scope reviews; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage program usaspending scope reviews" ON public.program_usaspending_scope_reviews TO service_role USING (true) WITH CHECK (true);


--
-- Name: sam_awards_extract_jobs service role manage sam awards extract jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage sam awards extract jobs" ON public.sam_awards_extract_jobs TO service_role USING (true) WITH CHECK (true);


--
-- Name: sam_entity_registry service role manage sam entity registry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage sam entity registry" ON public.sam_entity_registry TO service_role USING (true) WITH CHECK (true);


--
-- Name: sam_query_fingerprints service role manage sam query fingerprints; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage sam query fingerprints" ON public.sam_query_fingerprints TO service_role USING (true) WITH CHECK (true);


--
-- Name: sam_query_partitions service role manage sam query partitions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage sam query partitions" ON public.sam_query_partitions TO service_role USING (true) WITH CHECK (true);


--
-- Name: spacex_drone_ship_assignments service role manage spacex drone ship assignments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage spacex drone ship assignments" ON public.spacex_drone_ship_assignments TO service_role USING (true) WITH CHECK (true);


--
-- Name: spacex_drone_ships service role manage spacex drone ships; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manage spacex drone ships" ON public.spacex_drone_ships TO service_role USING (true) WITH CHECK (true);


--
-- Name: mobile_auth_risk_events service role manages mobile auth risk events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manages mobile auth risk events" ON public.mobile_auth_risk_events TO service_role USING (true) WITH CHECK (true);


--
-- Name: mobile_auth_risk_sessions service role manages mobile auth risk sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manages mobile auth risk sessions" ON public.mobile_auth_risk_sessions TO service_role USING (true) WITH CHECK (true);


--
-- Name: artemis_sam_contract_award_rows service role update artemis sam contract award rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role update artemis sam contract award rows" ON public.artemis_sam_contract_award_rows FOR UPDATE TO service_role USING (true) WITH CHECK (true);


--
-- Name: snapi_item_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snapi_item_events ENABLE ROW LEVEL SECURITY;

--
-- Name: snapi_item_launches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snapi_item_launches ENABLE ROW LEVEL SECURITY;

--
-- Name: snapi_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.snapi_items ENABLE ROW LEVEL SECURITY;

--
-- Name: social_accounts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;

--
-- Name: social_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

--
-- Name: spacex_drone_ship_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spacex_drone_ship_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: spacex_drone_ships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.spacex_drone_ships ENABLE ROW LEVEL SECURITY;

--
-- Name: stripe_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: system_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: tipjar_customers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.tipjar_customers ENABLE ROW LEVEL SECURITY;

--
-- Name: trajectory_product_lineage; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trajectory_product_lineage ENABLE ROW LEVEL SECURITY;

--
-- Name: trajectory_source_contracts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trajectory_source_contracts ENABLE ROW LEVEL SECURITY;

--
-- Name: trajectory_source_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.trajectory_source_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_feeds user owns calendar feeds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns calendar feeds" ON public.calendar_feeds USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: embed_widgets user owns embed widgets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns embed widgets" ON public.embed_widgets USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: launch_filter_presets user owns filter presets; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns filter presets" ON public.launch_filter_presets USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: launch_notification_preferences user owns launch notification prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns launch notification prefs" ON public.launch_notification_preferences USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: mobile_push_installations_v2 user owns mobile push installations v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns mobile push installations v2" ON public.mobile_push_installations_v2 USING (((owner_kind = 'user'::text) AND (auth.uid() = user_id))) WITH CHECK (((owner_kind = 'user'::text) AND (auth.uid() = user_id)));


--
-- Name: mobile_push_rules_v2 user owns mobile push rules v2; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns mobile push rules v2" ON public.mobile_push_rules_v2 USING (((owner_kind = 'user'::text) AND (auth.uid() = user_id))) WITH CHECK (((owner_kind = 'user'::text) AND (auth.uid() = user_id)));


--
-- Name: notification_alert_rules user owns notification alert rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns notification alert rules" ON public.notification_alert_rules USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notification_push_devices user owns notification push devices; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns notification push devices" ON public.notification_push_devices USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: notification_preferences user owns prefs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns prefs" ON public.notification_preferences USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: privacy_preferences user owns privacy preferences; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns privacy preferences" ON public.privacy_preferences USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: push_subscriptions user owns push subs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns push subs" ON public.push_subscriptions USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: rss_feeds user owns rss feeds; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns rss feeds" ON public.rss_feeds USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: watchlist_rules user owns watchlist rules; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns watchlist rules" ON public.watchlist_rules USING ((EXISTS ( SELECT 1
   FROM public.watchlists w
  WHERE ((w.id = watchlist_rules.watchlist_id) AND (w.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.watchlists w
  WHERE ((w.id = watchlist_rules.watchlist_id) AND (w.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: watchlists user owns watchlists; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user owns watchlists" ON public.watchlists USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: admin_access_overrides user reads own admin access override; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own admin access override" ON public.admin_access_overrides FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: purchase_entitlements user reads own purchase entitlements; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own purchase entitlements" ON public.purchase_entitlements FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: purchase_events user reads own purchase events; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own purchase events" ON public.purchase_events FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: purchase_provider_customers user reads own purchase provider customers; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own purchase provider customers" ON public.purchase_provider_customers FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: subscriptions user reads own subscription; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own subscription" ON public.subscriptions FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: tipjar_customers user reads own tipjar customer; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "user reads own tipjar customer" ON public.tipjar_customers FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: user_sign_in_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_sign_in_events ENABLE ROW LEVEL SECURITY;

--
-- Name: user_sign_in_events user_sign_in_events_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sign_in_events_self_insert ON public.user_sign_in_events FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_sign_in_events user_sign_in_events_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_sign_in_events_self_select ON public.user_sign_in_events FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_surface_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_surface_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: user_surface_summary user_surface_summary_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_surface_summary_self_insert ON public.user_surface_summary FOR INSERT WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_surface_summary user_surface_summary_self_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_surface_summary_self_select ON public.user_surface_summary FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: user_surface_summary user_surface_summary_self_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_surface_summary_self_update ON public.user_surface_summary FOR UPDATE USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: watchlist_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.watchlist_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: watchlists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.watchlists ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ws45_forecast_parse_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ws45_forecast_parse_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: ws45_launch_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ws45_launch_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: ws45_live_weather_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ws45_live_weather_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: ws45_planning_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ws45_planning_forecasts ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--


