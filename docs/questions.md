# Questions / Inputs / Accounts Needed

Keep this list as the running “handoff checklist” for anything that requires your decision, credentials, or external setup.

## 1) Identity, Domain, and Email
1. Confirm canonical site URL(s): `https://www.tminuszero.app` + redirect strategy for apex + legacy domain(s).
2. Brand identity: official product/company name for legal docs, footer, and Stripe descriptors.
3. Support inbox you want live (DNS + mailbox): `support@tminuszero.app`.
4. DNS access: who will configure Vercel + email (SPF/DKIM/DMARC)?

## 2) Supabase (Required)
5. Supabase project reference (`<project-ref>`) and URL for production.
6. Provide env vars (Vercel + local):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
7. Auth settings: email confirmations on/off, password policy, and allowed redirect URLs (needs `NEXT_PUBLIC_SITE_URL`).
8. Admin seeding: which user email(s) should be granted `role=admin` in `profiles` at launch?
9. Migrations: confirm whether you want to run DB migrations via Supabase CLI (`supabase db push`) or SQL console.

## 3) Launch Library 2 (LL2)
10. Confirm source strategy:
   - Plan tier + billing owner, and the rate limit we should configure in `system_settings.ll2_rate_limit_per_hour`.
11. Provide the email you want embedded in our LL2 User-Agent (`LL2_USER_AGENT`) for responsible use and potential outreach (currently `support@tminuszero.app`).
12. Do you want us to proactively email The Space Devs (LL2) once we go beyond MVP (higher cadence / commercial launch) to confirm acceptable usage and discuss higher limits/SLA?
13. Coverage definition: “US-only” includes which suborbital sites? Any exclusions?
14. Featured/tier overrides: initial list of “MAJOR/NOTABLE” targets you want pinned or overridden at launch.
15. Runtime LL2: we removed direct LL2 detail calls to stay under the free limit; the site renders from Supabase caches. If you want a fallback LL2 detail path, share the desired strategy/key + rate-limit guardrails.

## 5) Stripe Billing (Paid Tier)
18. Stripe account: who owns it, and which business name should appear on statements?
19. Pricing: confirm $3.99/mo (currency, taxes, trial/no-trial, refund policy language).
20. Provide Stripe env vars:
   - `STRIPE_SECRET_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `STRIPE_PRICE_PRO_MONTHLY` (price id)
21. Webhook setup: confirm event types you’ll enable (at minimum: `checkout.session.completed`, `customer.subscription.*`).
22. Stripe webhook hygiene: remove duplicate endpoints (Snapshot vs Thin) once you settle on one, to avoid double deliveries.
23. Billing portal: confirm portal settings (cancel/upgrade/downgrade) you want enabled.

## 6) Notifications: Email, SMS, Web Push (Paid)
24. Email provider selection (Resend/Postmark/etc.) + API key(s) + from/reply-to addresses.
25. Twilio credentials for SMS:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER` (outbound notifications)
   - `TWILIO_VERIFY_SERVICE_SID` (one-time opt-in verification)
   - `TWILIO_OPT_OUT_MODE` (optional; set to `twilio` when using Twilio Default/Advanced Opt-Out to avoid duplicate STOP/HELP replies)
   - Any compliance copy required for initial opt-in message.
26. Web push: will you generate VAPID keys or should the app generate them? Provide:
   - Server (Supabase Edge): `VAPID_SUBJECT` (mailto:...), `VAPID_SERVER_PUBLIC_KEY`, `VAPID_SERVER_PRIVATE_KEY`
     - Also accepted: `WEB_PUSH_*` or `PUSH_VAPID_*` (legacy)
   - Client (Next.js): `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`
27. iOS push policy: confirm UX cadence for the iOS “Add to Home Screen” prompt (default once/7 days).
28. SMS verification: Twilio Verify (one-time opt-in). Confirm verification copy and any compliance requirements.

## 8) Legal and Compliance
31. Governing law/jurisdiction (currently “Delaware” placeholder) and arbitration/venue preferences.
32. Refund/cancellation terms and required disclosures (especially for subscriptions).
33. Data retention durations (logs/outbox) and deletion request workflow.
34. Any requirements for COPPA/child audiences (assumed general audience; confirm).

## 9) Ops, Observability, and Launch
34. Vercel: project + environments (preview/staging/prod), team access, and deployment protection settings.
35. Monitoring: do you want Sentry (errors), PostHog/Amplitude (product analytics), or none initially?
36. Uptime/status page requirement? (optional)
37. Scheduled jobs: should we run ingestion/cache/notification workers via Supabase cron/Edge Functions or an external worker (and where should credentials live)?
38. LL2 archive: confirm retention/archival guarantees/SLA (we currently observe US launch `net` going back to 1967, but `last_updated` only back to 2023; treat retention as best-effort unless confirmed by The Space Devs).
