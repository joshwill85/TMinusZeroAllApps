-- Align RLS policies on artemis_sam_contract_award_rows with permissive policy best practices
-- and add a missing FK covering index for traveler source documents.

-- Fix auth initplan/perf warnings on artemis_sam_contract_award_rows:
-- - Restrict service-role policy to the service_role database role.
-- - Avoid auth.role() calls in the policy.
-- - Keep public read policy explicitly public-only.
do $$
begin
  if to_regclass('public.artemis_sam_contract_award_rows') is not null then
    drop policy if exists "public read artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
    create policy "public read artemis sam contract award rows" on public.artemis_sam_contract_award_rows
      for select to public using (true);

    drop policy if exists "service role manage artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
    create policy "service role manage artemis sam contract award rows" on public.artemis_sam_contract_award_rows
      for all to service_role
      using (true)
      with check (true);
  end if;
end $$;

-- Missing FK index reported by linter: blue_origin_traveler_sources.source_document_id
create index if not exists blue_origin_traveler_sources_source_document_id_idx
  on public.blue_origin_traveler_sources(source_document_id);
