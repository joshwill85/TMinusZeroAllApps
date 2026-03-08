-- Add normalized browser/device support profile telemetry for AR sessions.

alter table public.ar_camera_guide_sessions
  add column if not exists client_profile text
    check (
      client_profile is null
      or client_profile in (
        'android_chrome',
        'android_samsung_internet',
        'ios_webkit',
        'android_fallback',
        'desktop_debug',
        'unknown'
      )
    );
