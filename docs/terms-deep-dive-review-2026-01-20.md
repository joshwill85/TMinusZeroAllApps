# Terms Deep‑Dive Review (US) — January 20, 2026 (Non‑Legal)

This is a best‑effort product review of our **Terms of Service** disclosures vs. the current repo and common US subscription (“auto‑renew”) requirements. It is **not legal advice**.

## Scope (terms only)

In scope:

- Public Terms of Service page:
  - `app/legal/terms/page.tsx`
- Related product behavior that Terms must match:
  - Signup terms checkbox: `components/AuthForm.tsx`
  - Upgrade/checkout UX copy: `components/UpgradePageContent.tsx`
  - Billing flows: `app/api/billing/*`, `components/BillingPanel.tsx`
  - Stripe webhook ingestion (subscription state): `app/api/webhooks/stripe/route.ts`
  - Account deletion (subscription cancel at period end + delete user): `app/api/me/account/delete/route.ts`
  - Tip Jar payment flow: `app/api/tipjar/checkout/route.ts`

Out of scope:

- Privacy Notice / Privacy Choices / Data Use / SMS program terms copy (except where Terms should link to them instead of duplicating content).
- TCPA/CTIA/Twilio A2P program rules (handled in the SMS Alerts section of Terms + internal checklists).
- Legal entity structuring, tax advice, and jurisdiction‑specific consumer law analysis beyond high‑level US/state subscription requirements.

## What we do today (terms‑relevant behaviors)

Based on the repo:

- The Service provides launch schedule information and related features (including embeds and calendar exports).
- Users can create accounts with email/password or third‑party OAuth sign‑in; signup requires checking a Terms + Privacy checkbox in the UI.
- We offer paid subscriptions:
  - Checkout uses a third‑party payment processor.
  - The subscription renews automatically until canceled.
  - “Cancel subscription” is self‑serve in `/account` and sets `cancel_at_period_end: true` (access remains until the end of the current paid period): `app/api/billing/cancel/route.ts`.
  - Users can also manage billing via a self‑serve billing portal: `app/api/billing/portal/route.ts`.
- We offer a “Tip Jar” as a one‑time payment (`submit_type: 'donate'`): `app/api/tipjar/checkout/route.ts`.
- We may suspend/terminate accounts for abuse; users can also delete their account (and if they have an active subscription, we set cancel‑at‑period‑end before deleting): `app/api/me/account/delete/route.ts`.
- Launch data and related content are sourced from third parties; a separate “Data Use” page provides source and attribution details.

## External requirements (US subscription / auto‑renew baseline)

This repo sells subscriptions to US consumers, so the “industry standard” baseline is:

- **Clear and conspicuous** auto‑renew terms and pricing disclosure before collecting billing info.
- **Affirmative consent** to the auto‑renew agreement.
- A **simple way to cancel** online.
- A **confirmation/acknowledgment** of the auto‑renew terms and how to cancel (required explicitly in some states).

Primary sources used for this review:

- Restore Online Shoppers’ Confidence Act (ROSCA) — 15 U.S.C. § 8403:
  - https://www.law.cornell.edu/uscode/text/15/8403
- California Automatic Renewal Law (ARL) — Cal. Bus. & Prof. Code § 17602 (online cancellation + disclosures/consent/verification expectations):
  - https://law.justia.com/codes/california/code-bpc/division-7/part-3/chapter-1/article-2/section-17602/
- Florida automatic renewal / continuous service requirements (as applicable) — Fla. Stat. § 501.165:
  - https://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.165.html
- FTC “Negative Option” rulemaking/guidance (useful compliance baseline even when court status changes):
  - https://www.ftc.gov/legal-library/browse/rules/negative-option-rule

Notes:

- State auto‑renew laws vary. We aim to meet a broadly conservative baseline without adding complex, state‑specific flows unless needed.
- This review focuses on what our **Terms and UX copy** should say, but some requirements are ultimately satisfied via **product behavior** (e.g., “easy cancellation mechanism”).

## Consolidation opportunities

To keep Terms readable and avoid contradictions, Terms should **link out** to these separate documents rather than duplicating detailed program rules:

- **Privacy**: link to `/legal/privacy` for data collection/use/disclosure details.
- **SMS**: include SMS program disclosures inside Terms (see `/legal/terms#sms-alerts`) so there is only one Terms document.
- **Data sources / attribution**: link to `/legal/data` for source lists and attribution.

## Concrete gaps found (before updating Terms)

### A) “Industry standard” sections missing or too thin

The existing Terms page was intentionally short. For a consumer SaaS, it likely needs clearer, plain‑language coverage of:

- Service description + **informational/not‑for‑safety‑critical** disclaimer (launch times change; do not rely for emergency use).
- **License to use** the Service + ownership of our content and branding.
- **User submissions** (feedback) + permission to use submitted feedback.
- **Third‑party services** and links (we rely on third parties; their terms apply; outages outside our control).
- Changes to the Service and Terms.
- **Fees / taxes / promotions**, refunds (if any), chargebacks, and what happens after cancellation.
- Disclaimers and limitation of liability phrased with “to the extent permitted by law” and consumer carve‑outs.
- Standard legal mechanics (assignment, severability, force majeure, notices).

### B) Subscription auto‑renew disclosures could be clearer

We already state “renews monthly until canceled” on the upgrade page and provide self‑serve cancellation.

However, for a more conservative baseline aligned with ROSCA/ARL expectations, Terms should explicitly clarify:

- Auto‑renew timing (“each billing period”) and that the user authorizes recurring charges until canceled.
- Cancellation timing (“cancel before renewal to avoid future charges”; cancellation takes effect at period end).
- Refund policy in plain language (e.g., “non‑refundable except as required by law”).

### C) “Tip Jar” not covered

We have a dedicated Tip Jar payment flow; Terms should clarify that tips are optional and what they do/do not provide.

## Implemented in this pass

- Expanded Terms of Service copy to a more “industry standard” structure (plain language) while staying faithful to how the repo behaves.
- Consolidated detailed SMS disclosures into the Terms page (see `/legal/terms#sms-alerts`) and kept data‑source disclosures in `/legal/data`.
