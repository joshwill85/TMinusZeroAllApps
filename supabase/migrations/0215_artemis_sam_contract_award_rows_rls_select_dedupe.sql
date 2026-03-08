-- Reduce RLS policy evaluation overhead on artemis_sam_contract_award_rows.
-- Keep one permissive SELECT policy and scope service-role access to writes only.

do $$
begin
  if to_regclass('public.artemis_sam_contract_award_rows') is not null then
    drop policy if exists "public read artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
    create policy "public read artemis sam contract award rows"
      on public.artemis_sam_contract_award_rows
      for select
      to public
      using (true);

    drop policy if exists "service role manage artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
    drop policy if exists "service role insert artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
    drop policy if exists "service role update artemis sam contract award rows" on public.artemis_sam_contract_award_rows;
    drop policy if exists "service role delete artemis sam contract award rows" on public.artemis_sam_contract_award_rows;

    create policy "service role insert artemis sam contract award rows"
      on public.artemis_sam_contract_award_rows
      for insert
      to service_role
      with check (true);

    create policy "service role update artemis sam contract award rows"
      on public.artemis_sam_contract_award_rows
      for update
      to service_role
      using (true)
      with check (true);

    create policy "service role delete artemis sam contract award rows"
      on public.artemis_sam_contract_award_rows
      for delete
      to service_role
      using (true);
  end if;
end $$;
