# Artemis QA Scan

## Purpose
Run a read-only, end-to-end Artemis duplicate audit across:
- Artemis DB tables
- Server view-model projections
- UI-projected duplicate risk for Intel/Budget/Timeline surfaces

## Run
```bash
npm run qa:artemis -- --env=prod-readonly --window=30d --format=md
```

## Output
- `.artifacts/artemis-qa/artemis-qa-report.json`
- `.artifacts/artemis-qa/artemis-qa-report.md`

## Notes
- Script requires Supabase env vars:
  - `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- SQL templates for manual verification live under `scripts/artemis-qa/sql/`.
- Manual UI repro matrix lives in `scripts/artemis-qa/ui-cases.md`.

## Safe Cleanup Workflow
Use this for true-duplicate cleanup without risking valid rows:

1. Run dry-runs:
```bash
psql "$DATABASE_URL" -f scripts/artemis-qa/sql/08_artemis_budget_lines_true_duplicates_dry_run.sql
psql "$DATABASE_URL" -f scripts/artemis-qa/sql/10_artemis_timeline_refresh_duplicates_dry_run.sql
```

2. Confirm exact candidate counts and IDs.
For timeline refresh cleanup, treat rows as duplicates only when `mission`, `title`, `source_type`, day bucket, normalized `summary`, and normalized `source_url` all match.

3. Edit expected count guards in:
- `scripts/artemis-qa/sql/09_artemis_budget_lines_true_duplicates_apply.sql`
- `scripts/artemis-qa/sql/11_artemis_timeline_refresh_duplicates_apply.sql`

4. Apply in transactions:
```bash
psql "$DATABASE_URL" -f scripts/artemis-qa/sql/09_artemis_budget_lines_true_duplicates_apply.sql
psql "$DATABASE_URL" -f scripts/artemis-qa/sql/11_artemis_timeline_refresh_duplicates_apply.sql
```

5. Re-run QA:
```bash
npm run qa:artemis -- --env=prod-readonly --window=365d --format=md
```
