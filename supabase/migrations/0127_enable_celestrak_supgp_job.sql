-- Enable CelesTrak SupGP ingest job by default.
--
-- Production expects all scheduled jobs to run (except SMS, which is controlled separately).
-- SupGP was initially disabled to minimize load until validated.

insert into public.system_settings (key, value)
values ('celestrak_supgp_job_enabled', 'true'::jsonb)
on conflict (key) do update
  set value = excluded.value,
      updated_at = now();

