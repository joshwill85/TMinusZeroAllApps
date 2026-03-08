#!/usr/bin/env bash
# Deprecated: local ingestion scripts were removed to avoid drift from production behavior.
# Use Supabase `pg_cron` → Edge Functions (e.g. `ingestion-cycle`, `ll2-incremental`) or trigger jobs from the admin UI.
set -euo pipefail

echo "Deprecated: local ingestion cycle script removed. Use Supabase cron/Edge Functions instead."
exit 1
