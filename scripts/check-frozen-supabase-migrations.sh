#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

strict=0
if [[ "${1:-}" == "--strict" ]]; then
  strict=1
fi

frozen_files=(
  "supabase/migrations/20260405120000_ws45_quality_and_admin_monitoring.sql"
  "supabase/migrations/20260405121500_ws45_quality_and_admin_monitoring_backfill_helpers.sql"
  "supabase/migrations/20260408143000_ws45_live_board_and_planning.sql"
  "supabase/migrations/20260408190000_ws45_low_io_retention.sql"
  "supabase/migrations/20260408224500_spacex_drone_ship_48h_low_io_retune.sql"
  "supabase/migrations/20260409100500_ws45_backfill_helper_selection_fix.sql"
)

echo "Frozen production-applied Supabase migrations:"
printf '  %s\n' "${frozen_files[@]}"
echo

status_output="$(git status --short -- "${frozen_files[@]}" || true)"

if [[ -z "$status_output" ]]; then
  echo "No local edits detected in the frozen migration set."
  exit 0
fi

echo "Detected local edits in frozen migrations:"
printf '%s\n' "$status_output"
echo
echo "Guidance:"
echo "  - Do not keep editing these historical files."
echo "  - Use a new additive migration for behavior changes."
echo "  - If cleanup is needed, handle it in a dedicated migration-hygiene change."

if [[ "$strict" -eq 1 ]]; then
  exit 1
fi
