# Supabase Schema Snapshots

These files are checked-in schema snapshots for inspection and diffing.

- `supabase/migrations/` remains the active migration chain used by `supabase db reset`, `supabase db push`, and migration history tracking.
- `supabase/schemas/current_public_schema.sql` is the latest checked-in snapshot of the linked remote `public` schema.
- `supabase/schemas/archive/*.sql` stores dated snapshot copies so schema history can be reviewed without touching the active migration path.
- Pending local migrations are not reflected in the snapshot until they are applied to the linked database.

Refresh the snapshot with:

```bash
scripts/export-supabase-public-schema.sh --archive
```

This intentionally does not move or rename active files under `supabase/migrations/`. Doing that would change the local reset/diff path and should only happen in a dedicated baseline rewrite with explicit validation.
