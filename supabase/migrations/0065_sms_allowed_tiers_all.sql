-- Allow SMS alerts for all launch tiers.
-- Per-launch selection should not be blocked by tier.

update public.system_settings
set value = '["major","notable","routine"]'::jsonb
where key = 'sms_allowed_tiers';
