#!/bin/bash

# Supabase Helper Functions
# Source this file in your terminal: source scripts/supabase-helpers.sh

# Load environment variables
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

resolve_project_ref() {
  if [ -n "$SUPABASE_PROJECT_ID" ]; then
    echo "$SUPABASE_PROJECT_ID"
    return 0
  fi

  if [ -n "$NEXT_PUBLIC_SUPABASE_URL" ]; then
    local host
    local ref
    host="${NEXT_PUBLIC_SUPABASE_URL#https://}"
    host="${host#http://}"
    host="${host%%/*}"
    ref="${host%%.supabase.co}"
    if [ -n "$ref" ] && [ "$ref" != "$host" ]; then
      echo "$ref"
      return 0
    fi
  fi

  return 1
}

# Connect to remote database
db-connect() {
  echo "Connecting to Supabase database..."
  PGPASSWORD=$SUPABASE_DB_PASSWORD psql \
    -h db.$SUPABASE_PROJECT_ID.supabase.co \
    -U postgres \
    -d postgres
}

# Generate TypeScript types from database schema
db-types() {
  echo "Generating TypeScript types from database schema..."
  supabase gen types typescript --linked > lib/database.types.ts
  echo "✓ Types generated at lib/database.types.ts"
}

# Push migrations to remote database
db-migrate() {
  echo "Pushing migrations to remote database..."
  supabase db push
  echo "✓ Migrations applied successfully"
}

# Pull latest schema from remote database
db-pull() {
  echo "Pulling schema from remote database..."
  supabase db pull
  echo "✓ Schema pulled from remote"
}

# Run a SQL query
db-query() {
  if [ -z "$1" ]; then
    echo "Usage: db-query 'SELECT * FROM table_name;'"
    return 1
  fi
  PGPASSWORD=$SUPABASE_DB_PASSWORD psql \
    -h db.$SUPABASE_PROJECT_ID.supabase.co \
    -U postgres \
    -d postgres \
    -c "$1"
}

# Show database status
db-status() {
  local project_ref
  project_ref="$(resolve_project_ref || true)"
  if [ -n "$project_ref" ]; then
    echo "Project: $project_ref"
    echo "URL: https://$project_ref.supabase.co"
  else
    echo "Project: (not set)"
  fi
  echo ""
  supabase status 2>/dev/null || echo "Local containers not running. Use 'supabase start' to start them."
}

# Create a new migration
db-new-migration() {
  if [ -z "$1" ]; then
    echo "Usage: db-new-migration migration_name"
    return 1
  fi
  supabase migration new "$1"
  echo "✓ Migration created in supabase/migrations/"
}

# Reset local database
db-reset() {
  echo "Resetting local database..."
  supabase db reset
  echo "✓ Local database reset complete"
}

# Start local Supabase
db-start() {
  echo "Starting local Supabase..."
  supabase start
}

# Stop local Supabase
db-stop() {
  echo "Stopping local Supabase..."
  supabase stop
}

# Display help
db-help() {
  echo "Supabase Helper Commands:"
  echo ""
  echo "  db-connect          - Connect to remote database via psql"
  echo "  db-types            - Generate TypeScript types from schema"
  echo "  db-migrate          - Push migrations to remote database"
  echo "  db-pull             - Pull schema from remote database"
  echo "  db-query 'SQL'      - Run a SQL query"
  echo "  db-status           - Show database status"
  echo "  db-new-migration    - Create a new migration file"
  echo "  db-reset            - Reset local database"
  echo "  db-start            - Start local Supabase containers"
  echo "  db-stop             - Stop local Supabase containers"
  echo "  fn-list             - List deployed Edge Functions"
  echo "  fn-deploy NAME      - Deploy a single Edge Function (API deploy)"
  echo "  fn-deploy-all       - Deploy all local Edge Functions (API deploy)"
  echo "  fn-deploy-artemis   - Deploy all Artemis Edge Functions"
  echo "  db-help             - Show this help message"
  echo ""
}

# List deployed Edge Functions
fn-list() {
  local project_ref
  project_ref="$(resolve_project_ref || true)"
  if [ -z "$project_ref" ]; then
    echo "Could not resolve project ref (set SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL)."
    return 1
  fi
  supabase functions list --project-ref "$project_ref"
}

# Deploy a single Edge Function
fn-deploy() {
  if [ -z "$1" ]; then
    echo "Usage: fn-deploy function-name"
    return 1
  fi
  local project_ref
  project_ref="$(resolve_project_ref || true)"
  if [ -z "$project_ref" ]; then
    echo "Could not resolve project ref (set SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL)."
    return 1
  fi
  supabase functions deploy "$1" --project-ref "$project_ref" --use-api --yes
}

# Deploy all local Edge Functions (excluding _shared)
fn-deploy-all() {
  local project_ref
  project_ref="$(resolve_project_ref || true)"
  if [ -z "$project_ref" ]; then
    echo "Could not resolve project ref (set SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL)."
    return 1
  fi
  if [ ! -d "supabase/functions" ]; then
    echo "No supabase/functions directory found"
    return 1
  fi

  local deployed_any=0
  for dir in supabase/functions/*/; do
    if [ ! -d "$dir" ]; then
      continue
    fi
    local name
    name="$(basename "$dir")"
    if [ "$name" = "_shared" ]; then
      continue
    fi
    deployed_any=1
    echo ""
    echo "Deploying: $name"
    supabase functions deploy "$name" --project-ref "$project_ref" --use-api --yes
  done

  if [ "$deployed_any" -eq 0 ]; then
    echo "No functions found under supabase/functions/"
    return 1
  fi
}

# Deploy Artemis Edge Functions only
fn-deploy-artemis() {
  local project_ref
  project_ref="$(resolve_project_ref || true)"
  if [ -z "$project_ref" ]; then
    echo "Could not resolve project ref (set SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL)."
    return 1
  fi

  local functions=(
    artemis-bootstrap
    artemis-nasa-ingest
    artemis-oversight-ingest
    artemis-budget-ingest
    artemis-procurement-ingest
    artemis-contracts-ingest
    artemis-content-ingest
    artemis-snapshot-build
  )

  for name in "${functions[@]}"; do
    echo ""
    echo "Deploying: $name"
    supabase functions deploy "$name" --project-ref "$project_ref" --use-api --yes
  done
}

# Deploy Blue Origin Edge Functions only
fn-deploy-blue-origin() {
  local project_ref
  project_ref="$(resolve_project_ref || true)"
  if [ -z "$project_ref" ]; then
    echo "Could not resolve project ref (set SUPABASE_PROJECT_ID or NEXT_PUBLIC_SUPABASE_URL)."
    return 1
  fi

  local functions=(
    blue-origin-bootstrap
    blue-origin-vehicles-ingest
    blue-origin-engines-ingest
    blue-origin-missions-ingest
    blue-origin-news-ingest
    blue-origin-media-ingest
    blue-origin-passengers-ingest
    blue-origin-payloads-ingest
    blue-origin-contracts-ingest
    blue-origin-social-ingest
    blue-origin-snapshot-build
  )

  for name in "${functions[@]}"; do
    echo ""
    echo "Deploying: $name"
    supabase functions deploy "$name" --project-ref "$project_ref" --use-api --yes
  done
}

# Show available commands
echo "Supabase helper functions loaded! Type 'db-help' for available commands."
