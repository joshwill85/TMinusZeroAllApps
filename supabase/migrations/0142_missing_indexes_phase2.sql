-- Phase 2 index fixes (safe / small tables).
-- Focus: missing FK indexes + common per-launch lookups.

-- Embed widgets: FK lookups (preset/watchlist joins).
create index if not exists embed_widgets_preset_id_idx on public.embed_widgets(preset_id);
create index if not exists embed_widgets_watchlist_id_idx on public.embed_widgets(watchlist_id);

-- Feedback submissions: admin/user lookup.
create index if not exists feedback_submissions_user_id_idx on public.feedback_submissions(user_id);

-- Payload/spacecraft manifest: landing joins.
create index if not exists ll2_payload_flights_ll2_landing_id_idx on public.ll2_payload_flights(ll2_landing_id);
create index if not exists ll2_spacecraft_flights_ll2_landing_id_idx on public.ll2_spacecraft_flights(ll2_landing_id);

-- Launch updates: common pattern is (launch_id) ORDER BY detected_at DESC.
create index if not exists launch_updates_launch_id_detected_at_idx on public.launch_updates(launch_id, detected_at desc);

-- System settings: FK lookup for auditing changes (small table; low-risk).
create index if not exists system_settings_updated_by_idx on public.system_settings(updated_by);

