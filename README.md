# T-Minus Zero

Mobile-first, dark-space launch schedule with LL2, free/public cache vs paid live feed, and notifications.

## Quickstart
1. Configure Supabase + Stripe + provider keys in your deployment environment (no local `.env` files).
2. Ensure the pinned toolchain is installed: Node **24.14.1** + npm **11.11.0** (recommended: Volta; fallback: `nvm use`).
3. Install deps (deterministic): `npm ci` (installs will fail if your Node/npm versions don’t match).
4. Run dev server: `npm run dev` (Next.js App Router) or `docker compose up web --build` (runs Next in Docker with the pinned Node image). For bind-mount live reload: `docker compose --profile dev up web-dev --build` (requires Docker Desktop file access to this folder on macOS).
5. Supabase/Postgres: apply migrations in order (e.g. `psql -h localhost -p 54321 -U postgres -f supabase/migrations/0001_init.sql` then `psql -h localhost -p 54321 -U postgres -f supabase/migrations/0002_add_launch_pad_coords.sql`). Configure RLS + functions.
6. Email: configure Supabase Auth email provider (Resend integration + templates in `supabase/templates/auth/`) for signup confirmation + password reset, and allow auth redirects to `/auth/callback` and `/auth/reset-password`. App emails (billing events) use `RESEND_API_KEY` + `BILLING_EMAIL_NOTIFICATIONS_ENABLED=true` + `BILLING_EMAIL_FROM`.

## Development environment
- **Toolchain (pinned)**: Node **24.14.1** + npm **11.11.0**. Use Volta (recommended) or `.nvmrc` via `nvm use`.
- **Vercel**: Vercel allows selecting supported Node **majors**. As of 2026-02-27, the available majors are `24.x` (default), `22.x`, and `20.x`, while local/CI/Docker stay on the exact repo pins.
- **Doctor**: Run `npm run doctor` to verify your toolchain and repo pins match.
- **First-run expectations**: Lint and type-check commands may take 3-5 minutes on first run (macOS file system scanning overhead). Subsequent runs with caching should complete in 1-2 minutes.
- **Type-check**: Run `npm run type-check` to check TypeScript without emitting files.
- **Linting**: Run `npm run lint` to check code style (uses ESLint cache for faster repeats).

## Data jobs (server-side)
- Supabase Edge `ll2-incremental` (scheduled via `pg_cron`) handles high-frequency LL2 incremental CDC.
- Supabase Edge `ingestion-cycle` (scheduled via `pg_cron`) handles LL2 event CDC, SNAPI ingest, and public cache refresh.
- Supabase Edge `nws-refresh` (scheduled via `pg_cron`) ingests NWS forecasts for launches within 14 days, writes `launch_weather`, and updates `launches.weather_icon_url` for card icons.
- Supabase Edge `celestrak-gp-ingest` (scheduled via `pg_cron`) ingests CelesTrak GP groups into `orbit_elements` + `satellite_group_memberships`.
- Supabase Edge `celestrak-satcat-ingest` (scheduled via `pg_cron`) ingests SATCAT metadata into `satellites`.
- Supabase Edge `celestrak-intdes-ingest` (scheduled via `pg_cron`) backfills/refreshes SATCAT metadata by INTDES (COSPAR launch designator) into `satellites`.
- Supabase Edge `celestrak-gp-groups-sync` (scheduled via `pg_cron`) refreshes the canonical GP/SATCAT group list (to keep “all groups” current).
- Supabase Edge `celestrak-retention-cleanup` (scheduled via `pg_cron`) prunes old `orbit_elements` rows (see `system_settings.celestrak_orbit_elements_retention_days`).
- Supabase Edge `spacex-x-post-snapshot` (scheduled via `pg_cron`) snapshots the latest @SpaceX X post for launch-day embeds.
- LL2 API usage: set `LL2_API_KEY` (premium token) and optionally `LL2_USER_AGENT` (app + contact string).
- NWS API usage: set `NWS_USER_AGENT` to an app + contact string (e.g. `TMinusZero/0.1 (support@tminuszero.app)`).
- CelesTrak usage: optionally set `CELESTRAK_USER_AGENT` to an app + contact string.
- Supabase Edge `monitoring-check` watches ingestion runs and writes `ops_alerts` for the admin UI.
- Enable/disable scheduled jobs via `system_settings` (`jobs_enabled`, `jobs_base_url`, `jobs_apikey`, `jobs_auth_token`).
- Production should rely on the Edge functions; local one-off ingestion/backfill scripts were removed to avoid drift. Remaining local audits focus on ingestion and trajectory coverage only.

## Backfills (server-side)
- Global LL2 ingestion is controlled by `system_settings.ll2_location_filter_mode` (`us` or `all`).
- Full history backfill is handled by the `ll2-backfill` Edge job (progress keys: `ll2_backfill_*`).
- Rocket media backfill (images/wiki/info) is handled by the `rocket-media-backfill` Edge job (toggle with `rocket_media_backfill_job_enabled`).
- Backfill and ingest should be performed via the scheduled Edge jobs (or manually triggered Edge jobs from the admin UI).

## Structure
- `apps/web/app/` Next.js app router pages, API route handlers, legal/docs, admin stub.
- `apps/web/components/` UI building blocks (LaunchCard, skeletons, IOSInstallPrompt, etc.).
- `apps/web/lib/` Types, mock data, API helpers (Supabase/Stripe placeholders), time utilities, LL2/SNAPI ingestion helpers, ICS generator.
- `apps/mobile/` Expo Router shell for native iOS/Android work.
- `packages/` shared domain/contracts/client/query/navigation/design-token packages.
- `supabase/migrations/` Database schema + policies + seed settings.
- `docs/PRD.md` Internal PRD + phases; `docs/questions.md` open questions.
- `docs/three-platform-overhaul-plan.md` Living checklist for the web + iOS + Android architecture overhaul.

## What works now
- Styled Launch feed with skeletons, scrub visuals, and a header calendar overlay.
- iOS Add-to-Home-Screen prompt logic (once per 7 days).
- Legal pages (Terms, Privacy, Data/Attribution), FAQ, upgrade stub, admin stub panels.
- Launch detail pages render from Supabase public cache fields (no live LL2 calls) once ingestion + cache refresh are run; mock data still backs local dev without Supabase envs.
- API route stubs returning mock data for public/live feeds, billing, and notifications.

## Next steps (implementation)
- Connect production providers:
  - Native mobile push: Expo/device registration plus the push-only alert management flows
  - Essential email only where still required outside launch notifications
- Run ingestion + notifications as hosted jobs (Supabase cron/Edge Functions or external worker).
- Stripe: wire real products/prices/webhooks and confirm entitlement behavior end-to-end.
