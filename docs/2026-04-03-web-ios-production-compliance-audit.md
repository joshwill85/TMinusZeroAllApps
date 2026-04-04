# Web + iOS Production Compliance Audit

Superseded by `docs/2026-04-03-web-ios-compliance-source-of-truth.md`. This file is a historical audit snapshot from before the remediation changes made on 2026-04-03.

Date: 2026-04-03

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: excluded for this pass
- Admin/internal impact: no
- Shared API/backend impact: yes
- Release target audited: production customer release only

## Audit Goal

Establish repo-truth for:

1. What the production web and iOS app currently do.
2. What Apple actually requires for iOS/App Store submission.
3. What the website should and should not say about cookies, tracking, privacy controls, support, and legal surfaces.

This document is an audit artifact, not an implementation plan. It is intended to feed the next actionable plan.

## External Requirement Sources

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Apple account deletion guidance: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Apple auto-renewable subscriptions overview: https://developer.apple.com/app-store/subscriptions/
- App Store Connect app information reference: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
- App Store Connect app privacy reference: https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy/
- Accessibility Nutrition Labels overview: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/
- Apple privacy manifest docs: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files

## Repo Evidence Reviewed

- Web privacy/legal:
  - `apps/web/app/legal/privacy/page.tsx`
  - `apps/web/app/legal/terms/page.tsx`
  - `apps/web/app/legal/privacy-choices/page.tsx`
  - `apps/web/app/legal/privacy-choices/privacy-choices-client.tsx`
  - `apps/web/lib/privacy/choices.ts`
  - `apps/web/lib/privacy/clientCookies.ts`
  - `apps/web/lib/api/supabase.ts`
  - `apps/web/lib/server/privacyPreferences.ts`
  - `apps/web/middleware.ts`
- Web embed and browser storage behavior:
  - `apps/web/components/PrivacySignals.tsx`
  - `apps/web/components/XTweetEmbed.tsx`
  - `apps/web/components/XTimelineEmbed.tsx`
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/web/app/auth/callback/AuthCallbackClient.tsx`
  - `apps/web/components/AuthForm.tsx`
  - `apps/web/components/ar/ArSession.tsx`
  - `apps/web/components/SocialReferrerDisclaimer.tsx`
  - `apps/web/components/FeedbackWidget.tsx`
  - `apps/web/components/IOSInstallPrompt.tsx`
  - `apps/web/lib/ar/runtimePolicyClient.ts`
- iOS/mobile:
  - `apps/mobile/app/(tabs)/profile.tsx`
  - `apps/mobile/app/legal/privacy.tsx`
  - `apps/mobile/app/legal/terms.tsx`
  - `apps/mobile/app/legal/privacy-choices.tsx`
  - `apps/mobile/src/components/MobileAccountDeletionPanel.tsx`
  - `apps/mobile/src/billing/useNativeBilling.ts`
  - `apps/mobile/app/sign-in.tsx`
  - `apps/mobile/src/auth/appleAuth.ts`
  - `apps/mobile/src/notifications/runtime.ts`
  - `apps/mobile/app.json`
  - `apps/mobile/eas.json`
  - `apps/mobile/ios/TMinusZero/Info.plist`
  - `apps/mobile/ios/TMinusZero/PrivacyInfo.xcprivacy`
- Existing compliance docs:
  - `docs/mobile-store-submission-checklist-2026-03-19.md`
  - `docs/app-store-connect-privacy-worksheet-2026-03-19.md`
  - `docs/mobile-store-compliance-gap-closure-plan-2026-03-19.md`

## Executive Summary

### Current high-confidence conclusions

- No current repo evidence of third-party analytics SDKs, ad SDKs, or cross-site/cross-app tracking on web or iOS production paths.
- The web app does use:
  - first-party auth/session cookies through Supabase
  - first-party privacy-preference cookies
  - localStorage/sessionStorage for auth callback, AR calibration/runtime state, UI dismissals, and install prompt state
  - optional third-party embeds from X, YouTube, and Vimeo
- The iOS app already has:
  - in-app privacy notice
  - in-app privacy choices
  - in-app terms
  - in-app account deletion initiation
  - native restore purchases
  - native App Store billing paths
- Apple does not require an About page or FAQ page.
- Accessibility Nutrition Labels are voluntary today, but Apple says they will become mandatory over time.

### Current likely gaps

- No dedicated public `/support` or `/help` route was found for the website. This is a gap for App Store Connect Support URL and for customer-facing support hygiene.
- The web privacy notice is incomplete for current production web behavior. It does not clearly disclose first-party auth cookies, browser storage, Global Privacy Control handling, or third-party embed behavior.
- The iOS Premium purchase surface appears to expose purchase and restore actions, but it does not clearly show subscription pricing/renewal/legal links adjacent to the purchase CTA.
- Production Apple sign-in posture is inconsistent:
  - docs say keep it hidden until full setup exists
  - `apps/mobile/eas.json` enables `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED=1` in all build profiles
  - Apple revocation is still a placeholder in code
- Checked-in iOS plist evidence includes Face ID and local-network/Bonjour declarations that may be dev-client residue. Production artifact verification is still required before calling that compliant.

## Requirement Matrix

| Requirement | Applies | Where it must live | Current status | Notes |
| --- | --- | --- | --- | --- |
| Public privacy policy URL | Yes | Public web URL + App Store Connect | Likely compliant | `/legal/privacy` exists on web. |
| Privacy policy easily accessible in-app | Yes | iOS native screen | Compliant | Native privacy screen exists and is reachable from Profile. |
| Public support URL | Yes | Public web URL + App Store Connect | Gap | No dedicated `/support` or `/help` route found. |
| Accurate App Privacy answers | Yes | App Store Connect | Needs external verification | Existing worksheet exists but must be re-answered from current shipped build. |
| Accurate metadata/screenshots | Yes | App Store Connect | Needs external verification | Console-side/manual evidence only. |
| In-app account deletion initiation | Yes, if app supports account creation | iOS native screen | Compliant | Native delete flow exists. |
| Restore purchases | Yes | iOS native billing/account surface | Compliant | Restore action exists on Profile/Billing surfaces. |
| Auto-renewable subscription legal clarity | Yes | iOS purchase flow + App Store metadata | Partial | Renewal language exists in terms, but purchase CTA area needs better disclosure. |
| Terms link for subscriptions | Yes in practice for subscription app | Public web URL + in-app legal | Partial | Terms pages exist, but not shown near purchase CTA. |
| Required permission purpose strings | Yes if permissions used | iOS bundle | Partial | Camera, motion, location strings exist; release plist needs verification for extra entries. |
| Privacy manifest / required-reason APIs | Yes | iOS bundle | Partial | App privacy manifest exists, but release bundle verification is still required. |
| About page | No | Optional | Not required | Existing `/about` is optional. |
| FAQ page | No | Optional | Not required | Existing FAQ is optional. |
| Marketing URL | No | Optional | Optional | Could use `/about`, but not required. |
| User Privacy Choices URL | No | Optional | Optional but useful | `/legal/privacy-choices` is a strong candidate. |
| Accessibility Nutrition Labels | Not yet mandatory | App Store Connect | Optional for now | Recommended to prepare. |

## Web Privacy and Tracking Audit

### What the production web app currently stores or emits

#### Cookies

| Cookie class | Evidence | Purpose | Current disclosure quality |
| --- | --- | --- | --- |
| Supabase auth/session cookies | `apps/web/lib/api/supabase.ts`, `apps/web/middleware.ts` | Persist signed-in session across web surfaces; production domain cookies use apex domain options | Not explicitly described in current privacy notice |
| `tmn_opt_out_sale_share` | `apps/web/lib/privacy/choices.ts`, `apps/web/app/legal/privacy-choices/privacy-choices-client.tsx` | Browser-level privacy preference | Partially disclosed on privacy choices page; not clearly disclosed in privacy notice |
| `tmn_limit_sensitive` | same as above | Browser-level privacy preference | Same gap |
| `tmn_block_third_party_embeds` | same as above | Browser-level embed blocking preference | Same gap |

Cookie attributes observed in code for first-party privacy cookies:

- `Path=/`
- `Max-Age` up to 365 days
- `SameSite=Lax`
- `Secure` when served over HTTPS

Supabase production-domain cookies are configured with:

- apex-domain scope
- `SameSite=Lax`
- `Secure=true`
- `Path=/`

#### Browser storage

| Storage | Evidence | Purpose | Tracking risk |
| --- | --- | --- | --- |
| localStorage for auth callback state | `apps/web/components/AuthForm.tsx`, `apps/web/app/auth/callback/AuthCallbackClient.tsx` | Pending premium claim token, pending profile state, post-confirm return state | First-party state, not ad tracking |
| localStorage for AR preferences/calibration | `apps/web/components/ar/ArSession.tsx` | AR release profile, calibration, wizard dismissal | First-party feature state |
| sessionStorage for AR motion/runtime policy | `apps/web/components/ar/CameraGuideButton.tsx`, `apps/web/lib/ar/runtimePolicyClient.ts` | Motion permission handoff, session cache | First-party feature state |
| localStorage for UI dismissals | `apps/web/components/SocialReferrerDisclaimer.tsx`, `apps/web/components/FeedbackWidget.tsx`, `apps/web/components/IOSInstallPrompt.tsx`, `apps/web/lib/hooks/useDismissed.ts` | Dismiss state | First-party UI state |
| debug toggles | `apps/web/components/LaunchFeed.tsx` | Debug-only client toggles | First-party debug state |

#### Third-party content and scripts

| Third-party surface | Evidence | What happens | Current user control |
| --- | --- | --- | --- |
| X embedded tweet iframe | `apps/web/components/XTweetEmbed.tsx` | Loads `platform.twitter.com/embed/Tweet.html` | Blockable via privacy preference cookie/account setting |
| X timeline script | `apps/web/components/XTimelineEmbed.tsx` | Loads `https://platform.twitter.com/widgets.js` | No dedicated site-wide disclosure beyond general privacy/legal copy |
| YouTube embedded video | `apps/web/app/launches/[id]/page.tsx` | Uses `youtube-nocookie.com/embed/...` | Blockable via privacy preference |
| Vimeo embedded video | `apps/web/app/launches/[id]/page.tsx` | Uses `player.vimeo.com/video/...` | Blockable via privacy preference |

### Tracking conclusion

- No repo evidence of GA4, GTM, Vercel Web Analytics, Speed Insights, Plausible, PostHog, Mixpanel, Amplitude, Segment, Facebook Pixel, or ATT-like tracking surfaces on the website.
- No consent banner implementation was found.
- Based on current repo evidence, the production website looks like a first-party app with:
  - essential auth/session cookies
  - optional privacy-preference cookies
  - first-party browser storage
  - optional third-party embed loading
- Current repo evidence does not support claiming ad-tech tracking, behavioral advertising, or sale/sharing activity.

### Web gaps

#### W1. Missing dedicated support surface

- No `apps/web/app/support/page.tsx` or `apps/web/app/help/page.tsx` route was found.
- Current privacy and terms pages expose a support email only.
- Impact:
  - weak Support URL target for App Store Connect
  - weak public help surface for privacy/support/contact flows

#### W2. Privacy notice is not fully accurate for current web behavior

Current privacy notice at `apps/web/app/legal/privacy/page.tsx` covers account, billing, communications, and diagnostics, but it does not clearly and explicitly describe:

- first-party auth/session cookies
- browser-stored privacy preferences
- browser localStorage/sessionStorage usage
- Global Privacy Control handling
- optional third-party embeds and what happens when they load

This is the most important web copy gap for the next implementation plan.

#### W3. No current evidence that a cookie banner is required

Given current repo evidence:

- no third-party analytics/ad SDKs
- no ad-tech trackers
- no consent-gated optional analytics surface

There is no clear current repo basis for a classic tracking-cookie banner. This should remain an audit conclusion, not a product claim, until production headers/cookies are verified in a live environment.

#### W4. Privacy choices page is more accurate than the privacy notice

The privacy choices surface already states:

- no current sale/sharing behavior
- cookies are used for browser-level privacy preferences
- GPC is honored
- third-party video embeds can be blocked

This creates a website copy mismatch: privacy choices is more precise than the main privacy notice.

## iOS and App Store Audit

### In-app surfaces that already exist

| Surface | Evidence | Status |
| --- | --- | --- |
| Native privacy notice | `apps/mobile/app/legal/privacy.tsx` | Present |
| Native privacy choices | `apps/mobile/app/legal/privacy-choices.tsx` | Present |
| Native terms | `apps/mobile/app/legal/terms.tsx` | Present |
| Native delete-account flow | `apps/mobile/app/legal/privacy-choices.tsx`, `apps/mobile/src/components/MobileAccountDeletionPanel.tsx` | Present |
| Native restore purchases | `apps/mobile/app/(tabs)/profile.tsx`, `apps/mobile/src/billing/useNativeBilling.ts` | Present |
| Native billing management | `apps/mobile/app/(tabs)/profile.tsx` | Present |
| Native support contact | support email appears in legal surfaces | Present, but email-only |

### Apple requirement audit

#### A1. Privacy policy within app

- Apple guideline `5.1.1(i)` requires a privacy policy link in App Store Connect metadata and within the app in an easily accessible manner.
- Current repo status: compliant.
- Evidence:
  - native privacy screen exists in `apps/mobile/app/legal/privacy.tsx`
  - Profile links to Privacy Notice in `apps/mobile/app/(tabs)/profile.tsx`

#### A2. Account deletion within app

- Apple requires apps that support account creation to let users initiate deletion within the app.
- Current repo status: compliant.
- Evidence:
  - delete flow exists in `apps/mobile/app/legal/privacy-choices.tsx`
  - delete panel exists in `apps/mobile/src/components/MobileAccountDeletionPanel.tsx`
  - store-billing warning copy exists for active subscriptions

#### A3. Restore purchases

- Current repo status: compliant.
- Evidence:
  - guest Premium surface exposes `Restore purchases`
  - signed-in Billing surface exposes `Restore purchases`
  - native billing hook implements `restorePurchases()`

#### A4. Subscription legal and pricing clarity

- Apple subscriptions guidance expects clear pricing/value/renewal terms before asking users to subscribe.
- Current repo status: partial.
- Evidence:
  - Terms page describes recurring subscriptions
  - Profile/Billing surfaces expose purchase and restore actions
- Gap:
  - the purchase surface in `apps/mobile/app/(tabs)/profile.tsx` does not appear to show full plan name, renewal period, actual price, cancellation language, and legal links adjacent to the purchase CTA

#### A5. Support URL

- App Store Connect requires a Support URL.
- Current repo status: gap.
- Repo evidence:
  - no dedicated public support route found on web
  - support email exists in web legal pages and native legal pages
- Impact:
  - App Store Connect can technically point to a legal page, but that is weaker than a dedicated support/help URL

#### A6. Accurate App Privacy answers

- Current repo status: needs external verification.
- Existing worksheet is useful, but must be revalidated from current shipped code and actual bundled SDKs.
- Existing worksheet correctly notes no current evidence of tracking, but it predates this audit and should not be used blindly.

#### A7. Permission purpose strings

- Current repo status: partial.
- Good:
  - `apps/mobile/app.json` includes camera, motion, and location purpose strings
- Needs verification:
  - checked-in iOS plist also includes:
    - `NSFaceIDUsageDescription`
    - `NSLocalNetworkUsageDescription`
    - Bonjour `_expo._tcp`
  - these may be development-client artifacts, but the production archive must be verified before submission

#### A8. Privacy manifests and required-reason APIs

- Current repo status: partial.
- Good:
  - app-level `PrivacyInfo.xcprivacy` exists
  - `NSPrivacyTracking=false`
  - required-reason API categories are declared
- Needs verification:
  - release bundle should be checked to ensure the final archive still reflects current required-reason API use and bundled SDK manifests
  - the manifest does not remove the need for App Store Connect privacy answers

#### A9. Sign in with Apple

- Guideline `4.8` is satisfied by Apple sign-in or an equivalent low-data login service when third-party social login is used.
- This app appears to use:
  - email/password
  - Sign in with Apple
- Current issue is not guideline `4.8`. The real issue is deletion-time revocation guidance if Apple sign-in ships.

Current repo evidence:

- `apps/mobile/eas.json` enables `EXPO_PUBLIC_MOBILE_APPLE_AUTH_ENABLED=1` for development, preview, and production
- `apps/mobile/src/auth/appleAuth.ts` still labels revocation as a placeholder:
  - `apple_revocation_not_configured`

Conclusion:

- If production builds actually ship Apple sign-in, this is a compliance risk until production Apple setup and deletion-time token revocation are confirmed.
- If production builds do not ship Apple sign-in despite `eas.json`, the build/release process needs explicit evidence for that.

### iOS gaps

#### I1. No dedicated public support page for App Store Connect

Same gap as W1.

#### I2. Purchase CTA surface needs stronger subscription disclosure

Before submission, audit and likely harden the purchase UI to show:

- actual product name
- billing period
- actual price
- auto-renew behavior
- how to cancel/manage
- terms/privacy links close to the purchase CTA

#### I3. Apple sign-in production posture is inconsistent

- Docs from 2026-03-19 say keep it hidden until full setup exists.
- Production build config currently enables it.
- Revocation remains a placeholder.

This is a decision-critical audit finding.

#### I4. Release artifact verification still required

Must verify the production archive for:

- final plist permission entries
- local-network/Bonjour residues
- Face ID declaration
- final privacy manifest composition
- final SDK inventory

This cannot be closed from repo inspection alone.

#### I5. App Store Connect metadata remains a console-side audit item

Repo cannot prove:

- screenshots
- feature descriptions
- age rating
- review notes
- demo credentials
- final App Privacy questionnaire answers

These need an external submission checklist after code/copy hardening.

## Existing Docs: Keep, But Treat As Historical

The March 19 docs are still useful, but they should no longer be treated as the single source of truth without revalidation:

- `docs/mobile-store-submission-checklist-2026-03-19.md`
- `docs/app-store-connect-privacy-worksheet-2026-03-19.md`
- `docs/mobile-store-compliance-gap-closure-plan-2026-03-19.md`

Most important stale/mismatched point:

- those docs describe Apple sign-in as hidden by default until full setup exists
- current `apps/mobile/eas.json` enables Apple auth in production config

## Decision-Ready Inputs For The Next Action Plan

The next implementation plan should focus on these items in this order:

1. Create a dedicated public support/help page for the website and App Store Connect Support URL.
2. Rewrite the web privacy notice so it accurately covers:
   - auth/session cookies
   - privacy preference cookies
   - browser localStorage/sessionStorage
   - GPC handling
   - optional third-party embeds and their privacy impact
3. Harden the iOS Premium purchase surface so subscription disclosures and legal links are visible where the user buys.
4. Resolve Apple sign-in production posture:
   - either disable it for production until complete
   - or complete production setup and deletion-time revocation evidence
5. Verify a real production iOS artifact for final plist/privacy-manifest correctness.
6. Convert this audit into an App Store Connect field-by-field submission checklist and reviewer note set.

## Audit Confidence

- High confidence:
  - no current repo evidence of third-party analytics/ad tracking
  - web uses first-party cookies plus browser storage
  - iOS already has legal, deletion, and restore-purchase surfaces
- Medium confidence:
  - App Store Connect field requirements and optional items
  - current subscription UI is probably not submission-ideal
- Low confidence without external verification:
  - final production App Store Connect answers
  - final production iOS archive plist and bundled manifest state
  - whether Apple sign-in is truly intended to ship in production right now
