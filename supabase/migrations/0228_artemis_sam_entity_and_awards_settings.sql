-- SAM entity sync and contract-awards enrichment settings.

insert into public.system_settings (key, value)
values
  ('artemis_sam_entity_sync_enabled', 'true'::jsonb),
  ('artemis_sam_entity_api_url', '"https://api.sam.gov/entity-information/v4/entities"'::jsonb),
  (
    'artemis_sam_entity_alias_json',
    '[
      {"scope":"spacex","legalBusinessName":"Space Exploration Technologies Corp"},
      {"scope":"spacex","legalBusinessName":"SpaceX"},
      {"scope":"blue-origin","legalBusinessName":"Blue Origin, LLC"},
      {"scope":"blue-origin","legalBusinessName":"Blue Origin"}
    ]'::jsonb
  ),
  ('artemis_sam_contract_awards_include_deleted', 'true'::jsonb),
  ('artemis_sam_contract_awards_include_sections', '"coreData,contractId,nasaSpecific"'::jsonb)
on conflict (key) do nothing;
