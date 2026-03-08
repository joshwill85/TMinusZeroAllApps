alter table public.notification_preferences
  add column if not exists sms_opt_out_at timestamptz;
