-- Enable Edge-burst mode for LL2 incremental ingestion.
--
-- Preconditions:
-- - Edge Function `ll2-incremental-burst` is deployed
-- - `jobs_enabled=true` and `jobs_base_url/jobs_apikey/jobs_auth_token` are set
--
-- Expected outcome:
-- - `public.invoke_ll2_incremental_burst()` returns quickly (no Postgres sleep-loop).

insert into public.system_settings (key, value)
values ('ll2_incremental_use_edge_burst', 'true'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

-- Quick verification
select key, value, updated_at
from public.system_settings
where key in ('ll2_incremental_use_edge_burst', 'll2_incremental_job_enabled')
order by key;

