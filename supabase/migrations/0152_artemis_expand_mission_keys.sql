-- Expand Artemis mission key constraints from I-III to I-VII.

alter table public.artemis_timeline_events
  drop constraint if exists artemis_timeline_events_mission_key_check;

alter table public.artemis_timeline_events
  add constraint artemis_timeline_events_mission_key_check
  check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'));

alter table public.artemis_procurement_awards
  drop constraint if exists artemis_procurement_awards_mission_key_check;

alter table public.artemis_procurement_awards
  add constraint artemis_procurement_awards_mission_key_check
  check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'));

alter table public.artemis_mission_snapshots
  drop constraint if exists artemis_mission_snapshots_mission_key_check;

alter table public.artemis_mission_snapshots
  add constraint artemis_mission_snapshots_mission_key_check
  check (mission_key in ('program', 'artemis-i', 'artemis-ii', 'artemis-iii', 'artemis-iv', 'artemis-v', 'artemis-vi', 'artemis-vii'));
