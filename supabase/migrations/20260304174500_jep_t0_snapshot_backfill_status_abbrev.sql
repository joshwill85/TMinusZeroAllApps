-- Follow-up backfill:
-- Some completed launches carry completion state in status_abbrev instead of status_name.
-- Lock those unsnapped rows as historical JEP snapshots.

update public.launch_jep_scores s
set
  snapshot_at = coalesce(s.snapshot_at, s.computed_at, now()),
  expires_at = null,
  updated_at = now()
from public.launches l
where s.launch_id = l.id
  and s.snapshot_at is null
  and l.net <= now()
  and (
    lower(coalesce(l.status_name, '')) like '%success%'
    or lower(coalesce(l.status_name, '')) like '%failure%'
    or lower(coalesce(l.status_abbrev, '')) like '%success%'
    or lower(coalesce(l.status_abbrev, '')) like '%failure%'
  );
