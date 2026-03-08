-- Supabase Performance Advisor: Phase 3 objective classification.
--
-- Prerequisite:
-- - At least two snapshots in `public.performance_index_usage_snapshots`
--   with >= 30 days between min and max `captured_at`.
--
-- Output:
-- - Per-index classification: KEEP / REVIEW / DROP-CANDIDATE.
-- - Summary counts by classification.

with params as (
  select
    30::numeric as min_window_days,
    8::numeric as small_index_mb_threshold,
    32::numeric as large_index_mb_threshold,
    10000::bigint as write_ops_delta_threshold
),
snapshot_times as (
  select distinct captured_at
  from public.performance_index_usage_snapshots
  order by captured_at desc
  limit 2
),
bounds as (
  select
    min(captured_at) as start_at,
    max(captured_at) as end_at
  from snapshot_times
),
window_check as (
  select
    b.start_at,
    b.end_at,
    extract(epoch from (b.end_at - b.start_at)) / 86400.0 as observed_days
  from bounds b
),
start_rows as (
  select *
  from public.performance_index_usage_snapshots
  where captured_at = (select start_at from bounds)
),
end_rows as (
  select *
  from public.performance_index_usage_snapshots
  where captured_at = (select end_at from bounds)
),
joined as (
  select
    coalesce(e.schema_name, s.schema_name) as schema_name,
    coalesce(e.table_name, s.table_name) as table_name,
    coalesce(e.index_name, s.index_name) as index_name,
    coalesce(e.is_unique, s.is_unique, false) as is_unique,
    coalesce(e.is_primary, s.is_primary, false) as is_primary,
    coalesce(e.is_constraint_backed, s.is_constraint_backed, false) as is_constraint_backed,
    coalesce(e.is_valid, s.is_valid, false) as is_valid,
    coalesce(e.is_ready, s.is_ready, false) as is_ready,
    s.idx_scan as start_idx_scan,
    e.idx_scan as end_idx_scan,
    s.table_write_ops_total as start_table_write_ops_total,
    e.table_write_ops_total as end_table_write_ops_total,
    s.table_seq_scan as start_table_seq_scan,
    e.table_seq_scan as end_table_seq_scan,
    e.index_size_bytes as end_index_size_bytes,
    coalesce(e.index_def, s.index_def, '') as index_def,
    (s.id is not null) as exists_in_start,
    (e.id is not null) as exists_in_end
  from start_rows s
  full outer join end_rows e
    on e.schema_name = s.schema_name
   and e.table_name = s.table_name
   and e.index_name = s.index_name
),
deltas as (
  select
    j.*,
    greatest(coalesce(j.end_idx_scan, 0) - coalesce(j.start_idx_scan, 0), 0) as idx_scan_delta,
    greatest(
      coalesce(j.end_table_write_ops_total, 0) - coalesce(j.start_table_write_ops_total, 0),
      0
    ) as table_write_ops_delta,
    greatest(
      coalesce(j.end_table_seq_scan, 0) - coalesce(j.start_table_seq_scan, 0),
      0
    ) as table_seq_scan_delta,
    coalesce(j.end_index_size_bytes, 0) / 1024.0 / 1024.0 as index_size_mb
  from joined j
),
classified as (
  select
    d.schema_name,
    d.table_name,
    d.index_name,
    d.is_unique,
    d.is_primary,
    d.is_constraint_backed,
    d.is_valid,
    d.is_ready,
    d.idx_scan_delta,
    d.table_write_ops_delta,
    d.table_seq_scan_delta,
    round(d.index_size_mb::numeric, 2) as index_size_mb,
    case
      when not d.exists_in_end then 'REVIEW'
      when not d.exists_in_start then 'REVIEW'
      when d.is_primary or d.is_unique or d.is_constraint_backed then 'KEEP'
      when d.idx_scan_delta > 0 then 'KEEP'
      when d.idx_scan_delta = 0 and d.index_size_mb < (select small_index_mb_threshold from params) then 'REVIEW'
      when d.idx_scan_delta = 0
           and d.table_write_ops_delta >= (select write_ops_delta_threshold from params)
           and d.index_size_mb >= (select large_index_mb_threshold from params)
        then 'DROP-CANDIDATE'
      else 'REVIEW'
    end as classification,
    case
      when not d.exists_in_end then 'Index missing from end snapshot; verify migration history.'
      when not d.exists_in_start then 'Index created during window; keep under observation.'
      when d.is_primary or d.is_unique or d.is_constraint_backed then 'Constraint-backed or uniqueness-critical.'
      when d.idx_scan_delta > 0 then 'Observed index scans during window.'
      when d.idx_scan_delta = 0 and d.index_size_mb < (select small_index_mb_threshold from params) then 'No scans, but small index footprint.'
      when d.idx_scan_delta = 0
           and d.table_write_ops_delta >= (select write_ops_delta_threshold from params)
           and d.index_size_mb >= (select large_index_mb_threshold from params)
        then 'No scans with high write amplification and non-trivial size.'
      else 'No scans; impact uncertain.'
    end as rationale,
    d.index_def
  from deltas d
)
select
  c.*,
  wc.start_at,
  wc.end_at,
  round(wc.observed_days::numeric, 2) as observed_days,
  case
    when wc.observed_days < (select min_window_days from params)
      then 'WINDOW_TOO_SHORT'
    else 'WINDOW_OK'
  end as window_status
from classified c
cross join window_check wc
order by
  case c.classification
    when 'DROP-CANDIDATE' then 1
    when 'REVIEW' then 2
    else 3
  end,
  c.table_write_ops_delta desc,
  c.index_size_mb desc,
  c.schema_name,
  c.table_name,
  c.index_name;

-- Summary counts by classification.
with params as (
  select
    30::numeric as min_window_days,
    8::numeric as small_index_mb_threshold,
    32::numeric as large_index_mb_threshold,
    10000::bigint as write_ops_delta_threshold
),
snapshot_times as (
  select distinct captured_at
  from public.performance_index_usage_snapshots
  order by captured_at desc
  limit 2
),
bounds as (
  select
    min(captured_at) as start_at,
    max(captured_at) as end_at
  from snapshot_times
),
start_rows as (
  select *
  from public.performance_index_usage_snapshots
  where captured_at = (select start_at from bounds)
),
end_rows as (
  select *
  from public.performance_index_usage_snapshots
  where captured_at = (select end_at from bounds)
),
joined as (
  select
    coalesce(e.schema_name, s.schema_name) as schema_name,
    coalesce(e.table_name, s.table_name) as table_name,
    coalesce(e.index_name, s.index_name) as index_name,
    coalesce(e.is_unique, s.is_unique, false) as is_unique,
    coalesce(e.is_primary, s.is_primary, false) as is_primary,
    coalesce(e.is_constraint_backed, s.is_constraint_backed, false) as is_constraint_backed,
    s.idx_scan as start_idx_scan,
    e.idx_scan as end_idx_scan,
    s.table_write_ops_total as start_table_write_ops_total,
    e.table_write_ops_total as end_table_write_ops_total,
    e.index_size_bytes as end_index_size_bytes,
    (s.id is not null) as exists_in_start,
    (e.id is not null) as exists_in_end
  from start_rows s
  full outer join end_rows e
    on e.schema_name = s.schema_name
   and e.table_name = s.table_name
   and e.index_name = s.index_name
),
classified as (
  select
    case
      when not exists_in_end then 'REVIEW'
      when not exists_in_start then 'REVIEW'
      when is_primary or is_unique or is_constraint_backed then 'KEEP'
      when greatest(coalesce(end_idx_scan, 0) - coalesce(start_idx_scan, 0), 0) > 0 then 'KEEP'
      when greatest(coalesce(end_idx_scan, 0) - coalesce(start_idx_scan, 0), 0) = 0
           and (coalesce(end_index_size_bytes, 0) / 1024.0 / 1024.0) < (select small_index_mb_threshold from params)
        then 'REVIEW'
      when greatest(coalesce(end_idx_scan, 0) - coalesce(start_idx_scan, 0), 0) = 0
           and greatest(coalesce(end_table_write_ops_total, 0) - coalesce(start_table_write_ops_total, 0), 0) >= (select write_ops_delta_threshold from params)
           and (coalesce(end_index_size_bytes, 0) / 1024.0 / 1024.0) >= (select large_index_mb_threshold from params)
        then 'DROP-CANDIDATE'
      else 'REVIEW'
    end as classification
  from joined
)
select
  classification,
  count(*) as index_count
from classified
group by classification
order by classification;
