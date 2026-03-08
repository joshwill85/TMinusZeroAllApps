insert into public.system_settings (key, value)
values ('artemis_sam_single_pass_per_endpoint', 'true'::jsonb)
on conflict (key) do nothing;
