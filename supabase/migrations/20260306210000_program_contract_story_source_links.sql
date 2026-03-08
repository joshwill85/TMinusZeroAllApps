create table if not exists public.program_contract_story_source_links (
  id uuid primary key default gen_random_uuid(),
  story_key text not null references public.program_contract_story_links(story_key) on delete cascade,
  program_scope text not null,
  source_type text not null,
  source_record_key text not null,
  title text,
  summary text,
  entity_name text,
  agency_name text,
  piid text,
  solicitation_id text,
  notice_id text,
  usaspending_award_id text,
  source_url text,
  published_at timestamptz,
  amount numeric,
  source_document_id uuid references public.artemis_source_documents(id) on delete set null,
  content_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint program_contract_story_source_links_story_source_unique
    unique (story_key, source_type, source_record_key),
  constraint program_contract_story_source_links_scope_check
    check (program_scope in ('artemis', 'spacex', 'blue-origin')),
  constraint program_contract_story_source_links_source_type_check
    check (source_type in ('usaspending-award', 'sam-contract-award', 'sam-opportunity'))
);

create index if not exists program_contract_story_source_links_story_idx
  on public.program_contract_story_source_links(story_key, source_type, published_at desc, updated_at desc);

create index if not exists program_contract_story_source_links_scope_source_idx
  on public.program_contract_story_source_links(program_scope, source_type, updated_at desc);

alter table public.program_contract_story_source_links enable row level security;

drop policy if exists "public read program contract story source links" on public.program_contract_story_source_links;
create policy "public read program contract story source links" on public.program_contract_story_source_links
  for select using (true);

drop policy if exists "service role manage program contract story source links" on public.program_contract_story_source_links;
create policy "service role manage program contract story source links" on public.program_contract_story_source_links
  for all
  to service_role
  using (true)
  with check (true);
