# T-Minus Zero — Internal PRD (v1.0)

## 0) Goal & DoD
- Goal: Mobile-first, dark-space launch schedule that answers "When?/Watch?/Status?" in ~2 seconds.
- DoD v1.0:
  - Anon viewers: Public cache (15m) feed, watch link. Skeletons, no CLS.
  - Paid: Live feed freshness, native mobile push alerts, saved filters, quiet hours, change alerts.
  - Admin: Manage overrides, system settings, view logs/outbox, manual sync triggers.
  - Legal: Terms, Privacy, Data/Attribution pages live.

## 1) Product Model
- Anon tier: Public cache feed, basic filters, watch link, no notifications.
- Paid tier (subscription): Live feed, notifications, saved filters, "recently changed", quiet hours.

## 2) UX / UI
- Dark/space theme using CSS variables (see `app/globals.css`). Stable-height LaunchCard with countdown when precision >= hour.
- Skeletons only (no spinners). Scrubbed/Hold = grayscale + danger border + shake.
- Timezone clarity: show `Your Time` by default with toggle to `Site Time` (pad tz). Date-only → `NET MMM DD` + `Time TBD`.
- Native alerts: launch notifications are managed through the iOS and Android apps with device-level push registration.

## 3) Data & Sources
- Launch Library 2 (LL2) primary. Enforce plan rate limits via DB counter.
- Runtime site now renders from Supabase public cache only (detail pages included); LL2 is touched only by ingestion to stay within configured limits.

## 4) Architecture
- Next.js (App Router, SSR), Tailwind + CSS variables, TypeScript.
- Supabase: Postgres + Auth + RLS; scheduled jobs via Supabase/Edge cron.
- Stripe for subscriptions + billing portal; essential service email outside launch alerts; native mobile push for launch notifications.
- API separation: `/api/public/*` (cache) vs `/api/live/*` (paid only). Logout drops live access immediately.

## 5) Database (Supabase)
- Schema in `supabase/migrations/*` covering profiles, subscriptions, system_settings, rate counters, launches, public cache, notifications, logs.
- RLS helpers: `is_admin()`, `is_paid_user()`. Policies: public cache readable by all; live tables paid/admin only; user-owned tables restricted; admin-only system settings.
- Required `system_settings` keys seeded per spec (LL2 limits, cache intervals, and current job/runtime toggles).
- Change tracking: `supabase/migrations/0003_launch_updates_trigger.sql` logs meaningful `launches` updates into `launch_updates` for the “Recently changed” feed.
- Atomic rate limiting: `supabase/migrations/0005_rate_limit_atomic.sql` adds `try_increment_api_rate()` used by ingestion to prevent LL2 429s even under concurrency.

## 6) API Surface (Next.js Route Handlers)
- Public: `GET /api/public/launches`, `GET /api/public/launches/changed`.
- Paid: `GET /api/live/launches` (returns `live_activity` payload for future Live Activities), native mobile notification endpoints.
- Billing: `/api/billing/checkout`, `/api/billing/portal`, `/api/webhooks/stripe`.
- Notification-preference routes are limited to the current native mobile push flows.
- Routes support mock fallback when Supabase/Stripe env vars are not configured; otherwise they read/write real Supabase tables (Stripe remains placeholder-safe until keys are provided).
- Calendar ICS: `GET /api/launches/{id}/ics` returns a standards-compliant `.ics` (UTC timestamps; all-day when time is TBD).

## 7) Jobs (scheduled)
1. Supabase Edge `ll2-incremental` (~every 15 seconds): LL2 incremental CDC.
2. Supabase Edge `ingestion-cycle` (every 15 minutes): LL2 event CDC + SNAPI ingest + public cache refresh.
3. Supabase Edge `monitoring-check` (every 5 minutes): populates `ops_alerts` for admin monitoring.
4. Supabase Edge `notifications-dispatch` (every 2 minutes) + `notifications-send` (every minute): queue and deliver native mobile push alerts while retiring legacy channel rows in place.

## 9) Notifications & Safeguards
- Channels: Native mobile push only for launch alerts.
- Events: T-60, T-10, liftoff/window start, status change, NET change ≥ X, scrub special.
- Launch alerts no longer expose retired non-push user flows.

## 10) Phases & Status
- [x] Phase 0 – Foundations: Next.js scaffold, dark theme, LaunchCard + skeletons, legal pages, FAQ, iOS prompt stub.
- [x] Phase 1 – Data plumbing: Supabase migrations + settings seeds, LL2 ingestion with atomic rate limiting, public cache derivation (includes pad short code + timezone). Public cache now carries mission/rocket/provider metadata so detail pages avoid live LL2 calls.
- [~] Phase 2 – Entitlements & Notifications: Supabase Auth UI, Stripe checkout + portal endpoints, Stripe webhook → `subscriptions`, live API gating, and native mobile push alert management. Remaining: entitlement wiring polish and verification hardening.
- [~] Phase 3 – Admin & Ops: Admin UI now reads and edits system_settings, shows ingestion/outbox stats, and displays `ops_alerts`. Supabase pg_cron now drives ingestion + monitoring Edge Functions. Remaining: log detail pages, manual sync wiring to actual jobs, image credit controls.
- [ ] Phase 4 – QA & Launch: Load tests vs LL2 rate limits, CLS/LCP audit, legal review.

## 11) Open Items / Variables
See `docs/questions.md` for current unknowns and owner decisions needed.
