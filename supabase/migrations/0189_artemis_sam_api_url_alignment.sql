-- Align SAM endpoint settings with documented API base paths.
-- Existing jobs still read from system_settings first, so this keeps behavior explicit in DB.

insert into public.system_settings (key, value)
values
  ('artemis_sam_opportunities_api_url', '"https://api.sam.gov/opportunities/v2/search"'::jsonb),
  ('artemis_sam_contract_awards_api_url', '"https://api.sam.gov/contract-awards/v1/search"'::jsonb)
on conflict (key) do update
set
  value = excluded.value,
  updated_at = now();
