# Twilio US A2P 10DLC Verification Playbook (T-Minus Zero)

This document is the “source of truth” for how our SMS program works and what we submit to Twilio/The Campaign Registry (TCR) for **US A2P 10DLC** verification. It is written to:

- Provide a paste‑ready, reviewer‑friendly description of our program.
- Prevent common Campaign registration failures.
- Keep our **code, website disclosures, and Twilio configuration** aligned over time.

This playbook assumes our **Messaging Service uses Twilio’s Advanced Opt‑Out add‑on**.

## Key Twilio references (read these first)

- US A2P 10DLC overview: https://www.twilio.com/docs/messaging/compliance/a2p-10dlc
- A2P 10DLC registration quickstart (includes the “why campaigns fail” tips): https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/quickstart
- Troubleshooting and rectifying campaigns (common rejection/suspension causes): https://www.twilio.com/docs/messaging/compliance/a2p-10dlc/troubleshooting-a2p-brands/troubleshooting-and-rectifying-a2p-campaigns-1
- Advanced Opt‑Out (Messaging Service): https://www.twilio.com/docs/messaging/tutorials/advanced-opt-out
- UsAppToPerson (A2P campaign) API reference (field requirements/min lengths): https://www.twilio.com/docs/messaging/api/usapptoperson-resource
- Twilio error 21610 (“unsubscribed recipient”): https://www.twilio.com/docs/api/errors/21610
- CTIA best practices (Twilio blog, consent + proof expectations): https://www.twilio.com/blog/ctia-messaging-principles-and-best-practices

## 1) What Twilio/TCR is verifying

Twilio/TCR’s goal for 10DLC is to ensure traffic is **verified** and **consensual**. Concretely, reviewers look for:

- A clear **Brand** identity (who is sending the messages).
- A single‑purpose **Campaign** (why we’re messaging, what content we send, and the use case category).
- A verifiable **opt‑in process** (how the consumer consented).
- A functioning **opt‑out + help** mechanism (STOP/START/HELP and support contact).
- **Message samples** that match the real traffic (including brand identification, and accurate examples).
- Correct “message contents” flags (embedded links, embedded phone numbers, age‑gated content, direct lending).

Twilio explicitly notes that most failures happen during **Campaign registration**, usually due to weak descriptions, weak/verifiability of opt‑in, or mismatched/insufficient message samples.

### Registration prerequisites (what must exist before submission)

From Twilio’s A2P 10DLC quickstart, the minimum prerequisites are:

- A paid (non‑trial) Twilio account.
- At least one US “Local” (10DLC) phone number that is SMS‑capable.
- A Customer Profile + Brand registration in Twilio (Sole Proprietor or Standard/LVS, depending on the business).
- An A2P Campaign submission (and time for vetting).
- The sender phone number attached to the **Messaging Service** that is registered with the Campaign.

Operational notes from Twilio’s troubleshooting guidance:

- Campaign statuses you’ll see: `IN_PROGRESS`, `VERIFIED`, `FAILED` (and sometimes `SUSPENDED`).
- `IN_PROGRESS` is not an error; it means vetting is still underway.
- If a Campaign is `FAILED`, fix the specific rejection reasons and resubmit; resubmissions may incur additional vetting fees.
- Avoid deleting approved campaigns unless you have a strong reason (it can complicate auditing and continuity).

## 2) Our SMS program summary (what we actually do)

**Program name / brand**: T-Minus Zero (`BRAND_NAME` in `lib/brand.ts`)

**Use case**: Rocket launch notifications (user‑requested alerts). Not marketing, not lead‑gen, no affiliate sharing.

**Audience**: Users who explicitly opt in via our website. SMS alerts are a Premium feature (entitlement‑gated).

**Geography**: US phone numbers (10DLC program).

**Message categories we send**

1. **Opt‑in confirmation**: sent immediately after the user enables SMS alerts (website opt‑in).
2. **Scheduled reminders**: based on the per‑launch schedule a user selects (e.g., T‑10).
3. **Change notifications**: status updates or NET/time updates for launches the user follows.
4. **STOP/START/HELP**: handled by Twilio Advanced Opt‑Out auto‑replies (see section 6).

**Message frequency**

- “Msg freq varies” is disclosed to users during opt‑in.
- We implement server‑side guardrails (caps + minimum gaps + batching + max length) in:
  - `supabase/functions/notifications-dispatch/index.ts`
  - `supabase/functions/notifications-send/index.ts`

**Branding**

- Outbound launch alert messages are branded via `prefixSmsWithBrand(...)` in our sending pipeline (see `supabase/functions/notifications-dispatch/index.ts` and `lib/notifications/smsProgram.ts`).

## 3) Public pages reviewers may check

Twilio reviewers commonly verify these:

- Terms (includes SMS program terms): `https://www.tminuszero.app/legal/terms#sms-alerts`
- Privacy: `https://www.tminuszero.app/legal/privacy`
- FAQ: `https://www.tminuszero.app/docs/faq`
- SMS opt-in (CTA proof): `https://www.tminuszero.app/docs/sms-opt-in`

Twilio’s quickstart guidance also expects the privacy policy to explicitly state that **mobile information will not be shared with third parties or affiliates for marketing/promotional purposes**.

If the opt‑in flow is behind authentication (it is), provide a publicly accessible CTA proof URL that a reviewer can verify without logging in (public page, or a hosted screenshot/PDF/video). Our preferred proof URL is `https://www.tminuszero.app/docs/sms-opt-in`.

## 4) Our opt‑in flow (verifiable + consent‑based)

Twilio requires an explicit, verifiable opt‑in process and warns you cannot solicit opt‑in via SMS messages that are sent before consent.

Our flow is:

1. User creates an account and signs in.
2. User navigates to Notifications: `https://www.tminuszero.app/me/preferences` (`app/me/preferences/page.tsx`).
3. User enters their phone number (US).
4. User reviews the SMS disclosure and checks an **unchecked-by-default** consent checkbox.
5. User requests a one‑time verification code (Twilio Verify) to confirm phone ownership:
   - API: `POST /api/notifications/sms/verify` (`app/api/notifications/sms/verify/route.ts`)
   - Requires `sms_consent=true` in the request payload.
6. User enters the code to verify:
   - API: `POST /api/notifications/sms/verify/check` (`app/api/notifications/sms/verify/check/route.ts`)
7. User enables “SMS alerts” and saves preferences (this is the actual opt‑in action):
   - API: `POST /api/me/notifications/preferences` (`app/api/me/notifications/preferences/route.ts`)
   - Requires `sms_consent=true` when enabling SMS from off → on.
8. On first opt‑in, we send an opt‑in confirmation SMS containing required disclosures:
   - Message content defined in `lib/notifications/smsProgram.ts`.

### Website disclosure (what users see)

The disclosure in `app/me/preferences/page.tsx` includes:

- Brand identification (T-Minus Zero)
- “recurring automated text messages”
- Message frequency disclosure (“Message frequency varies”)
- “Message and data rates may apply”
- STOP/HELP instructions
- “Consent is not a condition of purchase”
- Links to Terms + Privacy

## 5) Proof of consent (what we can produce within 24 hours)

Carrier escalations can require proof of opt‑in quickly. We store an audit trail in:

- DB table: `public.sms_consent_events` (`supabase/migrations/0066_sms_consent_events.sql`)
- Insert helper: `lib/server/smsConsentEvents.ts`

We log:

- `verify_requested` / `verify_approved` (phone ownership verification)
- `web_opt_in` / `web_opt_out` (explicit preference changes)
- `keyword_stop` / `keyword_start` / `keyword_help` (inbound keyword events)
- `twilio_opt_out_error` (Twilio blocked a send due to prior STOP/opt‑out; e.g., 21610)

For web‑initiated events we capture request metadata when available: IP, user agent, and request URL. This, combined with our public CTA proof page (and optional screenshots), is designed to satisfy “proof of consent” requests.

## 6) Opt‑out / opt‑in / help behavior (Advanced Opt‑Out)

Twilio’s Advanced Opt‑Out is configured on the **Messaging Service** (Console: Messaging Service → Opt‑Out Management). With Advanced Opt‑Out:

- Twilio handles standard opt‑out keywords for long codes: `STOP`, `UNSUBSCRIBE`, `END`, `QUIT`, `STOPALL`, `REVOKE`, `OPTOUT`, `CANCEL` (per Twilio docs).
- Twilio can also be configured with custom/localized keywords and custom auto‑reply messages.
- Twilio includes an `OptOutType` field in the inbound webhook request when a message triggers opt‑out management (`STOP`, `START`, `HELP`).

### Our app’s responsibilities when Advanced Opt‑Out is enabled

We do **not** send STOP/START/HELP auto‑replies by default (to avoid duplicate messages), but we still:

- Validate Twilio signatures on inbound webhooks.
- Update internal preference state when we detect STOP/START.
- Log keyword events into `sms_consent_events`.

Implementation:

- Inbound webhook endpoint: `app/api/notifications/sms/inbound/route.ts`
- Default behavior: `TWILIO_OPT_OUT_MODE=twilio` (no app auto‑reply; empty TwiML).

Example values for `TWILIO_OPT_OUT_MODE` (we normalize with trim + lowercase):

- `twilio`
- `app`
- `TWILIO`
- `APP`
- ` twilio `

### Keyword expectations (internal)

We treat the following as keywords (normalized, case‑insensitive):

- STOP keywords: `STOP`, `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, `OPTOUT`, `REVOKE` (`lib/notifications/smsKeywords.ts`)
- START keywords: `START`, `UNSTOP`
- HELP keywords: `HELP`, `INFO`

Important: for re‑subscribing after STOP, Twilio’s docs emphasize **START/UNSTOP**. Do not rely on “YES” for unblocking.

### Required copy when relying on Twilio auto‑replies

Because Advanced Opt‑Out sends the auto‑reply messages, ensure Twilio’s configured **HELP** and **STOP** responses include:

- Our brand name (“T-Minus Zero”)
- A support contact (`support@tminuszero.app`) and/or a link

Example copy:

- HELP: “T-Minus Zero alerts. Msg freq varies. Message and data rates may apply. Reply STOP to cancel. Support: support@tminuszero.app.”
- STOP: “You are unsubscribed from T-Minus Zero alerts. You will not receive any more messages. Reply START to resubscribe.”

If Twilio’s Advanced Opt‑Out copy is generic, the user experience looks unbranded and reviewers may consider it incomplete.

## 7) Outbound sending rules (avoid silent mismatches)

To ensure A2P registration/opt‑out behavior applies consistently:

- **Outbound SMS should be sent using the Messaging Service SID**, not only a raw `From` number.
  - Set `TWILIO_MESSAGING_SERVICE_SID` in every runtime (Next.js + Supabase Edge Functions).
  - Our code supports this; it prefers the service SID when present.

Example values for `TWILIO_MESSAGING_SERVICE_SID` (format: `MG` + 32 hex chars):

- `MG0123456789abcdef0123456789abcdef`
- `MG11111111111111111111111111111111`
- `MG22222222222222222222222222222222`
- `MGdeadbeefdeadbeefdeadbeefdeadbeef`
- `MGffffffffffffffffffffffffffffffff`

## 8) Campaign fields: what to submit (paste‑ready)

These fields map directly to what Twilio/TCR reviews. Requirements and min lengths are described in Twilio’s UsAppToPerson resource docs.

### Hard requirements (min/max)

Per Twilio’s UsAppToPerson resource docs:

- Campaign description: 40–4096 chars
- Message flow (opt‑in details): 40–2048 chars
- Message samples: 2–5 samples; each 20–1024 chars
- `subscriberOptIn`: should be `true` for consent‑based programs
- `optInMessage`/`optOutMessage`/`helpMessage`: 20–320 chars (required if you manage keywords yourself; not required if using Twilio Default/Advanced Opt‑Out)

### Campaign description (must be detailed)

Use a full sentence description describing the alerts, audience, and cadence. Avoid single‑word answers.

Example:

> This campaign sends recurring automated SMS notifications to opted‑in users about rocket launches they select, including scheduled reminders (e.g., T‑10) and status/time updates. Messages are informational alerts only (not marketing), and users can opt out at any time by replying STOP.

### Message flow (must mention consent + STOP/HELP + URLs)

Ensure it includes:

- The exact opt‑in steps (account → preferences page → checkbox → verify code → enable SMS).
- The disclosures shown on the website (“msg freq varies”, “Message and data rates may apply”, “consent is not a condition of purchase”).
- STOP/HELP (and support email).
- The phone number(s) messages will originate from (US 10DLC long code).
- Terms + Privacy URLs.

Paste‑ready example:

> Users create an account on https://www.tminuszero.app and (if desired) upgrade to Premium. In Notifications (https://www.tminuszero.app/me/preferences), users enter their phone number, check an unchecked consent checkbox agreeing to receive recurring automated SMS rocket launch alerts with message frequency varying, and confirm that Message and data rates may apply and consent is not a condition of purchase. Users request a one-time verification code (Twilio Verify) and enter the code to confirm ownership, then enable “SMS alerts” and save preferences to opt in. After opt-in, users receive a confirmation text. Users can opt out at any time by replying STOP (or any STOP keyword) and can get help by replying HELP/INFO or emailing support@tminuszero.app. Terms: https://www.tminuszero.app/legal/terms Privacy: https://www.tminuszero.app/legal/privacy
>
> Originating number(s) (US 10DLC): +14075888658
>
> CTA proof (opt-in is behind login; SMS is currently unavailable pending A2P approval): https://www.tminuszero.app/docs/sms-opt-in
>
> SMS program terms: https://www.tminuszero.app/legal/terms#sms-alerts

### Message samples (2–5; must include brand; should match production)

Provide examples that match our real format (brand prefix). Avoid URL shorteners (bit.ly, TinyURL). If links are included, use a real site domain or a dedicated branded short domain.

Recommended samples:

- “T-Minus Zero SMS alerts enabled. Msg freq varies. Message and data rates may apply. Reply STOP to cancel, HELP for help. Support: support@tminuszero.app.”
- “T-Minus Zero alerts: subscribed. Message and data rates may apply. Reply STOP to cancel, HELP for help. Manage: https://www.tminuszero.app/me/preferences.”
- “T-Minus Zero: Falcon 9 | Starlink 6-98 T-10. Launch at Jan 14, 6:08 PM UTC. Status: go”
- “T-Minus Zero: Falcon 9 | Starlink 6-98 status update: Success (was In Flight). Launch at Jan 14, 6:08 PM UTC.”
- “T-Minus Zero: Falcon 9 | Starlink 6-98 time updated: Jan 14, 6:08 PM UTC (was Jan 14, 6:01 PM UTC). Status: go.”

### Message contents flags

Our intended flags:

- `hasEmbeddedLinks`: `true` (we may include https links in program messages depending on opt‑out mode/settings)
- `hasEmbeddedPhone`: `false`
- `ageGated`: `false`
- `directLending`: `false`
- `subscriberOptIn`: `true`

If these ever change in code, update the Campaign registration to match to avoid “campaign‑to‑traffic mismatch” suspensions.

## 9) The most common ways Campaigns fail (and how we prevent them)

Based on Twilio’s quickstart + troubleshooting guidance, failures commonly come from:

1. **Invalid/insufficient campaign description** (too short, vague, or does not explain the objective).
   - Fix: provide a detailed description and ensure it matches the selected use case.
2. **Invalid sample messages** (unclear, missing brand, or content doesn’t match the campaign).
   - Fix: include 2–5 realistic samples; include brand name; match actual templates; use `[]` for templated fields if needed.
3. **Unverifiable opt‑in process**.
   - Fix: provide a working, publicly accessible opt‑in flow OR provide a publicly accessible video/screenshot evidence of the opt‑in.
4. **Missing STOP/HELP details in message flow**.
   - Fix: explicitly mention STOP/HELP and support contact in message flow; ensure Advanced Opt‑Out is enabled and copy is branded.
5. **URL shorteners in sample messages** (bit.ly/TinyURL) or non‑functional website links.
   - Fix: use real domain links; only use branded short domains if shortening is required.
6. **Campaign‑to‑traffic mismatch** (what you registered is not what you actually send).
   - Fix: treat this playbook as change‑controlled: if templates/flows change, update Campaign details and rerun the audit.
7. **Disallowed content / high‑risk traffic** (SHAFT categories, phishing, spam patterns, affiliate opt‑in sharing).
   - Fix: we do not send disallowed content; we do not share opt‑ins; we throttle messages and enforce entitlements.

## 10) Pre‑submission / pre‑launch audit (required)

### Submission checklist (do not skip)

- [ ] Campaign status is `VERIFIED` (or you are resubmitting and awaiting review).
- [ ] Campaign description is detailed and specific (not generic).
- [ ] `messageFlow` explicitly mentions: website opt‑in steps, consent checkbox, msg frequency disclosure, Message and data rates, “consent is not a condition of purchase”, STOP/HELP, support contact, originating phone number(s), Terms/Privacy URLs, and a CTA proof URL.
- [ ] `messageSamples` are 2–5 realistic examples, include “T-Minus Zero” branding, and match what we actually send (no mismatched use case).
- [ ] If any sample includes a link, it is a real functional website URL (no generic URL shorteners like bit.ly/TinyURL; only use a dedicated branded short domain if shortening is required).
- [ ] `subscriberOptIn` is set to `true`.
- [ ] Message content flags match reality: `hasEmbeddedLinks`, `hasEmbeddedPhone`, `ageGated`, `directLending`.
- [ ] Messaging Service inbound webhook points to our inbound endpoint and uses POST.
- [ ] Advanced Opt‑Out is enabled on the Messaging Service, and STOP/HELP auto‑reply copy includes brand + support contact.
- [ ] Outbound sends use the Messaging Service (`TWILIO_MESSAGING_SERVICE_SID` is set in all runtimes).
- [ ] Public pages exist and are accurate: Terms, Privacy, FAQ, SMS opt-in (CTA proof).
- [ ] Privacy policy explicitly states we do not share mobile information with third parties/affiliates for marketing/promotional purposes.
- [ ] A publicly accessible CTA proof URL exists (public page or hosted screenshot/PDF/video) showing the opt-in CTA/disclosures when the opt-in flow is behind login or not yet published.

Run:

```bash
npm run twilio:a2p:audit -- --site-url https://www.tminuszero.app
```

This checks:

- Messaging Service inbound webhook URL/method
- Service ↔ sender attachment
- A2P campaign fields (status, message flow, samples, keywords, subscriberOptIn)
- Brand registration status (when accessible via API)
- Verify service presence (if configured)

If the audit reports warnings about missing STOP/HELP in `messageFlow`, missing brand in samples, missing `subscriberOptIn`, or missing `TWILIO_MESSAGING_SERVICE_SID`, fix those before resubmitting.

### Optional: Twilio CLI / API spot checks

Twilio’s docs include CLI/API methods to fetch live configuration. These are useful for quick spot checks, but our `twilio:a2p:audit` script is the preferred, repeatable preflight.

Twilio CLI (requires `twilio-cli`):

```bash
twilio api:messaging:v1:services:fetch --sid MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
twilio api:messaging:v1:services:compliance:usa2p:fetch \\
  --messaging-service-sid MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \\
  --sid QExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Raw API (same resources as the CLI):

```bash
curl -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \\
  \"https://messaging.twilio.com/v1/Services/MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"

curl -u $TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN \\
  \"https://messaging.twilio.com/v1/Services/MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/Compliance/Usa2p/QExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\"
```

Example values for placeholders used above (format only; do not use real production secrets):

- `TWILIO_ACCOUNT_SID` (format: `AC` + 32 hex chars)
  - `AC0123456789abcdef0123456789abcdef`
  - `AC11111111111111111111111111111111`
  - `AC22222222222222222222222222222222`
  - `ACdeadbeefdeadbeefdeadbeefdeadbeef`
  - `ACffffffffffffffffffffffffffffffff`
- `TWILIO_AUTH_TOKEN` (secret; 32 chars commonly shown as hex)
  - `0123456789abcdef0123456789abcdef`
  - `11111111111111111111111111111111`
  - `22222222222222222222222222222222`
  - `deadbeefdeadbeefdeadbeefdeadbeef`
  - `ffffffffffffffffffffffffffffffff`
- Messaging Service SID (format: `MG` + 32 hex chars)
  - `MG0123456789abcdef0123456789abcdef`
  - `MG11111111111111111111111111111111`
  - `MG22222222222222222222222222222222`
  - `MGdeadbeefdeadbeefdeadbeefdeadbeef`
  - `MGffffffffffffffffffffffffffffffff`
- A2P Campaign SID (format: `QE` + 32 hex chars)
  - `QE0123456789abcdef0123456789abcdef`
  - `QE11111111111111111111111111111111`
  - `QE22222222222222222222222222222222`
  - `QEdeadbeefdeadbeefdeadbeefdeadbeef`
  - `QEffffffffffffffffffffffffffffffff`

## 11) Operational checks (after approval)

Do these at least once per release that touches messaging:

- Inbound keyword test:
  - Text `STOP` → Twilio should auto‑reply and future sends should fail with 21610.
  - Text `START` → Twilio should auto‑reply and future sends should succeed.
  - Text `HELP` → Twilio should auto‑reply with branded/supportful help text.
- Verify internal state:
  - `notification_preferences.sms_enabled` should flip off/on appropriately.
  - `sms_consent_events` should record `keyword_stop` / `keyword_start` / `keyword_help`.
- Monitor opt‑out enforcement:
  - Any 21610 errors should log `twilio_opt_out_error` and disable SMS for that phone internally.
