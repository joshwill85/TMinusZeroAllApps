-- JEP T-0 snapshot lock:
-- Preserve the final pre/at-launch score so post-launch refreshes do not drift historical values.

alter table if exists public.launch_jep_scores
  add column if not exists snapshot_at timestamptz;

create index if not exists launch_jep_scores_snapshot_idx
  on public.launch_jep_scores (snapshot_at desc)
  where snapshot_at is not null;

-- Backfill completed launches so historical detail pages render as static snapshots.
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
  );
