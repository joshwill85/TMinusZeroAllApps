# Supabase Migrations Policy

`supabase/migrations/` is the active migration history for this repo.

Rules:

- Keep applied migrations here. Do not move old files into an archive folder during normal work.
- Treat applied migrations as append-only history. Do not edit, rename, reorder, or delete them.
- If the database behavior needs to change, add a new migration instead of rewriting an old one.
- Use `npm run db:schema:snapshot` to refresh the checked-in schema reference under `supabase/schemas/`.
- If the team ever wants to replace the active history with a baseline migration, do that only as a dedicated migration-rewrite project with explicit `supabase db reset` and diff validation.

Why:

- `supabase db reset` and related CLI workflows rebuild from this folder.
- Moving historical files out of the active path changes local reset behavior and can silently break parity.
- The archive for day-to-day readability is the schema snapshot history in `supabase/schemas/archive/`, not a relocated active migration chain.
