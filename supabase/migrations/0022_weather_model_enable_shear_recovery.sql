-- Enable shear and recovery flags for wx_v2_lcc configuration with safe defaults.
update public.system_settings
set value = value || jsonb_build_object(
  'use_vertical_profiles', true,
  'shear_enabled', true,
  'recovery_enabled', true
)
where key = 'weather_model'
  and coalesce(value->>'model_version', '') = 'wx_v2_lcc';
