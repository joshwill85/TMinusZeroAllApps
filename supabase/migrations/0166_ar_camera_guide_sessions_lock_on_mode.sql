-- Distinguish production auto lock-on sessions from manual debug sessions.

alter table public.ar_camera_guide_sessions
  add column if not exists lock_on_mode text
    check (lock_on_mode is null or lock_on_mode in ('auto', 'manual_debug'));
