-- Remove Space-Track integration tables and settings.

drop table if exists public.spacetrack_gp_latest;
drop table if exists public.spacetrack_launch_objects;
drop table if exists public.spacetrack_objects;

delete from public.system_settings where key like 'spacetrack_%';
delete from public.api_rate_counters where provider in ('spacetrack', 'spacetrack_minute');
