-- Schedule canonical contract-story sync job for Artemis + SpaceX + Blue Origin hubs.

insert into public.artemis_ingest_checkpoints (
  source_key,
  source_type,
  status,
  records_ingested,
  updated_at
)
values (
  'program_contract_story_sync',
  'procurement',
  'complete',
  0,
  now()
)
on conflict (source_key) do nothing;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'program_contract_story_sync') then
    perform cron.unschedule('program_contract_story_sync');
  end if;

  perform cron.schedule(
    'program_contract_story_sync',
    '45 */4 * * *',
    $job$select public.invoke_edge_job('program-contract-story-sync');$job$
  );
end $$;
