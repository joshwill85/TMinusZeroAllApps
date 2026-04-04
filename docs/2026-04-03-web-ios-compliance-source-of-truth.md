# Web + iOS Compliance Source Of Truth

Date: 2026-04-03

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included only where the shared native auth/privacy shell changed
- Admin/internal impact: no
- Shared API/backend impact: yes

## Canonical Public URLs

- Support: `https://www.tminuszero.app/support`
- Privacy Policy: `https://www.tminuszero.app/legal/privacy`
- Terms of Service: `https://www.tminuszero.app/legal/terms`
- Privacy Choices: `https://www.tminuszero.app/legal/privacy-choices`

These are the public URLs to use for App Store Connect metadata and for customer-facing support/legal references.

## Customer-Facing Placement

### Web

- Footer includes Support plus legal links.
- The privacy notice is the canonical public policy and now explicitly covers:
  - auth/session cookies
  - the single optional third-party media preference cookie
  - browser localStorage/sessionStorage
  - Global Privacy Control handling
  - X, YouTube, Vimeo, and CAPTCHA third-party loading context
  - retention/deletion framing

### Mobile

- Native support screen: `/support`
- Native legal screens:
  - `/legal/privacy`
  - `/legal/terms`
  - `/legal/privacy-choices`
  - `/legal/data`
- Native privacy and terms screens include support access.
- Native privacy screen includes a direct action to open the full canonical web privacy policy.
- Mobile About/FAQ surfaces are removed from the shared native app shell.

## Cookie Position

Current repo-truth position:

- The website uses essential first-party auth/session cookies.
- The website may use one first-party preference cookie if the user chooses to always block third-party embeds.
- The website uses localStorage and sessionStorage for first-party product state.
- The website can load third-party content from X, YouTube, Vimeo, and CAPTCHA providers when the related experience is used.
- Supported X, YouTube, and Vimeo embeds now use explicit click-to-load gating by default.
- The repo currently shows no third-party ad-tech trackers, ATT/IDFA usage, or classic analytics-cookie SDKs.

Current product decision:

- Keep the privacy-policy disclosure accurate and specific.
- Keep Global Privacy Control support.
- Do not add a classic analytics/ad-tech cookie banner based on current repo behavior alone.
- Treat third-party media embeds as the main consent-sensitive area.
- Default supported third-party embeds to click-to-load.
- Keep one optional browser/account preference to always block supported third-party embeds.

Revisit immediately if any of the following are introduced:

- advertising or cross-site tracking
- analytics SDKs that change cookie/storage behavior
- sale/sharing behavior under state privacy laws
- legal guidance requiring geo-specific consent flows

## Apple Sign In: Current Repo Truth

- Web sign-in already exposes `Continue with Apple` through the Supabase OAuth path.
- iOS builds currently enable Apple sign-in capability and the production EAS profile sets `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED=1`.
- iOS sign-in uses the native Apple authentication flow and hands the identity token to Supabase.
- Apple revocation material is captured on sign-in for web and iOS, stored server-side, and required for deletion of Apple-authenticated accounts.
- The native app now monitors stored Apple credential state and clears local session state if Apple reports the credential as revoked, missing, or transferred.
- Apple sign-in now fails closed if revocation material cannot be persisted during the login flow.

This means Apple Sign In is substantially hardened in-repo, but it is not fully release-verified until the remaining live-device and account-linking checks are completed.

## Apple Sign In: Industry-Standard Completion Requirements

### 1. Shipping decision

- Either fully ship Apple Sign In and complete the items below, or disable the production feature flag until they are complete.
- If any future iOS build adds another qualifying third-party sign-in provider, keep Sign in with Apple available anywhere Apple requires parity.

### 2. Apple platform configuration

- Keep the iOS app capability enabled on the App ID.
- Keep the Services ID and return URLs aligned with the hosted auth flow.
- Maintain a rotation process for the Apple private key / client secret material.

### 3. Hosted auth configuration

- Keep Supabase Apple provider configuration aligned with both web and iOS client IDs.
- Keep production redirect allow-lists correct for:
  - `https://www.tminuszero.app/auth/callback`
  - `https://tminuszero.app/auth/callback`
  - `tminuszero://auth/...`

### 4. Account model and user experience

- Persist provider information accurately for Apple-authenticated accounts.
- Handle private relay email addresses correctly.
- Keep conflict and linking flows predictable if the same customer later uses email/password.
- The supported linking and private-relay policy is now documented in `docs/2026-04-03-apple-sign-in-linking-and-rollout-plan.md`.
- Linking and unlinking flows now exist in repo on web and mobile through `Account > Login Methods`.
- Apple Sign In is still not release-ready until the real-device verification set and production Apple configuration pass.

### 5. Deletion-time revocation

- Capture and persist the Apple auth material actually required for server-side revocation.
- Attempt Apple revocation during account deletion for Apple-authenticated users.
- Record revocation outcome for support/debugging.
- Keep deletion UX clear when revocation succeeds, fails, or is unavailable.

### 6. In-app support and legal posture

- Keep privacy and support flows easily reachable in-app.
- Keep the privacy notice accurate about provider identifiers and authentication processing.
- Keep App Review notes explicit about where Apple-authenticated users can delete accounts and what happens on deletion.

### 7. Verification

- Real-device iPhone test for first sign-in and returning sign-in
- Private relay email test
- Premium-claim path test after Apple sign-in
- Account deletion test for Apple-authenticated user
- Revoked-credential / disabled-account behavior test

## Current Recommendation

- Treat the repo implementation as hardened groundwork, not as automatically submission-ready.
- Use `docs/2026-04-03-apple-sign-in-linking-and-rollout-plan.md` as the release and verification plan for the shipped linking/unlinking flows.
- Do not ship until the remaining real-device Apple tests, Apple Developer configuration checks, and App Review notes are complete.
- If those checks fail, turn off the production Apple-auth flag and ship email/password only.

## App Store Connect Manual Items

- Support URL: `https://www.tminuszero.app/support`
- Privacy Policy URL: `https://www.tminuszero.app/legal/privacy`
- Re-answer App Privacy from the shipped build and bundled SDKs
- Keep screenshots, description, age rating, and review notes aligned with the shipped app
- Include reviewer notes for:
  - where account deletion lives
  - how to test Premium purchase and restore
  - whether Apple Sign In is shipping in this build
  - that Apple-authenticated account deletion revokes the Apple connection before deletion when the required token material is available
