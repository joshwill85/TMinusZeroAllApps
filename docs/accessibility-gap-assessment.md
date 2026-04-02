# Accessibility Gap Assessment (ADA / Section 508 / WCAG 2.1 AA+)

Date: 2026-01-10  
Project: T‑Minus Zero (Next.js)

## Scope

This assessment reviews the current codebase for conformance gaps against:

- **WCAG 2.1 Level AA** (primary technical baseline)
- **Section 508** (Revised 508 aligns to WCAG A/AA for web content; WCAG 2.1 AA generally covers 508 web criteria plus additional 2.1 requirements)
- **ADA** (legal requirement; WCAG is the typical technical yardstick used to demonstrate accessibility)

“AA+” in this document includes **best‑practice recommendations** and a short section for **WCAG 2.2 AA deltas** that commonly show up in audits.

### In-scope user flows (reviewed)

- Launch schedule/feed (`/`)
- Launch detail (`/launches/[id]`)
- Search modal (global)
- Calendar modal (global)
- Launch card actions: watch, details, share, alerts, add-to-calendar
- Auth: sign-in, sign-up, forgot/reset password (`/auth/*`)
- Account and preferences (`/account`, `/me/preferences`)
- Admin UI (`/admin`) (spot-checked patterns)
- Tip jar and footer drawers/modals

### Out of scope / limitations

This is primarily a **static code review** with limited automated linting. Full conformance validation normally also requires:

- Screen reader testing (NVDA/JAWS on Windows, VoiceOver on macOS/iOS)
- Keyboard-only walkthroughs across key flows
- Contrast measurement on rendered UI (including hover/focus/disabled states)
- Zoom/reflow testing (200–400%), mobile viewport, and high-contrast modes

## High-level strengths (what’s already solid)

- Document language set: `app/layout.tsx` uses `<html lang="en">`.
- Several decorative visuals correctly hidden: `app/layout.tsx`, `components/Starfield.tsx`, `components/CryoAtmosphere.tsx`.
- Reduced-motion support exists for key animations: `components/Starfield.tsx`, `app/globals.css`.
- Many interactive controls are native `<button>`/`<a>` elements (good baseline for keyboard support).

## Priority findings (gaps)

Severity legend:
- **Critical**: likely blocks assistive tech use and/or fails multiple SCs.
- **High**: significant barrier with clear WCAG AA impact.
- **Medium/Low**: usability gaps, partial failures, or best-practice issues.

### 1) Missing programmatic labels for form controls (Critical)

**Impact:** Screen reader users may hear “edit text” without an associated label; voice control users cannot reliably target controls; error remediation becomes much harder.  
**Where observed:**
- `components/AuthForm.tsx` (first/last name, email, password fields)
- `app/auth/forgot-password/page.tsx`
- `app/auth/reset-password/ResetPasswordClient.tsx`
- `components/TipJarModal.tsx` (custom amount input)
- `components/LaunchFeed.tsx` (filter `<select>` controls)
- `app/me/preferences/page.tsx` (several inputs/selects rely on placeholders or surrounding text)

**WCAG 2.1 SC:** 1.3.1 (Info and Relationships), 3.3.2 (Labels or Instructions), 4.1.2 (Name, Role, Value)  
**Section 508:** 502.3/503 (input assistance) and WCAG A/AA alignment.

**Recommended remediation:**
- Ensure every input/select has a **programmatic name** via:
  - `<label htmlFor="id">` + matching `id`, or
  - wrapping the input inside `<label>…<input/></label>`, or
  - `aria-label`/`aria-labelledby` only when visible labels aren’t feasible.
- For filters/toolbars, add visually-hidden labels (e.g., `sr-only`) rather than relying on placeholder text.

### 2) Custom toggle controls lack accessible names (Critical)

**Impact:** Screen readers will announce these as unlabeled buttons; users won’t know what they toggle.  
**Where observed:**
- `app/me/preferences/page.tsx` (`Toggle` component)
- `components/LaunchCard.tsx` (`AlertToggle`)
- `app/admin/page.tsx` (`Toggle`)

**WCAG 2.1 SC:** 4.1.2 (Name, Role, Value), 1.3.1  
**Best practice:** Use `role="switch"` + `aria-checked`, or a native checkbox styled as a switch.

**Recommended remediation:**
- Give the control an accessible name via `aria-labelledby` referencing the visible label text, or `aria-label`.
- Prefer the ARIA switch pattern (or native checkbox) instead of `aria-pressed` for on/off semantics.

### 3) Dialogs/modals missing required semantics + focus management (High → Critical depending on flow)

**Impact:** Modal content may not be announced as a dialog; background content remains reachable; focus can escape; “escape to close” is inconsistent; focus isn’t restored to the opener.  
**Where observed (examples):**
- `components/LaunchSearchModal.tsx` (no `role="dialog"`, no `aria-modal`, no focus trap)
- `components/LaunchCalendar.tsx` (no dialog semantics; no Escape handler)
- `components/AddToCalendarButton.tsx` (modal)
- `components/BulkCalendarExport.tsx` (modal)
- `components/TipJarModal.tsx` and `components/TipJarFooter.tsx` (modals/drawers)
- `components/DockingBay.tsx` (has `role="dialog"` but still needs `aria-modal`, focus trap/restore)

**WCAG 2.1 SC:** 2.1.1 (Keyboard), 2.4.3 (Focus Order), 2.4.7 (Focus Visible), 4.1.2 (Name, Role, Value), 1.3.1  

**Recommended remediation (standard dialog pattern):**
- Add `role="dialog"` (or `alertdialog` where appropriate) and `aria-modal="true"`.
- Provide `aria-labelledby` (and optionally `aria-describedby`) to connect title/help text.
- Implement a **focus trap** inside the dialog and **restore focus** to the triggering control on close.
- Prevent interaction with the page behind the dialog (e.g., `inert`, `aria-hidden`, or app shell “modal open” state).
- Ensure consistent Escape-to-close and outside-click-to-close behavior (if used) without breaking keyboard flow.

### 4) Color contrast risks for small text + low-contrast UI boundaries (High)

**Impact:** Text and key UI affordances may not meet AA contrast thresholds, especially on small type and subtle borders.  
**Token-level observation (approx using `app/globals.css` variables):**
- `--text-4` (`#556080`) on dark surfaces is ~**3.0–3.3:1**, which is **below 4.5:1** for normal/small text.
- `--stroke` (`rgba(234,240,255,0.08)`) and `--stroke-strong` (`rgba(234,240,255,0.14)`) blend to ~**1.2–1.5:1** against typical surfaces, creating risk for **non-text contrast** where borders indicate component boundaries.

**Where observed:** small labels using `text-text4` across `components/CommLinkHeader.tsx`, `components/DockingBay.tsx`, `components/TipJarFooter.tsx`, `components/ChronoHelixTimeline.tsx`.  
**WCAG 2.1 SC:** 1.4.3 (Contrast (Minimum)), 1.4.11 (Non-text Contrast)

**Recommended remediation:**
- Raise contrast for small “metadata” text (use `text-text3`, or adjust `--text-4` to a lighter value).
- Strengthen borders for inputs/buttons/cards where the border is the primary affordance; ensure **3:1** contrast for component boundaries and key graphical indicators.
- Add explicit focus styles (see next item) with strong contrast.

### 5) Focus visibility is inconsistent; some inputs explicitly remove outlines (High)

**Impact:** Keyboard users may lose track of focus, especially in dialogs and dense UIs.  
**Where observed:** `outline-none` inputs in `components/LaunchSearchModal.tsx`, `components/TipJarModal.tsx` (and similar patterns elsewhere).  
**WCAG 2.1 SC:** 2.4.7 (Focus Visible)

**Recommended remediation:**
- Avoid `outline-none` unless replaced with an equal/better `:focus-visible` indicator.
- Standardize focus treatment for links/buttons/inputs (e.g., a consistent ring + offset + high-contrast color).

### 6) No “skip to content” / bypass blocks mechanism (Medium)

**Impact:** Keyboard and screen reader users must traverse persistent chrome (rail/dock/header) on every route.  
**Where observed:** no skip link pattern in `app/layout.tsx` or shared chrome.  
**WCAG 2.1 SC:** 2.4.1 (Bypass Blocks)

**Recommended remediation:**
- Add a visible-on-focus “Skip to main content” link at the top of the DOM.
- Ensure a consistent main landmark/target (`<main id="main-content">…`).

### 7) CAPTCHA accessibility and alternatives (Medium → High depending on enforcement)

**Impact:** CAPTCHA can block users with disabilities if there isn’t an accessible alternative path.  
**Where observed:** `components/CaptchaWidget.tsx` (Turnstile/hCaptcha).  
**WCAG 2.1 SC:** commonly 1.1.1 and 2.1.1; also usability implications under 3.3.1/3.3.3 depending on failure handling.

**Recommended remediation:**
- Provide an accessible alternative verification path (email link, magic link, passkey, rate limiting, or server-side risk scoring) so CAPTCHA is not a hard gate.
- Ensure the CAPTCHA iframe has appropriate titles (vendor-dependent) and document the supported accessibility modes.

### 8) Auto-refreshing/live-updating pages may need user control (Medium; validate with UX testing)

**Impact:** Content updates can interrupt reading, move content under focus, or create cognitive load.  
**Where observed:** `components/LaunchDetailAutoRefresh.tsx` and live feed refresh behavior.  
**WCAG 2.1 SC:** 2.2.2 (Pause, Stop, Hide) is a potential concern for auto-updating information (confirm via real behavior).

**Recommended remediation:**
- Consider a user-facing “Pause live updates” control and/or reduce update frequency while the user is interacting with controls.

## Outside-of-requirements recommendations (“AA+”)

- **WCAG 2.2 AA deltas to consider** (not strictly 2.1, but commonly requested):
  - 2.4.11 Focus Appearance (Minimum): ensure focus indicator size/contrast meets the newer bar.
  - 2.4.12 Focus Not Obscured (Minimum): ensure sticky headers/docks don’t cover focused elements.
  - 2.5.7 Dragging Movements: ensure drag-based UI (e.g., timelines) also works with simple clicks/buttons.
- **External links opening new tabs:** Consider indicating “opens in a new tab” (AAA in WCAG 2.1, but good UX).
- **Accessibility statement + feedback channel:** Add a public statement and contact method for accessibility issues (often helpful for ADA risk management).
- **Regression tooling:** Re-enable `eslint-plugin-jsx-a11y` rules (currently disabled via `.eslintrc.json`) and consider adding axe checks in dev/test builds for critical flows.

## Suggested remediation sequence (practical)

1. Fix form labeling and toggle naming patterns (high ROI, broad impact).
2. Implement a single, reusable accessible dialog component and migrate all modals/drawers.
3. Standardize focus-visible styling and address text/border contrast tokens.
4. Add skip link + consistent `<main>` landmark.
5. Review CAPTCHA fallback path and auto-update controls.
