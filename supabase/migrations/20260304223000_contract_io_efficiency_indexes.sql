-- Contract/story IO efficiency follow-up:
-- 1) add story content hash to avoid no-op rewrites
-- 2) add missing lookup indexes on hot read/write paths

alter table if exists public.program_contract_story_links
  add column if not exists content_hash text;

create index if not exists program_contract_story_links_scope_contract_idx
  on public.program_contract_story_links(program_scope, primary_contract_key);

create index if not exists program_contract_story_links_scope_updated_story_idx
  on public.program_contract_story_links(program_scope, updated_at desc, story_key);

create index if not exists artemis_contract_actions_missing_solicitation_updated_idx
  on public.artemis_contract_actions(updated_at desc, contract_id)
  where solicitation_id is null;

create index if not exists artemis_contract_actions_missing_notice_updated_idx
  on public.artemis_contract_actions(updated_at desc, contract_id, solicitation_id)
  where solicitation_id is not null
    and sam_notice_id is null;
