# Front Page Premium Value Surfaces (Non‑Intrusive) — Implementation Checklist

Last updated: 2026-01-25

Goal: make Premium value obvious without degrading the Free experience (no popups, no nagging, clear dismiss/TTL behavior).

## Audience tiers (product truth)

- **Anon**: not signed in.
- **Free**: signed in, not Premium.
- **Premium**: paid subscription (or admin).

## Guardrails (non‑negotiable)

- No auto popups. All prompts are inline, lightweight, and dismissible with TTL.
- Avoid retired alert-channel marketing language. New upsell surfaces should describe alerts as **native mobile push notifications**.
- Weather positioning: **NWS forecast is available to everyone** when available; Premium adds **enhanced forecast insights (select launches)**. Do not market the provider name.
- No new tracking pixels or third‑party calls for these prompts. Local persistence is via `localStorage` only.

---

## 10 front‑page implementations (mapped to components)

### 1) “Data freshness” status card (mission‑control framing)

- **Where**: `components/LaunchFeed.tsx`
- **Who sees it**: anon + free + premium
- **What it does**
  - Explains the user’s current mode (Public snapshot / Free cache / Live).
  - Shows last/next refresh timing when available.
  - Provides one primary action:
    - anon → “Sign in for free”
    - free → “Go live (Premium)”
    - premium → “Premium active” state chip
- **Persistence**
  - Collapsible; state stored in `localStorage` (`HOME_UPSELL_KEYS.freshnessCollapsed`).

### 2) “Premium unlocks” compact panel (feature discovery, no hard sell)

- **Where**: `components/LaunchFeed.tsx`
- **Who sees it**: free only (keeps anon landing page clean)
- **What it does**
  - One‑line “unlocks” summary in plain language (Live / Change log / Alerts / My Launches / Private feeds).
  - Expand reveals small “try it” buttons that open the shared upsell modal with context.
- **Persistence**
  - Expand/collapse stored (`HOME_UPSELL_KEYS.unlocksExpanded`).
  - Dismiss “Hide” with TTL (`HOME_UPSELL_KEYS.unlocksDismissedAt`, 14 days).

### 3) “Recently changed (24h)” teaser (value demonstration)

- **Where**: `components/LaunchFeed.tsx`
- **Who sees it**: free only
- **What it does**
  - Shows example “scrub/time shift/status update” items as proof of value.
  - CTA opens the upsell modal (context: change log).
- **Persistence**
  - Dismiss with TTL (`HOME_UPSELL_KEYS.recentlyChangedDismissedAt`, 7 days).

### 4) Locked “My Launches” feed control (affordance + clarity)

- **Where**: `components/LaunchFeed.tsx`
- **Who sees it**: free only (Premium sees the working control)
- **What it does**
  - Shows the control but routes through `PremiumGateButton` so users understand it exists.
  - CTA opens upsell modal with context (“My Launches”).

### 5) Locked “Save view” button (premium benefit made tangible)

- **Where**: `components/LaunchFeed.tsx`
- **Who sees it**: free only (Premium sees “Save preset”)
- **What it does**
  - Uses `PremiumGateButton` to surface “saved views” as a real workflow upgrade.

### 6) Alerts nudge on the next upcoming launch (micro‑CTA, not a popup)

- **Where**: `components/LaunchFeed.tsx` → props into `components/LaunchCard.tsx`
- **Who sees it**: anon + free (not premium), on the next upcoming launch only
- **What it does**
  - Temporarily labels the alerts bell as “Alerts” to reduce icon ambiguity and prompt setup.
  - Click opens the existing alerts panel. New copy uses native push language.
- **Persistence**
  - Dismissed on click with TTL (`HOME_UPSELL_KEYS.alertsNudgeDismissedAt`, 7 days).

### 7) “Integrations” label near feeds/exports (organizes value)

- **Where**: `components/LaunchFeed.tsx`
- **Who sees it**: all tiers (label only)
- **What it does**
  - Groups the calendar/RSS/embed affordances so the feature cluster is noticeable without adding another upsell card.

### 8) Single shared upsell modal (consistent, subtle conversion path)

- **Where**: `components/PremiumUpsellModal.tsx` (invoked from `components/LaunchFeed.tsx`)
- **Who sees it**: triggered by free users’ “try it” actions (and optionally anon flows)
- **What it does**
  - Uses `featureLabel` to contextualize “why Premium” without shouting.
  - Copy intentionally describes alerts as **native mobile push notifications**.

### 9) Premium entry in DockingBay manifest (always discoverable, not pushy)

- **Where**: `components/SiteChrome.tsx`, `components/DockingBay.tsx`
- **Who sees it**: anon + free
- **What it does**
  - Adds “Premium · $3.99/mo” to the manifest sitemap list so users can always find the upgrade path without UI clutter.

### 10) Weather messaging alignment (NWS for all, Premium adds enhanced insights)

- **Where**
  - `components/PremiumUpsellModal.tsx`
  - `components/UpgradePageContent.tsx`
  - `components/SignUpPanel.tsx`
  - `app/launches/[id]/page.tsx` (weather section description)
  - `components/Ws45ForecastPanel.tsx` (user‑facing header copy)
- **Who sees it**: all tiers (copy), with Premium gating only on the enhanced layer
- **What it does**
  - Ensures users understand: “You already get NWS; Premium adds deeper launch weather brief on select launches.”

---

## Compliance / privacy notes

- These front‑page surfaces use `localStorage` only for UX state (collapse/dismiss TTL) and do not introduce new data collection.
- Launch notifications are native mobile push only. Keep front-page copy aligned with the push-only legal and account language.
- No changes required to `legal/*` pages from these UI-only prompts unless notification policy changes again.

## Quick QA checklist (manual)

- As **anon** on `/`: confirm only Data freshness + sign-in banner + DockingBay Premium link (no heavy upsell stack).
- As **free** on `/`: confirm unlocks card, why-premium card behavior, recently-changed teaser, locked controls, alerts nudge.
- As **premium** on `/`: confirm no upgrade prompts, live mode text, and premium-only controls are enabled.
- Confirm new upsell surfaces use push-only language and do **not** mention the enhanced forecast provider name.
