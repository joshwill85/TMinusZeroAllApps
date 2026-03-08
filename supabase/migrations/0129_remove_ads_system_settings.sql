delete from public.system_settings
where key in (
  'ads_enabled',
  'ads_mode',
  'ads_infeed_first_after_row',
  'ads_infeed_interval_rows',
  'ads_mobile_max_slots'
);
