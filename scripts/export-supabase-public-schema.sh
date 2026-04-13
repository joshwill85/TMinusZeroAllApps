#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Export the linked Supabase public schema into a checked-in snapshot.

Usage:
  scripts/export-supabase-public-schema.sh [--output PATH] [--archive] [--archive-path PATH]

Options:
  --output PATH       Write the current snapshot to PATH.
                      Default: supabase/schemas/current_public_schema.sql
  --archive           Also copy the current snapshot to a dated archive path.
                      Default: supabase/schemas/archive/YYYY-MM-DD_public_schema.sql
  --archive-path PATH Override the archive path.
  -h, --help          Show this help text.
EOF
}

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

output_path="supabase/schemas/current_public_schema.sql"
archive_requested=0
archive_path=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      output_path="${2:?missing value for --output}"
      shift 2
      ;;
    --archive)
      archive_requested=1
      shift
      ;;
    --archive-path)
      archive_requested=1
      archive_path="${2:?missing value for --archive-path}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -f .env.local ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi

: "${SUPABASE_PROJECT_ID:?SUPABASE_PROJECT_ID must be set in the environment or .env.local}"
: "${SUPABASE_DB_PASSWORD:?SUPABASE_DB_PASSWORD must be set in the environment or .env.local}"

resolve_pg_dump_bin() {
  local candidate version
  local candidates=()

  if [[ -n "${PG_DUMP_BIN:-}" ]]; then
    candidates+=("${PG_DUMP_BIN}")
  fi

  candidates+=(
    "/opt/homebrew/opt/postgresql@17/bin/pg_dump"
    "/usr/local/opt/postgresql@17/bin/pg_dump"
    "/usr/lib/postgresql/17/bin/pg_dump"
  )

  if command -v pg_dump >/dev/null 2>&1; then
    candidates+=("$(command -v pg_dump)")
  fi

  for candidate in "${candidates[@]}"; do
    if [[ -z "$candidate" || ! -x "$candidate" ]]; then
      continue
    fi

    version="$("$candidate" --version 2>/dev/null || true)"
    if [[ "$version" == *" 17."* ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

pg_dump_bin="$(resolve_pg_dump_bin || true)"
if [[ -z "$pg_dump_bin" ]]; then
  echo "Could not find a PostgreSQL 17 pg_dump binary. Set PG_DUMP_BIN to a Postgres 17 pg_dump path." >&2
  exit 1
fi

if [[ -z "$archive_path" ]]; then
  archive_path="supabase/schemas/archive/$(date +%F)_public_schema.sql"
fi

mkdir -p "$(dirname "$output_path")"
if [[ "$archive_requested" -eq 1 ]]; then
  mkdir -p "$(dirname "$archive_path")"
fi

tmp_base="$(mktemp /tmp/tminuszero-schema.XXXXXX)"
tmp_dump="${tmp_base}.dump.sql"
tmp_normalized="${tmp_base}.normalized.sql"
mv "$tmp_base" "$tmp_dump"
trap 'rm -f "$tmp_dump" "$tmp_normalized"' EXIT

PGPASSWORD="$SUPABASE_DB_PASSWORD" \
  "$pg_dump_bin" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  -h "db.${SUPABASE_PROJECT_ID}.supabase.co" \
  -U postgres \
  -d postgres \
  -f "$tmp_dump" >/dev/null

{
  echo "-- WARNING: This schema is for context only and is not meant to be run."
  echo "-- It is a checked-in snapshot of the linked Supabase public schema."
  echo "-- Pending local migrations are not included until they are applied to the linked database."
  echo "-- Refresh with: scripts/export-supabase-public-schema.sh --archive"
  echo
  sed '/^\\restrict /d;/^\\unrestrict /d' "$tmp_dump"
} > "$tmp_normalized"

mv "$tmp_normalized" "$output_path"

if [[ "$archive_requested" -eq 1 ]]; then
  cp "$output_path" "$archive_path"
fi

echo "Wrote schema snapshot: $output_path"
if [[ "$archive_requested" -eq 1 ]]; then
  echo "Archived schema snapshot: $archive_path"
fi
