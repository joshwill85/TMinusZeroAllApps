# Premium Phases 1–4 Implementation Plan

Last updated: 2026-01-25

This document is the tracking plan for Premium roadmap Phases 1–4.

## Decisions (locked)

- **Presets are Premium-only.** Free users get **no** saved filter presets.
- **Calendar + RSS feeds should use “live” data for Premium.** In our architecture, “live” means reading from `public.launches` (the live table) rather than `public.launches_public_cache`.
- **Tokenized integrations use per-resource tokens.** Calendar/RSS use per-feed tokens; embeds use per-widget tokens (revocable independently). Legacy per-user tokens remain for backwards compatibility.

## Important clarifications

- “Live” feeds (calendar/RSS/embed) must still be **cacheable and rate-limited**. Calendar/RSS clients often poll aggressively and do not reliably respect caching. Treat these endpoints as **internet-facing** even though they are tokenized.
- Tokenized endpoints cannot rely on browser auth cookies. They must authenticate via **bearer tokens** (UUIDs in the URL) and enforce entitlements server-side.
- Because `public.launches` is Premium-gated via RLS, token endpoints that read live data must either:
  - Use the **Supabase service role** (admin client) to query live tables, and strictly clamp/filter response fields, or
  - Use a **security-definer SQL function** that validates the token and returns a safe, bounded result set.

## Global dependencies (before Phase 1)

Use `docs/premium-production-checklist.md` as the operational checklist for these items (envs + Stripe webhook + job runner).

- [x] Supabase configured in production (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- [x] Supabase service role configured for server-side admin reads/writes (required for billing + some token endpoints).
- [x] Stripe configured (`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`/`PRICE_PRO_MONTHLY`, etc.).
- [x] Stripe webhook configured (`STRIPE_WEBHOOK_SECRET`) and Stripe dashboard webhook includes required events.
- [x] Decide job runner for scheduled dispatchers (Supabase cron/Edge Functions vs external worker).
  - Using Supabase `pg_cron` + Edge Functions (verified via `npm run check:prod` + `npm run check:stripe-webhook`, 2026-01-25).

---

## A) Entitlements: source of truth and reliability review

### Current source of truth (code + schema)

- **DB truth:** `public.subscriptions.status` and `public.profiles.role`.
  - “Paid” is effectively: `subscriptions.status in ('active','trialing')` OR `profiles.role='admin'`.
  - This is used consistently across:
    - `lib/server/subscription.ts` (`isSubscriptionActive`).
    - `lib/server/viewerTier.ts` (`getViewerTier`).
    - DB helper function `public.is_paid_user()` (defined in `supabase/migrations/0001_init.sql`).
- **Stripe → DB write path:** `app/api/webhooks/stripe/route.ts`
  - Handles:
    - `checkout.session.completed`
    - `customer.subscription.created`
    - `customer.subscription.updated`
    - `customer.subscription.deleted`
  - Writes:
    - `stripe_customers` mapping (`user_id` ↔ `stripe_customer_id`)
    - `subscriptions` row keyed by `user_id`
  - Uses upsert patterns, so repeated webhook deliveries are mostly safe.

### Reliability characteristics (what’s good)

- **Out-of-order webhooks:** If subscription events arrive before `checkout.session.completed`, the code will no-op because it can’t map customer→user yet; later, `checkout.session.completed` runs a Stripe retrieve and upserts the subscription row. This provides eventual consistency.
- **Self-serve cancel/resume paths:** `app/api/billing/cancel/route.ts` and `app/api/billing/resume/route.ts` also upsert `subscriptions` directly after calling Stripe, so entitlements update promptly even if webhooks are delayed.
- **Webhook secret rotation:** `STRIPE_WEBHOOK_SECRET` supports comma-separated secrets (useful for rotation).
- **Webhook failures are recorded:** Inserts to `public.webhook_events` on both success and failure.

### Known risks (what can break “reliable in prod”)

1) **Webhook delivery outages or config drift**
   - If Stripe webhooks are disabled/misconfigured (wrong URL, missing events), the DB can drift.
   - We have scheduled + on-demand reconciliation to “heal” entitlements drift (see below).

2) **Missing `stripe_customers` mapping**
   - Subscription events rely on `stripe_customers` mapping. If a subscription is created in Stripe without going through our Checkout flow (e.g., created manually in the Stripe dashboard, or imported customer), it may not map and therefore won’t populate `subscriptions`.

3) **Duplicate/poison webhook event storage**
   - We store `payload_hash`, not Stripe `event.id`. If Stripe retries with identical payload it creates multiple rows. This isn’t correctness-breaking, but it can bloat logs and makes dedupe harder.

### Hardening plan (recommended)

- [x] **Add webhook idempotency keying on Stripe event id**
  - Schema: add `event_id text` to `public.webhook_events` with unique constraint `(source, event_id)`.
  - Write path: store `event.id` and ignore duplicates.

- [x] **Add entitlement reconciliation job**
  - Implemented:
    1) Scheduled reconciliation via Supabase cron → Edge Function (`billing-reconcile`).
    2) On-demand reconciliation in `/api/me/subscription` (throttled) to repair drift quickly.
  - Output: `ops_alerts` rows if reconciliation hits Stripe errors.

- [x] **Add monitoring / alert hooks**
  - Admin dashboard counters:
    - webhook failures in the last 24h
    - last successful webhook timestamp
    - paid user counts (active + trialing) and subscription breakdown (DB)

---

## B) Tokenized endpoints: rate limits, caching, and abuse controls

### Current state

- Tokenized endpoints exist today:
  - Legacy per-user token validation (still supported for backwards compatibility):
    - Calendar: `public.validate_calendar_token(token_in uuid)` → `public.profiles.calendar_token`
    - Embed: `public.validate_embed_token(token_in uuid)` → `public.profiles.embed_token`
  - Per-resource token tables (revocable per link):
    - `public.calendar_feeds` (per-feed tokens) → `GET /api/calendar/[token].ics`
    - `public.rss_feeds` (per-feed tokens) → `GET /rss/[token].xml`
    - `public.embed_widgets` (per-widget tokens) → `GET /embed/next-launch?token=...`
  - Token management APIs (Premium):
    - `/api/me/calendar-feeds` (+ rotate)
    - `/api/me/rss-feeds` (+ rotate)
    - `/api/me/embed-widgets` (+ rotate/revoke)
    - Legacy (backwards compat): `/api/me/calendar-token`, `/api/me/embed-token`
- Rate limiting today (production-only):
  - `middleware.ts` rate-limits:
    - `/api/public/*`
    - `/api/search/*`
    - `/api/launches/*/ics` (includes `/api/launches/ics` and `/api/launches/[id]/ics`)
    - `/api/calendar/*` (planned Phase 2 calendar feeds)
    - `/rss/*` (planned Phase 4 RSS feeds)
    - `/embed/*` (tokenized embeds)
  - Limitation: in-memory Map is best-effort across instances/regions.
- Caching today:
  - `/api/launches/ics` returns `Cache-Control: private, max-age=300` (not CDN-cacheable).
  - Token endpoints return `Cache-Control: public, s-maxage=15, stale-while-revalidate=60` (plus `ETag` for RSS/ICS).

### Key risks once we make Premium calendar/RSS “live”

- **High-frequency polling** (calendar readers, RSS aggregators) → DB load and cost.
- **Token leakage** → private feeds become publicly accessible.
- **Scraping/exfiltration** if token endpoints accept arbitrary filters/limits.

### Abuse-control standards we should adopt

1) **Per-feed tokens (not a single user token)**
   - Each calendar/RSS feed gets its own token.
   - Benefits:
     - You can rotate/revoke one feed without breaking others.
     - Sharing one feed doesn’t implicitly share all feeds.

2) **Stored feed definitions; no arbitrary query filters**
   - Token endpoints should read configuration from DB (preset/watchlist/adhoc stored server-side).
   - The request URL should not accept `range=...&provider=...&limit=...` beyond trivial format flags.

3) **Explicit caching headers for token endpoints**
   - For token endpoints, CDN caching is safe because the URL contains a secret token.
   - Recommended headers:
     - Calendar/RSS: `Cache-Control: public, s-maxage=15, stale-while-revalidate=60` (or s-maxage=30 if we want fewer DB hits).
   - Do not use `private` for these endpoints if we expect edge caching to protect the DB.
   - Optional but recommended:
     - Add `ETag` / `If-None-Match` support for RSS/ICS responses keyed by a “feed version” (e.g., latest `launch_updates.id` + match count) so well-behaved clients can 304.

4) **Rate limiting**
   - Add middleware rules for:
     - `/rss/*`
     - `/api/calendar/*` (or whatever final path is)
     - `/embed/*` (tokenized embeds)
   - Prefer rate limit keys that include:
     - IP (baseline)
     - token hash (extra protection against shared IP clients)

5) **Hard caps in queries**
   - Enforce maximum rows and time windows:
     - calendar: max 500–1000 items
     - rss: max 50–200 items
   - Clamp by server-side defaults regardless of request params.
   - Never allow clients to override:
     - `hidden=false` filter for live launches
     - maximum time horizon / lookback
     - maximum item count

6) **Optional: “kill switch”**
   - `system_settings` flags:
     - `token_feeds_enabled` (boolean)
     - `token_feeds_max_rpm` (int)
     - `token_feeds_cache_s_maxage_seconds` (int)

---

## Token strategy: “single RSS token” vs “per-feed token”

### What it means

- **Single user RSS token**
  - One token per user, used for all RSS URLs.
  - Example shape: `/rss/<userToken>.xml?feed=preset&id=<presetId>`
  - Pros: simpler schema, fewer tokens to manage.
  - Cons: token leak exposes *everything*; harder to revoke a single feed; encourages query-param driven feeds (harder to abuse-protect).

- **Per-feed RSS token (recommended / industry standard when multiple feeds exist)**
  - Each feed has its own token.
  - Example shape: `/rss/<feedToken>.xml` where the token maps to one stored feed definition.
  - Pros: revocable, shareable-by-design, smallest blast radius, easiest caching/rate-limiting.
  - Cons: extra table + UI.

**Recommendation:** Because we want multiple named feeds (calendar + RSS) and user-controlled integration links, use **per-feed tokens**.

---

# Phase 1 — Presets (Premium-only) + Watchlists + “My Launches”

## Goal

Premium immediately feels “personal” and faster to use: saved views and a dedicated “My Launches” feed.

## Scope / deliverables

- [x] Saved filter presets (Premium-only): create, rename, set default, delete.
- [x] Watchlists (“My Launches”):
  - [x] Star/unstar launches (launch rules).
  - [x] “My Launches” feed toggle on home feed.
  - [x] Follow provider / pad (rules) from launch cards + launch detail.
  - [x] Manage rules centrally in `/account/saved`.
- [x] Server endpoints for presets + watchlists + my-launches feed.

## Dependencies

- Entitlements must be reliable (`/api/me/subscription`, `getViewerTier()`).
- Decide watchlist pad identity:
  - `pad_short_code` vs `ll2_pad_id` (recommend `ll2_pad_id` where available, else fallback).

## Backend work

- [x] Add DB migration: `launch_filter_presets` table + RLS.
- [x] Reintroduce watchlists tables + RLS (was removed in `0050_remove_watchlists.sql`).
- [x] API routes:
  - [x] `/api/me/filter-presets` (GET/POST)
  - [x] `/api/me/filter-presets/[id]` (PATCH/DELETE)
  - [x] `/api/me/watchlists` (GET/POST)
  - [x] `/api/me/watchlists/[id]` (PATCH/DELETE)
  - [x] `/api/me/watchlists/[id]/rules` (POST)
  - [x] `/api/me/watchlists/[id]/rules/[ruleId]` (DELETE)
  - [x] `/api/me/watchlists/[id]/launches` (GET) (Premium-only “My Launches” feed)
- [x] Premium gating:
  - Preset endpoints return **402** for non-premium.
  - Watchlists are **Premium-only** (currently implemented).

## Frontend work

- [x] `LaunchFeed`:
  - [x] Preset picker + “Save preset” (PremiumGateButton when locked).
  - [x] “My Launches” toggle (uses watchlist endpoint).
- [x] `LaunchCard` + launch detail:
  - [x] “Add to My Launches” (launch rule).
  - [x] “Follow provider” / “Follow pad” actions.
- [x] Account page:
  - [x] Simple management panel for presets + watchlist rules (link to `/account/saved`).

## Abuse / performance guardrails

- [x] Server clamps rule counts (max 200 rules per watchlist).
- [x] My Launches query uses indexed fields and avoids unbounded ORs.

## QA / acceptance

- [x] Presets persist and apply on reload.
- [x] My Launches returns expected items and doesn’t break normal feed.
- [x] Non-premium gets clear upsell + 402 behavior.

### Deferred (post-Phase 1)

- [x] Tier follow rules (stored as `rule_type='tier'`) wired into My Launches + watchlist-scoped embeds.

---

# Phase 2 — Calendar 2.0 (Live Premium feeds + reminders)

## Goal

Premium gets stable, named, “live” calendar subscriptions that can be managed/rotated, plus optional reminders via ICS alarms.

## Scope / deliverables

- [x] Multiple named calendar feeds (per-feed token).
- [x] Live data source for feeds (`public.launches`) with caching + rate limits.
- [x] Optional `VALARM` reminders for timed launches.

## Dependencies

- Phase 1 presets/watchlists (optional but recommended for “create feed from preset/watchlist”).
- Token abuse controls defined (middleware rules + caching headers).

## Backend work

- [x] DB migration: `calendar_feeds` table (token per feed) + RLS.
- [x] SQL: `validate_calendar_feed_token(token_in uuid)` (not needed; route uses service-role lookup + entitlement check).
- [x] API routes:
  - [x] `/api/me/calendar-feeds` (GET/POST)
  - [x] `/api/me/calendar-feeds/[id]` (PATCH/DELETE)
  - [x] `/api/me/calendar-feeds/[id]/rotate` (POST) (or include rotate in PATCH)
- [x] Public feed endpoint (token-based):
  - [x] `GET /api/calendar/[token].ics` (recommended path)
  - Enforce:
    - token validation
    - stored feed definition (no arbitrary query filters)
    - row caps + time window caps
    - `Cache-Control: public, s-maxage=15, stale-while-revalidate=60`

## Frontend work

- [x] Update `BulkCalendarExport` to support:
  - [x] Download now (adhoc)
  - [x] Create new live feed from current filters
  - [x] Subscribe + rotate token

## Abuse / performance guardrails

- [x] Middleware rate limiting for `/api/calendar/`.
- [x] Server-side caps (items and time horizon).
- [x] Add a “feed cache” layer for token feeds:
  - DB-backed per-feed caches (calendar + RSS/Atom) with short TTL to reduce live DB polling load.

## QA / acceptance

- [x] Calendar clients can subscribe without browser session.
- [x] Feed stops working if subscription lapses (token validation enforces premium).
- [x] ICS validates/imports and reminders don’t break clients.
  - Recommend verifying at least once in Apple Calendar + Google Calendar in production.

---

# Phase 3 — Premium Web Push + change alerts

## Goal

Premium users get push notifications (low marginal cost) with quiet hours and change-alert coverage.

## Scope / deliverables

- [x] Push device subscription UX + storage (`/api/me/notifications/push/subscribe`).
- [x] Push send pipeline using `notifications_outbox`.
- [x] Change alerts (status/NET changes) scoped to watchlist/preset.

## Dependencies

- VAPID keys and HTTPS in production.
- Job runner for dispatch + send (Supabase cron/Edge Functions or external worker).
- Phase 1 watchlists for scoping (recommended).

## Backend work

- [x] Add unsubscribe endpoint for push subscriptions.
- [x] Extend per-launch notification prefs endpoint to support `channel='push'`.
- [x] Implement jobs:
  - [x] `notifications-dispatch` (enqueue push outbox rows)
  - [x] `notifications-send` (deliver push, mark outbox sent/failed, prune 410/404 endpoints)
- [x] Quiet hours enforcement for push (suppress during quiet hours).

## Frontend work

- [x] Preferences UI:
  - [x] Request permission + register service worker
  - [x] Subscribe this device
  - [x] “Send test notification”
- [x] LaunchCard alerts UI:
  - [x] Add push channel (Premium)
  - [x] Clear errors when not subscribed/permission denied

## Abuse / performance guardrails

- [x] Caps for push sends (even if cheap, prevent spam and user complaints).
- [x] Deduping strategy for change alerts (avoid repeated alerts for same update).

## QA / acceptance

- [x] Reliable push delivery and clean handling of expired endpoints.
- [x] Subscription lapse stops dispatch.
- [x] Quiet hours behavior matches UI copy.
  - Recommend verifying at least once on iOS Safari + Android Chrome in production.

---

# Phase 4 — Integrations Pack (RSS/Atom + embed builder upgrades)

## Goal

Make Premium “worth it” for power users and creators: private RSS feeds and richer embeddable widgets.

## Scope / deliverables

- [x] RSS feeds (per-feed tokens) backed by live data (`public.launches`) with strict caching + rate limiting.
- [x] Embed builder that can target a preset/watchlist (per-widget tokens).
- [x] Token rotation and revocation.

## Dependencies

- Phase 1 presets/watchlists (to power targeted RSS and embeds).
- Token abuse controls (middleware rules + caching headers).

## Backend work

- [x] DB migration: `rss_feeds` table (mirrors calendar feed structure).
- [x] SQL: `validate_rss_feed_token(token_in uuid)` (not needed; route uses service-role lookup + entitlement check).
- [x] Endpoints:
  - [x] `GET /rss/[token].xml` (token determines stored feed definition)
  - [x] `GET /rss/[token].atom`
  - [x] `Cache-Control: public, s-maxage=15, stale-while-revalidate=60`
  - [x] Hard caps on item count and lookback window

## Embed upgrades

- [x] Extend `/embed/next-launch` to support:
  - [x] preset-scoped embed
  - [x] watchlist-scoped embed
  - while still validating legacy embed tokens and keeping results constrained
- [x] Update embed UI to let the user choose scope and manage tokens.

## Abuse / performance guardrails

- [x] Middleware rate limiting for `/rss/` and `/embed/`.
- [x] Stored feed definitions only; no arbitrary filters from query params.

## QA / acceptance

- [x] RSS validates and works in common readers.
- [x] Token rotation works and invalidates old URLs.
