-- Follow-up RLS performance cleanup:
-- - Scope ops metrics service-role policies to the service_role instead of evaluating auth.role() per row.
-- - Remove redundant launch_jep_scores SELECT overlap while preserving public reads and admin writes.

do $$
begin
  if to_regclass('public.ops_metrics_samples_1m') is not null then
    drop policy if exists "service role manage ops metrics 1m" on public.ops_metrics_samples_1m;
    create policy "service role manage ops metrics 1m"
      on public.ops_metrics_samples_1m
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.ops_metrics_samples_5m') is not null then
    drop policy if exists "service role manage ops metrics 5m" on public.ops_metrics_samples_5m;
    create policy "service role manage ops metrics 5m"
      on public.ops_metrics_samples_5m
      for all
      to service_role
      using (true)
      with check (true);
  end if;

  if to_regclass('public.launch_jep_scores') is not null then
    drop policy if exists "admin manage launch jep scores" on public.launch_jep_scores;
    drop policy if exists "admin insert launch jep scores" on public.launch_jep_scores;
    drop policy if exists "admin update launch jep scores" on public.launch_jep_scores;
    drop policy if exists "admin delete launch jep scores" on public.launch_jep_scores;

    create policy "admin insert launch jep scores"
      on public.launch_jep_scores
      for insert
      with check ((select public.is_admin()));

    create policy "admin update launch jep scores"
      on public.launch_jep_scores
      for update
      using ((select public.is_admin()))
      with check ((select public.is_admin()));

    create policy "admin delete launch jep scores"
      on public.launch_jep_scores
      for delete
      using ((select public.is_admin()));
  end if;
end $$;
