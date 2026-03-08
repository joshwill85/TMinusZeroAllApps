# T‑Minus Zero — US Privacy Disclosures & Data Handling Gap Assessment (Non‑Legal Review)

This document is a best‑effort product/security review of privacy disclosures vs. the current codebase and typical US privacy requirements. It is **not legal advice**. Validate with counsel before launch.

## Scope (what I reviewed)

- Next.js app (App Router) + API routes under `app/`.
- Supabase Auth/DB schema and Edge Functions under `supabase/`.
- Payment flows (Stripe) and messaging flows (Twilio).
- No network calls were made; this is based on repo contents and configuration patterns.

## What the product actually does today (data inventory)

### Primary systems / vendors

- **Supabase**: authentication (email/password), session cookies, Postgres storage, Row Level Security (RLS).
- **Stripe**: subscriptions and one‑time “Tip Jar” payments.
- **Twilio**: SMS delivery + Twilio Verify for phone verification; inbound STOP/START/HELP handling.
- **Optional CAPTCHA**: Cloudflare Turnstile or hCaptcha (enabled only if site keys are configured).
- **Third‑party embeds**: YouTube/Vimeo if a user loads embedded “Live coverage” on a launch detail page.

### Personal data collected / stored (based on schema + app flows)

- **Account identifiers**: email; `profiles.first_name`, `profiles.last_name`; timezone.
- **Authentication**: password is handled by Supabase Auth (hashed by Supabase; not stored in this repo DB tables).
- **Billing**:
  - Stored locally: Stripe customer/subscription IDs and subscription status (`stripe_customers`, `subscriptions`).
  - Processed by Stripe: payment card and billing details (not stored in your DB).
  - Tip Jar: donation amount + Stripe payment processing.
- **Notifications**:
  - Phone number in E.164 format, verification state, opt‑in/out timestamps (`notification_preferences`).
  - Quiet hours preferences (`notification_preferences`).
  - Per‑launch alert preferences (`launch_notification_preferences`).
  - Outbox metadata and message content (“launch alerts”) tied to a user (`notifications_outbox.payload.message`).
  - Inbound SMS keywords STOP/START/HELP are processed; the app updates opt‑in state but does not persist inbound message content.
- **Web push** (if used): push subscription endpoint + keys + user agent (`push_subscriptions`).
- **Operational / security data** (typical for web services):
  - App/server logs may include IP address, user agent, and request metadata (hosting dependent).
  - `ingestion_runs` and `webhook_events` tables store operational entries; Stripe webhook storage uses a payload hash rather than the full payload.

### Current user controls already present

- **SMS opt‑out**: reply STOP (handled in `app/api/notifications/sms/inbound/route.ts`).
- **In‑app controls**: notification preferences under `/me/preferences`.
- **No marketing or analytics SDKs in the repo**: the current UI does not render third‑party marketing scripts.

## Where the current privacy disclosures are weak (gaps)

The current `/legal/privacy` page is a short summary that does **not** meet industry‑standard expectations for a consumer web app serving US users, especially if you have paying subscribers and SMS alerts.

### 1) Notice completeness and accuracy

- Missing or under‑described collection:
  - first/last name collection (captured at sign‑up)
  - push subscription endpoints/keys
  - phone number + opt‑in/out timestamps
  - embedded third‑party video behavior (YouTube/Vimeo)
  - CAPTCHA providers (Turnstile/hCaptcha) when enabled
- Mentions email providers (e.g., Postmark) that are not actually wired in this repo; Supabase transactional email still occurs if enabled in Supabase Auth settings.

### 2) US state privacy law rights + required disclosures

For CPRA/CCPA (California) and other state consumer privacy laws (CO, CT, VA, UT, plus newer states), “industry standard” typically includes:

- **Categories of personal data** collected, sources, purposes, and disclosures to vendors/service providers.
- **Retention**: a retention period or criteria (“how long” by category).
- **Consumer rights** workflows:
  - access/know, delete, correct, portability
  - opt‑out of “sale” and “sharing” (CA) where applicable
  - appeal process (CO/CT/VA and others)
  - verification and authorized agent handling
- **Sensitive data** treatment (e.g., account login credentials; payment details handled by Stripe; phone number for SMS alerts).
- **Global Privacy Control (GPC)** recognition (commonly implemented for CA/CO) if you engage in “sale”/“sharing”.

Today, the policy has only a single sentence about “Your Rights” and does not cover the above items.

### 3) “Do Not Sell/Share” opt‑out plumbing

- There is a “Privacy Choices” / “Do Not Sell or Share My Personal Information” entry point.
- The repo currently does not include third‑party tracking integrations. If/when analytics or similar tracking is added, you will need:
  - opt‑out mechanism (UI + honoring the signal)
  - contract language and vendor configuration to disable personalization where opted out
  - GPC support (strongly recommended)

### 4) Sensitive data rules and SMS compliance alignment

- Login credentials are treated as **Sensitive Personal Information** under CPRA when paired with access credentials; the policy should explicitly cover how they’re used and limited.
- SMS programs often require clear disclosures (frequency, STOP/HELP, carrier charges) and recordkeeping around opt‑in/out. Some of this exists in the FAQ and inbound handler, but it should be reflected in privacy disclosures and operational procedures.

### 5) Operational guardrails that should be documented

- Data deletion: there is no self‑serve “delete account” or export in the current UI/API.
- Data retention: no explicit retention periods are documented in policy, and the repo does not implement automated purging for operational tables.

## Recommended remediation (pragmatic, industry‑standard)

### Minimum baseline (pre‑launch)

- Replace `/legal/privacy` with a full privacy notice that:
  - matches actual data collection/uses/vendors
  - includes US state rights and a “Privacy Choices” entry point
  - includes sensitive data and children/minors language
  - includes retention criteria by category
- Add a **Privacy Choices** page and link it site‑wide (footer) with:
  - a clear way to exercise rights (access/export + delete + correct)
  - opt‑outs for “sale”/“sharing” (even if “not applicable today”, prepare the mechanism)
  - contact method for requests that can’t be handled self‑serve

### Strongly recommended (near‑term)

- Implement **self‑serve**:
  - export “my data” (profile + preferences + push subs + subscription status)
  - delete account (delete Supabase user; cascade delete rows; handle subscription cancellation guidance)
- Add/confirm operational retention (or update the policy to match reality):
  - notification outbox retention
  - webhook/ingestion log retention
  - DSAR request retention (if you store requests)

### If/when you add analytics or tracking

- Implement consent/opt‑out honoring, plus GPC.
- Update privacy notice for “sharing” if applicable.
- Maintain vendor DPAs and configure analytics vendors for restricted processing where required.

## Open items you should confirm with counsel / business owners

- Legal entity name, jurisdiction/venue, and contact methods (privacy/support inboxes).
- Whether the service is “online only” for CPRA method‑of‑contact requirements.
- Retention periods and deletion exceptions (tax/accounting/fraud/security).
- Whether you are “directed to children” or knowingly collect from minors (COPPA / state minor protections).

## Repo changes implemented (to close key gaps)

- Full privacy notice rewrite: `app/legal/privacy/page.tsx`
- Privacy choices + opt‑outs UI: `app/legal/privacy-choices/page.tsx`, `app/legal/privacy-choices/privacy-choices-client.tsx`
- Self‑serve access/export: `app/api/me/export/route.ts`
- Self‑serve deletion: `app/api/me/account/delete/route.ts`
- Self‑serve correction (profile update): `app/api/me/profile/route.ts` (POST), `app/account/page.tsx`
- Reduced third‑party video tracking by default + embed opt‑out honoring: `app/launches/[id]/page.tsx`
- Account‑level privacy preference persistence + API: `supabase/migrations/0048_privacy_preferences.sql`, `app/api/me/privacy/preferences/route.ts`, `app/legal/privacy-choices/privacy-choices-client.tsx`
- Sitewide links + sitemap: `components/Footer.tsx`, `components/DockingBay.tsx`, `components/TipJarFooter.tsx`, `components/DesktopRail.tsx`, `app/sitemap.ts`
