-- Persist every SAM Contract Awards response row for long-term queryability.
-- Contract actions keep normalized linkage; this table stores row-level payloads.

create table if not exists public.artemis_sam_contract_award_rows (
  id uuid primary key default gen_random_uuid(),
  row_key text not null unique,
  contract_id uuid not null references public.artemis_contracts(id) on delete cascade,
  contract_key text not null,
  mission_key text not null default 'program',
  program_scope text not null default 'other',
  solicitation_id text,
  piid text,
  referenced_idv_piid text,
  response_status int,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint artemis_sam_contract_award_rows_mission_key_check
    check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii')),
  constraint artemis_sam_contract_award_rows_program_scope_check
    check (program_scope in ('artemis', 'blue-origin', 'spacex', 'other'))
);

create index if not exists artemis_sam_contract_award_rows_contract_idx
  on public.artemis_sam_contract_award_rows(contract_id, updated_at desc);

create index if not exists artemis_sam_contract_award_rows_scope_idx
  on public.artemis_sam_contract_award_rows(program_scope, updated_at desc);

create index if not exists artemis_sam_contract_award_rows_solicitation_idx
  on public.artemis_sam_contract_award_rows(solicitation_id);

create index if not exists artemis_sam_contract_award_rows_piid_idx
  on public.artemis_sam_contract_award_rows(piid, referenced_idv_piid);

create index if not exists artemis_sam_contract_award_rows_source_document_idx
  on public.artemis_sam_contract_award_rows(source_document_id);

alter table public.artemis_sam_contract_award_rows enable row level security;

drop policy if exists "public read artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
create policy "public read artemis sam contract award rows" on public.artemis_sam_contract_award_rows
  for select using (true);

drop policy if exists "service role manage artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
create policy "service role manage artemis sam contract award rows" on public.artemis_sam_contract_award_rows
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
