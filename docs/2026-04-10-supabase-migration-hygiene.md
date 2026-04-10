## Purpose

Freeze the incident-era Supabase migrations that are already applied in production and stop further edits to those historical versions.

This is repo hygiene only. It does not change production behavior.

## Production-applied incident-era migrations

These versions are recorded in `supabase_migrations.schema_migrations` in production and should now be treated as frozen history:

- [20260405120000_ws45_quality_and_admin_monitoring.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405120000_ws45_quality_and_admin_monitoring.sql)
- [20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql)
- [20260408143000_ws45_live_board_and_planning.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260408143000_ws45_live_board_and_planning.sql)
- [20260408190000_ws45_low_io_retention.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260408190000_ws45_low_io_retention.sql)
- [20260408224500_spacex_drone_ship_48h_low_io_retune.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260408224500_spacex_drone_ship_48h_low_io_retune.sql)
- [20260409100500_ws45_backfill_helper_selection_fix.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260409100500_ws45_backfill_helper_selection_fix.sql)

## Rules

1. Do not keep editing any of the frozen files above.
2. If behavior needs to change, add a new follow-up migration instead.
3. Do not use blanket `supabase db push` against a dirty migration worktree without first reviewing the frozen file list.
4. If a frozen file is dirty locally, handle it in a dedicated cleanup change with an explicit decision:
   - keep the current text and accept it as the canonical repo copy, or
   - revert it to the previously committed text
5. Do not mix unrelated feature work into that cleanup.

## Explicitly out of scope

- Unrelated migration edits that were not part of this incident response.
- Production rollback or migration deletion.
- Rewriting `schema_migrations` history again.

Example currently out of scope:

- [20260408113000_jep_vehicle_priors_phase3.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/20260408113000_jep_vehicle_priors_phase3.sql)

## Local audit helper

Use:

```bash
scripts/check-frozen-supabase-migrations.sh
```

For a non-zero exit when any frozen migration is dirty:

```bash
scripts/check-frozen-supabase-migrations.sh --strict
```

## Cleanup sequence

1. Run the audit helper and capture the current dirty frozen files.
2. Review each frozen file against production intent and the incident docs before changing anything.
3. Make a dedicated cleanup PR that touches only the frozen file set.
4. Use additive migrations for any further functional changes after that point.
