# AR Trajectory Coverage Remediation Runbook

Date: 2026-02-10

## Purpose

Provide a safe, repeatable command path to refresh trajectory source/product jobs when coverage checks fail.

## Workflow

1. Baseline coverage check:
```bash
npm run trajectory:coverage:check -- --warn-only --output=.artifacts/ar-trajectory-coverage-check-before.json --markdown=.artifacts/ar-trajectory-coverage-check-before.md
```

2. Trigger trajectory refresh jobs:
```bash
npm run trajectory:refresh:jobs -- --output=.artifacts/ar-trajectory-refresh-jobs.json --markdown=.artifacts/ar-trajectory-refresh-jobs.md
```

3. Re-run coverage check:
```bash
npm run trajectory:coverage:check -- --warn-only --output=.artifacts/ar-trajectory-coverage-check-after.json --markdown=.artifacts/ar-trajectory-coverage-check-after.md
```

## Jobs triggered by default

- `trajectory-orbit-ingest`
- `trajectory-constraints-ingest`
- `navcen-bnm-ingest`
- `trajectory-products-generate`

## Options

- Dry run without invoking jobs:
```bash
npm run trajectory:refresh:jobs -- --dry-run
```

- Restrict to specific jobs:
```bash
npm run trajectory:refresh:jobs -- --jobs=trajectory-orbit-ingest,trajectory-products-generate
```

## Requirements

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `system_settings.jobs_auth_token` configured
