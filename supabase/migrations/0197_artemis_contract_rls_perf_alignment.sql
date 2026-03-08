-- Scope Artemis contract-table service policies to service_role and avoid per-row auth.role() checks.
-- This preserves behavior while removing unnecessary policy evaluation for non-service roles.

do $$
begin
  if to_regclass('public.artemis_contracts') is not null then
    drop policy if exists "service role manage artemis contracts" on public.artemis_contracts;
    create policy "service role manage artemis contracts"
      on public.artemis_contracts
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_contract_actions') is not null then
    drop policy if exists "service role manage artemis contract actions" on public.artemis_contract_actions;
    create policy "service role manage artemis contract actions"
      on public.artemis_contract_actions
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_opportunity_notices') is not null then
    drop policy if exists "service role manage artemis opportunity notices" on public.artemis_opportunity_notices;
    create policy "service role manage artemis opportunity notices"
      on public.artemis_opportunity_notices
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_contract_budget_map') is not null then
    drop policy if exists "service role manage artemis contract budget map" on public.artemis_contract_budget_map;
    create policy "service role manage artemis contract budget map"
      on public.artemis_contract_budget_map
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.artemis_spending_timeseries') is not null then
    drop policy if exists "service role manage artemis spending timeseries" on public.artemis_spending_timeseries;
    create policy "service role manage artemis spending timeseries"
      on public.artemis_spending_timeseries
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;
