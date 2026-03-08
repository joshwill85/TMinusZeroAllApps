-- Telemetry-style session summaries for the Camera Guide (web AR overlay).
-- Privacy notes:
-- - No precise GPS, lat/lon, bearings, raw sensor streams, IPs, or full user-agent strings.
-- - Store only coarse buckets + session-level outcomes to debug reliability.

create table if not exists public.ar_camera_guide_sessions (
  id uuid primary key,
  launch_id uuid not null references public.launches(id) on delete cascade,

  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms int check (duration_ms is null or duration_ms >= 0),

  camera_status text check (camera_status is null or camera_status in ('granted','denied','prompt','error')),
  motion_status text check (motion_status is null or motion_status in ('granted','denied','prompt','error')),
  heading_status text check (heading_status is null or heading_status in ('ok','unavailable','noisy','unknown')),

  mode_entered text check (mode_entered is null or mode_entered in ('ar','sky_compass')),
  fallback_reason text check (fallback_reason is null or fallback_reason in ('camera_denied','motion_denied','no_heading','camera_error')),
  retry_count int not null default 0 check (retry_count >= 0),

  used_scrub boolean,
  scrub_seconds_total int check (scrub_seconds_total is null or scrub_seconds_total >= 0),

  lens_preset text check (lens_preset is null or lens_preset in ('0.5x','1x','2x','3x','custom')),
  corridor_mode text check (corridor_mode is null or corridor_mode in ('tight','normal','wide')),

  yaw_offset_bucket text,
  pitch_level_bucket text,
  hfov_bucket text,
  vfov_bucket text,

  trajectory_quality int check (trajectory_quality is null or (trajectory_quality >= 0 and trajectory_quality <= 3)),
  trajectory_version text,
  trajectory_duration_s int check (trajectory_duration_s is null or trajectory_duration_s >= 0),
  trajectory_step_s int check (trajectory_step_s is null or trajectory_step_s >= 0),
  avg_sigma_deg real check (avg_sigma_deg is null or (avg_sigma_deg >= 0 and avg_sigma_deg <= 90)),

  created_at timestamptz not null default now()
);

create index if not exists ar_camera_guide_sessions_launch_id_idx
  on public.ar_camera_guide_sessions (launch_id);

create index if not exists ar_camera_guide_sessions_created_at_idx
  on public.ar_camera_guide_sessions (created_at desc);

alter table public.ar_camera_guide_sessions enable row level security;

drop policy if exists "admin read ar camera guide sessions" on public.ar_camera_guide_sessions;
create policy "admin read ar camera guide sessions"
  on public.ar_camera_guide_sessions
  for select
  using (public.is_admin());

