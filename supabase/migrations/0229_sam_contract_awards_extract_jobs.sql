-- Async SAM Contract Awards extract job tracking.

create table if not exists public.sam_awards_extract_jobs (
  id uuid primary key default gen_random_uuid(),
  job_key text not null unique,
  contract_id uuid not null references public.artemis_contracts(id) on delete cascade,
  contract_key text not null,
  mission_key text not null default 'program',
  program_scope text not null default 'other',
  piid text not null,
  referenced_idv_piid text,
  extract_format text not null default 'json',
  request_url text not null,
  status text not null default 'requested',
  token text,
  job_status_url text,
  download_url text,
  response_status int,
  row_count int,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sam_awards_extract_jobs_scope_check
    check (program_scope in ('artemis', 'blue-origin', 'spacex', 'other')),
  constraint sam_awards_extract_jobs_format_check
    check (extract_format in ('json')),
  constraint sam_awards_extract_jobs_status_check
    check (status in ('requested', 'pending', 'processing', 'ready', 'applied', 'failed'))
);

create index if not exists sam_awards_extract_jobs_status_idx
  on public.sam_awards_extract_jobs(status, updated_at asc);

create index if not exists sam_awards_extract_jobs_contract_idx
  on public.sam_awards_extract_jobs(contract_id, updated_at desc);

alter table public.sam_awards_extract_jobs enable row level security;

drop policy if exists "service role manage sam awards extract jobs" on public.sam_awards_extract_jobs;
create policy "service role manage sam awards extract jobs" on public.sam_awards_extract_jobs
  for all
  to service_role
  using (true)
  with check (true);

insert into public.system_settings (key, value)
values
  ('artemis_sam_contract_awards_extract_enabled', 'true'::jsonb),
  ('artemis_sam_contract_awards_extract_format', '"json"'::jsonb),
  ('artemis_sam_contract_awards_extract_poll_limit', '5'::jsonb)
on conflict (key) do nothing;
