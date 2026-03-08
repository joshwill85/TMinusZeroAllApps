-- Supabase Performance Advisor: Phase 2 snapshot capture for unused-index analysis.
--
-- Usage:
-- 1) Run this once now (baseline).
-- 2) Run this again after 30-45 days (must include weekly jobs).
-- 3) Run `docs/sql/performance_advisor_phase3_classify_unused_indexes.sql`.
--
-- Notes:
-- - Read/usage counters in pg_stat views reset on Postgres restart/failover.
-- - If a reset occurs during the window, restart the observation window.

create table if not exists public.performance_index_usage_snapshots (
  id bigserial primary key,
  captured_at timestamptz not null default now(),
  schema_name text not null,
  table_name text not null,
  index_name text not null,
  is_unique boolean not null,
  is_primary boolean not null,
  is_constraint_backed boolean not null,
  is_valid boolean not null,
  is_ready boolean not null,
  idx_scan bigint not null,
  idx_tup_read bigint not null,
  idx_tup_fetch bigint not null,
  table_write_ops_total bigint not null,
  table_seq_scan bigint not null,
  index_size_bytes bigint not null,
  index_def text not null
);

create index if not exists performance_index_usage_snapshots_captured_at_idx
  on public.performance_index_usage_snapshots(captured_at desc);

create index if not exists performance_index_usage_snapshots_index_key_idx
  on public.performance_index_usage_snapshots(schema_name, table_name, index_name, captured_at desc);

insert into public.performance_index_usage_snapshots (
  captured_at,
  schema_name,
  table_name,
  index_name,
  is_unique,
  is_primary,
  is_constraint_backed,
  is_valid,
  is_ready,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  table_write_ops_total,
  table_seq_scan,
  index_size_bytes,
  index_def
)
select
  now() as captured_at,
  ns.nspname as schema_name,
  tbl.relname as table_name,
  idx.relname as index_name,
  ind.indisunique as is_unique,
  ind.indisprimary as is_primary,
  exists (
    select 1
    from pg_constraint c
    where c.conindid = idx.oid
      and c.conrelid = tbl.oid
  ) as is_constraint_backed,
  ind.indisvalid as is_valid,
  ind.indisready as is_ready,
  coalesce(sui.idx_scan, 0) as idx_scan,
  coalesce(sui.idx_tup_read, 0) as idx_tup_read,
  coalesce(sui.idx_tup_fetch, 0) as idx_tup_fetch,
  coalesce(sut.n_tup_ins, 0)
    + coalesce(sut.n_tup_upd, 0)
    + coalesce(sut.n_tup_del, 0)
    + coalesce(sut.n_tup_hot_upd, 0) as table_write_ops_total,
  coalesce(sut.seq_scan, 0) as table_seq_scan,
  pg_relation_size(idx.oid) as index_size_bytes,
  coalesce(pgi.indexdef, '') as index_def
from pg_class tbl
join pg_namespace ns
  on ns.oid = tbl.relnamespace
join pg_index ind
  on ind.indrelid = tbl.oid
join pg_class idx
  on idx.oid = ind.indexrelid
left join pg_stat_user_indexes sui
  on sui.relid = tbl.oid
 and sui.indexrelid = idx.oid
left join pg_stat_user_tables sut
  on sut.relid = tbl.oid
left join pg_indexes pgi
  on pgi.schemaname = ns.nspname
 and pgi.tablename = tbl.relname
 and pgi.indexname = idx.relname
where ns.nspname = 'public'
  and tbl.relkind = 'r'
  and idx.relkind = 'i';

-- Verification: latest capture count and size.
select
  captured_at,
  count(*) as index_rows,
  pg_size_pretty(sum(index_size_bytes)) as total_index_size
from public.performance_index_usage_snapshots
where captured_at = (
  select max(captured_at)
  from public.performance_index_usage_snapshots
)
group by captured_at
order by captured_at desc;
