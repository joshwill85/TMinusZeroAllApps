# Premium production checklist (Phases 1–4)

Use this to close out the remaining “Global dependencies” checklist in `docs/premium-phases-implementation-plan.md`.

## 1) Hosting / site URL

- [ ] Set `NEXT_PUBLIC_SITE_URL` to your canonical URL (e.g. `https://tminuszero.app`).
  - Used for: canonical URLs, OG tags, and auth redirect allowlists.

## 2) Supabase (required)

- [ ] Set env vars in your deployment environment:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY` (required for billing + tokenized RSS/calendar)
- [ ] Apply migrations to the production database (in order).
- [ ] Deploy Edge Functions (if you’re using Supabase jobs).
- [ ] Configure job auth settings in `public.system_settings`:
  - `jobs_enabled` = `true`
  - `jobs_base_url` = your Edge Functions base URL
  - `jobs_apikey` = anon key (or a dedicated job JWT)
  - `jobs_auth_token` = random secret for `x-job-token`

## 3) Stripe (required for paid tier)

- [ ] Set env vars in your deployment environment:
  - `STRIPE_SECRET_KEY`
  - `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_PRICE_PRO_MONTHLY` (price id)
  - `STRIPE_WEBHOOK_SECRET`
- [ ] If you run the Supabase cron reconciliation job (`billing-reconcile`), also set `STRIPE_SECRET_KEY` as a Supabase **Edge Function secret** (so the function can call the Stripe API).
- [ ] Configure Stripe webhook endpoint to:
  - `POST /api/webhooks/stripe`
- [ ] Enable (at minimum) these Stripe webhook event types (matches `app/api/webhooks/stripe/route.ts`):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`

## 4) Sanity checks

- [ ] Local checks:
  - `npm run check`
  - `npm run build`
  - `npm run test:smoke`
  - `npm run test:seo`
  - `npm run perf:ttfb`
- [ ] Config checks (reads env + optionally queries Supabase `system_settings`):
  - `npm run check:prod`
- [ ] Stripe webhook check (lists Stripe endpoints + validates required events):
  - `npm run check:stripe-webhook -- --site-url=https://tminuszero.app`
- [ ] Token feed cache/ETag smoke (requires real feed tokens):
  - `npm run test:token-feeds -- --base-url=https://tminuszero.app --calendar-token=<uuid> --rss-token=<uuid>`

## 5) Premium feature smoke (prod)

- [ ] Subscribe to a tokenized calendar feed and verify:
  - 200 responses + `Cache-Control: public, s-maxage=15, stale-while-revalidate=60`
  - stable `ETag` / 304s on repeat requests
  - reminders (`VALARM`) appear in Apple Calendar / Google Calendar
- [ ] Subscribe to RSS + Atom and verify:
  - `/rss/<token>.xml` and `/rss/<token>.atom` both return 200 + caching headers
  - token rotation invalidates old URLs
