# Supabase CLI Guide

Complete guide for managing your Supabase project from the terminal without password prompts.

## Prerequisites

- Docker Desktop running
- Homebrew installed (macOS)
- Supabase CLI v2.67.1+ installed

## Installation

The Supabase CLI is already installed and configured for this project.

To update to the latest version:
```bash
brew upgrade supabase
```

## Project Setup (Already Completed)

Your project is already configured and linked to your Supabase instance:
- Project ID: `<project-ref>`
- Project URL: `https://<project-ref>.supabase.co`
- All credentials are stored in `.env.local` (git-ignored)

## Common Commands

### Project Management

#### Check project status
```bash
supabase status
```

#### View project settings
```bash
supabase projects list
```

#### Get API keys
```bash
supabase projects api-keys --project-ref <project-ref>
```

### Database Management

#### Connect to remote database
```bash
supabase db remote
```

#### Run SQL query
```bash
supabase db query "SELECT * FROM profiles LIMIT 10;"
```

#### Access PostgreSQL shell (psql)
```bash
supabase db remote --db-url "postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres"
```

Or use the environment variable:
```bash
export SUPABASE_DB_PASSWORD="<db-password>"
supabase db remote
```

#### Generate TypeScript types from database
```bash
supabase gen types typescript --linked > lib/database.types.ts
```

### Migration Management

#### Create a new migration
```bash
supabase migration new migration_name
```

#### Apply migrations to remote database
```bash
supabase db push
```

#### Pull schema from remote to create migration
```bash
supabase db pull
```

#### Reset local database (when running locally)
```bash
supabase db reset
```

#### View migration history
```bash
supabase migration list
```

### Local Development

#### Start local Supabase (Docker containers)
```bash
supabase start
```

#### Stop local Supabase
```bash
supabase stop
```

#### View local credentials
```bash
supabase status
```

### Functions Management

#### Create a new Edge Function
```bash
supabase functions new function-name
```

#### Deploy Edge Function
```bash
supabase functions deploy function-name
```

#### Deploy from this repo (recommended)
If you push migrations that schedule a new cron job, deploy the matching Edge Function (otherwise the scheduler will POST to a missing route and you'll see 404s).
```bash
source scripts/supabase-helpers.sh

fn-deploy function-name
# or deploy everything under supabase/functions (excluding _shared)
fn-deploy-all
```

#### View function logs
```bash
supabase functions logs function-name
```

### Storage Management

#### List storage buckets
```bash
supabase storage ls
```

#### Create a bucket
```bash
supabase storage create bucket-name --public
```

## Environment Variables

All credentials are stored in `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_PROJECT_ID=<project-ref>
SUPABASE_DB_PASSWORD=<db-password>
```

## Quick Reference Scripts

### Create a helper script for common tasks

Create `scripts/supabase-helpers.sh`:

```bash
#!/bin/bash

# Connect to remote database
db-connect() {
  source .env.local
  PGPASSWORD=$SUPABASE_DB_PASSWORD psql -h db.$SUPABASE_PROJECT_ID.supabase.co -U postgres -d postgres
}

# Generate types
db-types() {
  supabase gen types typescript --linked > lib/database.types.ts
  echo "Types generated at lib/database.types.ts"
}

# Push migrations
db-migrate() {
  supabase db push
  echo "Migrations applied successfully"
}

# Pull latest schema
db-pull() {
  supabase db pull
  echo "Schema pulled from remote"
}
```

Make it executable:
```bash
chmod +x scripts/supabase-helpers.sh
```

Source it in your terminal:
```bash
source scripts/supabase-helpers.sh
```

Then use:
```bash
db-connect      # Connect to database
db-types        # Generate TypeScript types
db-migrate      # Push migrations
db-pull         # Pull schema changes
```

## Direct Database Access

### Using psql directly

```bash
PGPASSWORD=<db-password> psql \
  -h db.<project-ref>.supabase.co \
  -U postgres \
  -d postgres
```

### Add to your shell profile for permanent access

Add to `~/.zshrc` or `~/.bashrc`:

```bash
# Supabase aliases
export SUPABASE_PROJECT_ID="<project-ref>"
export SUPABASE_DB_PASSWORD="<db-password>"

alias sb-db="PGPASSWORD=$SUPABASE_DB_PASSWORD psql -h db.$SUPABASE_PROJECT_ID.supabase.co -U postgres -d postgres"
alias sb-status="supabase status"
alias sb-push="supabase db push"
alias sb-pull="supabase db pull"
alias sb-types="supabase gen types typescript --linked > lib/database.types.ts"
```

After adding, reload your shell:
```bash
source ~/.zshrc  # or source ~/.bashrc
```

Then you can use short commands:
```bash
sb-db        # Connect to database
sb-status    # Check status
sb-push      # Push migrations
sb-pull      # Pull schema
sb-types     # Generate types
```

## Troubleshooting

### CLI not authenticated
```bash
supabase login
```

### Check Docker is running
```bash
docker ps
```

### View detailed error logs
```bash
supabase --debug [command]
```

### Reset local environment
```bash
supabase stop
supabase start
```

### Check CLI version
```bash
supabase --version
```

## Security Best Practices

1. Never commit `.env.local` to version control (already in `.gitignore`)
2. Use service role key only in server-side code
3. Rotate API keys if exposed
4. Use Row Level Security (RLS) policies on all tables
5. Keep CLI updated regularly

## Additional Resources

- [Official Supabase CLI Docs](https://supabase.com/docs/guides/cli)
- [Database Migrations](https://supabase.com/docs/guides/cli/local-development#database-migrations)
- [Edge Functions](https://supabase.com/docs/guides/functions)
- [CLI Reference](https://supabase.com/docs/reference/cli/introduction)

## Getting Help

```bash
supabase help
supabase [command] --help
```

## Project Structure

```
TMinusZero/
├── .env.local              # Local environment variables (git-ignored)
├── .env.example            # Template for environment variables
├── supabase/
│   ├── config.toml        # Supabase project configuration
│   ├── migrations/        # Database migration files
│   └── functions/         # Edge Functions (if any)
└── SUPABASE_CLI_GUIDE.md  # This guide
```
