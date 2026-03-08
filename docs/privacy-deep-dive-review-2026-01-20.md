# Privacy Deep‑Dive Review (US) — January 20, 2026 (Non‑Legal)

This is a best‑effort product/security review of our privacy disclosures vs. the current repo and common US privacy requirements. It is **not legal advice**.

## Scope (privacy only)

In scope:

- Public disclosures and UX around privacy:
  - `app/legal/privacy/page.tsx`
  - `app/legal/privacy-choices/page.tsx`
  - `app/legal/privacy-choices/privacy-choices-client.tsx`
- The privacy “plumbing” these pages rely on:
  - `app/api/me/export/route.ts` (self‑serve access/portability)
  - `app/api/me/account/delete/route.ts` (self‑serve deletion)
  - `app/api/me/profile/route.ts` (self‑serve correction)
  - `app/api/me/privacy/preferences/route.ts`
  - `lib/server/privacyPreferences.ts`
  - `supabase/migrations/0090_privacy_preferences.sql`
  - `supabase/migrations/0092_privacy_preferences_on_signup.sql`

Out of scope:

- Terms of Service (including the SMS Alerts program terms) and non‑privacy compliance (TCPA/CTIA) except where it affects privacy disclosures.
- Security program, incident response, formal vendor DPAs, and legal entity/governance topics.

## What we do today (privacy‑relevant behaviors)

Based on the repo:

- We run an account‑based web app with authentication, subscriptions, and optional notifications (email, SMS, web push).
- We store and process:
  - Account + profile data (email, name, timezone)
  - Subscription status and payment identifiers (payment details handled by Stripe)
  - Notification preferences, including SMS phone number and verification state if the user opts in
  - SMS consent/audit events (action history + request metadata like IP address, user agent, request URL)
  - Web push subscription data (endpoint + keys + user agent)
  - Optional privacy preference flags (sale/share opt‑out, sensitive “limit”, block third‑party embeds)
- We use third‑party vendors for core processing (auth/database/hosting/CDN/security/SMS/email/payments) and optional sign‑in providers (Google, X).

## External requirements (what “industry standard” typically means in the US)

### 1) Baseline: clear notice + real controls

Across modern US state privacy laws, “industry standard” usually means:

- A privacy notice that clearly states:
  - categories of personal information processed
  - purposes for processing
  - categories of third parties/service providers you disclose to
  - retention criteria
  - consumer rights + how to exercise them + appeals (where required)
- A working mechanism to:
  - access/port and delete account data (self‑serve where possible)
  - opt out of sale/sharing (where applicable)
  - honor opt‑out preference signals (e.g., GPC / “universal opt‑out”)

Authoritative sources (primary):

- California CCPA regs: privacy policy content requirements (11 CCR § 7011)
  - https://www.law.cornell.edu/regulations/california/11-CCR-7011
- California CCPA regs: designated request methods (11 CCR § 7020)
  - https://www.law.cornell.edu/regulations/california/11-CCR-7020
- Colorado Privacy Act: privacy notice requirements (C.R.S. § 6‑1‑1308)
  - https://law.justia.com/codes/colorado/title-6/article-1/part-13/section-6-1-1308/
- Colorado (Attorney General): universal opt‑out mechanism rulemaking (press release)
  - https://coag.gov/press-releases/consumer-privacy-rulemaking/
- Connecticut Data Privacy Act: consumer rights + privacy notice obligations
  - https://law.justia.com/codes/connecticut/2022/title-42/chapter-743/section-42-521/
- Connecticut: opt‑out preference signal requirement (effective date and details)
  - https://law.justia.com/codes/connecticut/2022/title-42/chapter-743/section-42-521/
- Texas Data Privacy and Security Act: privacy notice obligations and rights framework
  - https://law.justia.com/codes/texas/business-and-commerce-code/title-11/chapter-541/subchapter-b/section-541-102/
- Utah Consumer Privacy Act: privacy notice + rights framework
  - https://le.utah.gov/xcode/Title13/Chapter61/13-61-S201.html
- Florida Digital Bill of Rights: controller privacy notice requirement (scope depends on thresholds/definitions)
  - https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.705.html
- Virginia CDPA: privacy notice obligations and rights framework
  - https://law.lis.virginia.gov/vacodefull/title59.1/chapter53/

Notes:

- Many state laws apply only when you meet certain thresholds (revenue, volume of consumers, % revenue from sale, etc.). We should confirm applicability with counsel, but we can still implement a “best practice” baseline for everyone.
- Colorado and Connecticut have specific “universal opt‑out” expectations; many companies implement Global Privacy Control (GPC) as their universal signal.

### 2) Vendor/platform requirements that affect privacy wording

Twilio (A2P 10DLC / carrier review expectations) commonly requires that the public privacy policy includes language like:

- “No mobile information will be shared with third parties/affiliates for marketing/promotional purposes.”

Sources:

- Twilio error guidance for “Carrier Compliance / Privacy policy missing required phrase”
  - https://www.twilio.com/docs/errors/30034
- Twilio messaging policies (general)
  - https://www.twilio.com/en-us/legal/messaging-policy

Google (Sign in with Google / Google API Services User Data Policy):

- Requires a publicly accessible privacy policy, with disclosures about data access/use and security/retention appropriate to the scopes accessed.

Source:

- Google API Services User Data Policy
  - https://developers.google.com/terms/api-services-user-data-policy

## Current implementation check (does the repo match our Privacy Notice?)

## Granular checklist (privacy notice + controls)

Status key:

- ✅ = implemented and disclosed
- 🟡 = partially implemented / could be clearer
- ⚠️ = missing (or at risk if we add features later)

Notice (content):

- ✅ Contact method (support email): `app/legal/privacy/page.tsx`
- ✅ Categories of personal information collected (plain language): `app/legal/privacy/page.tsx`
- 🟡 “California category buckets” style list (if we want to meet 11 CCR § 7011 formatting expectations even under thresholds): not currently in a CA‑style table
- ✅ Purposes for processing: `app/legal/privacy/page.tsx`
- ✅ Categories of disclosures to vendors/service providers: `app/legal/privacy/page.tsx`
- ✅ Statement about “sale”/“sharing” (and that third‑party services may collect directly): `app/legal/privacy/page.tsx`
- ✅ Sensitive personal information (limited use): `app/legal/privacy/page.tsx`
- ✅ Retention criteria: `app/legal/privacy/page.tsx`
- ✅ Children (COPPA‑style under‑13 statement): `app/legal/privacy/page.tsx`
- ✅ Security (reasonable safeguards): `app/legal/privacy/page.tsx`

Controls (rights + preferences):

- ✅ Access/portability self‑serve (signed in): `app/api/me/export/route.ts`, `/legal/privacy-choices`
- ✅ Deletion self‑serve (signed in): `app/api/me/account/delete/route.ts`, `/legal/privacy-choices`
- ✅ Correction path (profile fields): `/account` (UI) and `app/api/me/profile/route.ts` (API)
- ✅ Opt‑out toggles (sale/share, limit sensitive, block embeds): `/legal/privacy-choices`
- ✅ Account‑level persistence for privacy toggles: `app/api/me/privacy/preferences/route.ts`, `supabase/migrations/0090_privacy_preferences.sql`
- ✅ Browser‑level persistence for privacy toggles: cookies (`tmn_*`), `/legal/privacy-choices`
- ✅ GPC recognition:
  - server: `lib/server/privacyPreferences.ts` (reads `Sec-GPC` / `GPC`)
  - client: `components/PrivacySignals.tsx` + `/legal/privacy-choices`
- 🟡 Universal opt‑out signals beyond GPC: not implemented (we currently treat GPC as our universal signal)

Process requirements (state privacy laws):

- ✅ Identity verification statement: `app/legal/privacy/page.tsx`
- ✅ Authorized agent statement: `app/legal/privacy/page.tsx`
- ✅ Appeals statement: `app/legal/privacy/page.tsx`
- ✅ Non‑discrimination statement: `app/legal/privacy/page.tsx`
- ✅ Multiple request methods (online‑only acceptable): self‑serve + email (see 11 CCR § 7020): `app/legal/privacy/page.tsx`, `/legal/privacy-choices`

### A) Notice content

What we already cover well:

- Data categories in plain language (account, notifications, billing identifiers, push subscriptions, communications, logs).
- Purposes (service operation, security/abuse prevention, billing, communications, reliability).
- Service provider disclosures (auth/db, hosting, payments, SMS, email, etc.).
- “No sale” / “no sharing” claim (matched by the repo: no third‑party tracking SDKs detected).
- US rights list + verification + authorized agent + no discrimination + appeal language.
- GPC handling statement.

Potential gaps vs “maximum compliance” posture:

- ✅ Added a “California Disclosures” section with CCPA/CPRA category terminology and a “sold/share” statement.
- ✅ Added a “Profiling” statement (no legal/significant‑effect profiling).
- Retention: our notice uses “criteria” language; some companies choose to add category‑by‑category retention ranges. This is not strictly required in every state law, but is increasingly common.

### B) Controls and honoring signals

What we already have:

- Self‑serve access/export + delete (signed‑in) on `/legal/privacy-choices`.
- Email request method via `support@tminuszero.app`.
- Account‑level privacy preferences storage (Supabase table + API + UI).
- Browser‑level privacy preferences via cookies.
- GPC honored:
  - client (`navigator.globalPrivacyControl`)
  - server (`Sec-GPC` / `GPC` header)

Potential gaps / edge cases:

- If we add analytics later, we must actually wire the “opt out of sale/share” flags into those integrations (right now they’re “future‑proofing” flags).
- “Block embeds” is wired into launch pages; good. If we add other embeds later, we must also honor the same flag there.

## Recommended privacy terminology adjustments (to be “industry standard”)

These are copy/structure recommendations (not all are required):

1) Use “personal information” consistently, and note that some laws use “personal data” as a synonym.
2) Use “service providers” (CA) / “processors” (other states) terminology at least once (plain‑language: “vendors that process data on our behalf”).
3) When saying “we do not sell”:
   - keep “sell”/“share” in quotes and clarify it’s as defined under certain state laws.
4) Clarify opt‑out signals:
   - say we honor GPC as a request to opt out of “sale/sharing” “where applicable”.
5) SMS privacy language:
   - avoid absolute statements like “we never share opt‑in data with any third party”; instead, limit it to “for marketing/promotional purposes” and allow for message delivery vendors.

## Concrete gaps found (actionable)

No critical gaps found after the January 20, 2026 privacy updates.

## Next steps (if you want “max compliance” polish)

Optional polish (tradeoffs vs plain language):

- Add category‑by‑category retention ranges (instead of criteria‑only retention language).
- Add a short “data minimization” statement (e.g., we collect only what we need to provide the Service).
