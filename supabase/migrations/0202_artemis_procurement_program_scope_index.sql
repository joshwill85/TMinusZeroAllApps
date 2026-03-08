-- Add a generated scope column and index for fast scoped USASpending reads.
alter table public.artemis_procurement_awards
  add column if not exists program_scope text
  generated always as (lower(coalesce(metadata->>'programScope', metadata->>'program_scope'))) stored;

create index if not exists artemis_procurement_awards_program_scope_awarded_idx
  on public.artemis_procurement_awards(program_scope, awarded_on desc, updated_at desc);
