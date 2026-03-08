-- Managed scheduler hardening + visibility + pg_net response retention control.
--
-- Goals:
-- 1) make managed_scheduler_tick load-aware and tunable from system_settings
-- 2) expose managed scheduler health in a single admin RPC for the admin panel
-- 3) keep net._http_response bounded so pg_net write churn does not grow unbounded

insert into public.system_settings (key, value)
values
  ('managed_scheduler_enqueue_limit', '200'::jsonb),
  ('managed_scheduler_process_limit', '100'::jsonb),
  ('managed_scheduler_retry_delay_seconds', '120'::jsonb),
  ('managed_scheduler_max_queue_depth', '2500'::jsonb),
  ('managed_scheduler_queue_retain_hours', '168'::jsonb),
  ('net_http_response_retention_hours', '24'::jsonb),
  ('net_http_response_prune_batch_limit', '50000'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create or replace function public.prune_net_http_response(
  retain_hours_in int default null,
  batch_limit_in int default null
)
returns int
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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
$$;

create or replace function public.managed_scheduler_tick(
  enqueue_limit int default null,
  process_limit int default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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
$$;

create or replace function public.admin_get_managed_scheduler_stats(window_hours int default 24)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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

revoke execute on function public.prune_net_http_response(int, int) from public;
grant execute on function public.prune_net_http_response(int, int) to service_role;

revoke execute on function public.managed_scheduler_tick(int, int) from public;
grant execute on function public.managed_scheduler_tick(int, int) to service_role;

revoke execute on function public.admin_get_managed_scheduler_stats(int) from public;
grant execute on function public.admin_get_managed_scheduler_stats(int) to authenticated, service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'net_http_response_prune') then
    perform cron.unschedule('net_http_response_prune');
  end if;

  perform cron.schedule(
    'net_http_response_prune',
    '*/30 * * * *',
    $job$select public.prune_net_http_response();$job$
  );
end $$;

-- Apply a first prune batch immediately to start reducing backlog.
select public.prune_net_http_response();
