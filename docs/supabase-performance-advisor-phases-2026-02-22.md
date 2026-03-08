# Supabase Performance Advisor Phases (2026-02-22)

Goal: improve cost efficiency, fast load times, and overall database efficiency while keeping disk IO low and avoiding regressions.

## Status Snapshot

| Phase | Scope | Status | Notes |
| --- | --- | --- | --- |
| 1 | Add missing FK covering indexes | Complete | Implemented in `supabase/migrations/0198_missing_fk_indexes_phase4.sql`. |
| 2 | Observe + classify unused indexes | In progress | Snapshot tooling added: `docs/sql/performance_advisor_phase2_snapshot.sql`. Run baseline now and again after 30-45 days. |
| 3 | Bucket unused indexes (`KEEP`, `REVIEW`, `DROP-CANDIDATE`) | In progress | Objective classifier added: `docs/sql/performance_advisor_phase3_classify_unused_indexes.sql`. Run after observation window is complete. |
| 4 | Pilot drop small batch | Pending | 3-5 indexes max with rollback SQL ready. |
| 5 | Monitor and validate | Pending | 24-72h regression gate per batch. |
| 6 | Repeat controlled batches | Pending | Continue until low-value indexes are removed. |

## Phase 2 - Observation Plan (In progress)

- Capture baseline now:
  - Query latency (p95/p99) for top API paths.
  - IO and write pressure (`pg_stat_bgwriter`/provider metrics).
  - Index usage and size from `pg_stat_user_indexes` + `pg_relation_size`.
- Execute snapshot SQL now:
  - `docs/sql/performance_advisor_phase2_snapshot.sql`
- Run observation window for 30-45 days so weekly jobs are represented.
- Execute snapshot SQL again at end of window:
  - `docs/sql/performance_advisor_phase2_snapshot.sql`
- Do not drop any index during this window.

## Phase 3 - Classification Rules (In progress)

- `KEEP` when any are true:
  - Index backs a PK/UNIQUE/EXCLUDE/constraint expectation.
  - Business-critical or incident-prevention query path depends on it.
  - New/recent feature where traffic is still ramping.
- `REVIEW` when:
  - `idx_scan=0` but index is small or ownership/use is uncertain.
- `DROP-CANDIDATE` when all are true:
  - `idx_scan=0` for the full window.
  - Not constraint-backed.
  - Large enough to matter for write/storage cost.
  - Table is write-active enough that index maintenance has measurable IO cost.
- Run objective classifier:
  - `docs/sql/performance_advisor_phase3_classify_unused_indexes.sql`

## Phase 4 - Pilot Drop Batch (Pending)

- Pick 3-5 low-risk `DROP-CANDIDATE` indexes.
- Execute one `DROP INDEX CONCURRENTLY` at a time during off-peak.
- For each dropped index, keep matching recreate SQL ready.

## Phase 5 - Monitoring Gate (Pending)

- Observe for 24-72h after each batch:
  - Query latency regressions.
  - New sequential scan hotspots.
  - Error rates / timeout rates.
  - IO trends and autovacuum pressure.
- If regression appears, recreate affected index immediately.

## Phase 6 - Iterative Rollout (Pending)

- Repeat phases 4-5 in small batches.
- Stop when:
  - Remaining candidates are low impact, or
  - Regression risk outweighs expected savings.

## Execution Notes

- Prioritize indexes on high-write tables first for max IO/cost reduction.
- Keep each migration/risk unit small and verifiable.
- Prefer explicit rollback SQL in the same PR that removes an index.

## Execution Log

- [ ] Phase 2 baseline snapshot executed (`docs/sql/performance_advisor_phase2_snapshot.sql`)
- [ ] Phase 2 end-window snapshot executed (`docs/sql/performance_advisor_phase2_snapshot.sql`)
- [ ] Phase 3 classifier executed (`docs/sql/performance_advisor_phase3_classify_unused_indexes.sql`)
