-- Contract-awards lookups should search the normal corpus by default.

insert into public.system_settings (key, value, updated_at)
values ('artemis_sam_contract_awards_include_deleted', 'false'::jsonb, now())
on conflict (key) do update
set
  value = excluded.value,
  updated_at = excluded.updated_at;
