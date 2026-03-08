-- Coalesce opportunistic trajectory product follow-up triggers so concurrent
-- source ingests do not stampede the generator with redundant runs.

insert into public.system_settings (key, value)
values ('trajectory_products_followup_cooldown_seconds', '90'::jsonb)
on conflict (key) do nothing;
