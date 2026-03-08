-- Speed up latest successful run checks used by job monitoring/admin summaries.

create index if not exists ingestion_runs_job_success_ended_idx
  on public.ingestion_runs(job_name, success, ended_at desc)
  where ended_at is not null;
