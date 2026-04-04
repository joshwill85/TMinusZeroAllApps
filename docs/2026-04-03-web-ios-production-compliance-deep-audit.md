# Web + iOS Production Compliance Deep Audit

Superseded by `docs/2026-04-03-web-ios-compliance-source-of-truth.md`. This file is a historical audit snapshot from before the remediation changes made on 2026-04-03.

Date: 2026-04-03

Audited document: `docs/2026-04-03-web-ios-production-compliance-audit.md`

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: excluded for this pass because the request is Apple submission plus public web compliance
- Admin/internal impact: no
- Shared API/backend impact: yes
- Release target audited: production customer release only

## What This Document Does

This is a second-pass validation audit. It does not assume the first audit is correct. It checks the earlier audit against the repo, corrects anything that is too generous or too vague, and turns the findings into a decision-ready input for the next implementation plan.

## Evidence Standard

- `Compliant`: strong repo evidence supports the requirement as implemented.
- `Partial`: the repo has part of the requirement, but not enough to call it safe for review.
- `Gap`: missing or clearly under-implemented.
- `Verify`: cannot be closed from repo inspection alone; needs App Store Connect or a real release artifact.

## Apple Sources Re-Checked

- App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Offering account deletion in your app: https://developer.apple.com/support/offering-account-deletion-in-your-app/
- Auto-renewable subscriptions: https://developer.apple.com/app-store/subscriptions/
- App Store Connect platform version information: https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/
- App privacy in App Store Connect: https://developer.apple.com/help/app-store-connect/reference/app-information/app-privacy/
- Accessibility Nutrition Labels overview: https://developer.apple.com/help/app-store-connect/manage-app-accessibility/overview-of-accessibility-nutrition-labels/
- Privacy manifest files: https://developer.apple.com/documentation/bundleresources/privacy-manifest-files

## Section-By-Section Validation Of The Existing Audit

### 1. Scope, Goal, and Source List

Verdict: accurate.

The original audit scoped the work correctly to customer-facing web plus iOS and used the right Apple source set.

### 2. Executive Summary

| Original conclusion | Audited verdict | Evidence | Auditor note |
| --- | --- | --- | --- |
| No current repo evidence of third-party analytics SDKs, ad SDKs, or cross-site/cross-app tracking | Accurate | Targeted dependency/code searches returned no hits for `@vercel/analytics`, `@vercel/speed-insights`, `posthog-js`, `mixpanel-browser`, `@amplitude/*`, `@segment/*`, `@sentry/*`, `react-native-fbsdk-next`, `appsflyer`, `adjust`, `ATTrackingManager`, `AppTrackingTransparency`, `NSUserTrackingUsageDescription`, `IDFA`, `ASIdentifierManager` | Good negative-evidence conclusion. This does not prove a live production deployment never adds scripts, but it is the correct repo-truth statement. |
| Web uses first-party auth/session cookies | Accurate | `apps/web/lib/api/supabase.ts:24-36` | These should be disclosed explicitly in the privacy notice. |
| Web uses first-party privacy-preference cookies | Accurate | `apps/web/lib/privacy/choices.ts:1-5`, `apps/web/lib/privacy/clientCookies.ts:13-25` | These are described on the privacy-choices page but not clearly in the main privacy notice. |
| Web uses localStorage/sessionStorage | Accurate | `apps/web/app/auth/callback/AuthCallbackClient.tsx:79-151`, `apps/web/components/ar/ArSession.tsx:412-419`, `apps/web/lib/ar/runtimePolicyClient.ts:21-36`, `apps/web/components/IOSInstallPrompt.tsx:22-43`, `apps/web/components/FeedbackWidget.tsx:288-297`, `apps/web/components/SocialReferrerDisclaimer.tsx:17-29`, `apps/web/components/LaunchFeed.tsx:134,675-676` | The earlier audit was correct, but the storage list should be treated as policy-relevant, not implementation trivia. |
| Web uses optional third-party embeds from X, YouTube, and Vimeo | Accurate | `apps/web/components/XTweetEmbed.tsx:31-40,53-60`, `apps/web/components/XTimelineEmbed.tsx:149-154`, `apps/web/app/launches/[id]/page.tsx:2899-2915,2942-2958,2982-2998`, `apps/web/app/launches/[id]/page.tsx:6723-6742` | This matters for both privacy copy and user controls. |
| iOS already has in-app privacy, privacy choices, terms, account deletion, restore purchases, and native billing paths | Mostly accurate | `apps/mobile/app/legal/privacy.tsx:5-57`, `apps/mobile/app/legal/privacy-choices.tsx:142-259`, `apps/mobile/app/legal/terms.tsx:5-64`, `apps/mobile/src/components/MobileAccountDeletionPanel.tsx:61-163`, `apps/mobile/app/(tabs)/profile.tsx:356-370,554-585` | Correct at a surface-presence level. The deeper issue is quality and Apple-specific placement. |
| Apple does not require About or FAQ pages | Accurate | Apple docs reviewed; repo already has optional pages at `apps/web/app/about/page.tsx` and `apps/web/app/docs/faq/page.tsx` | Do not build these for Apple compliance. |
| Accessibility Nutrition Labels are voluntary today | Accurate | Apple docs reviewed on 2026-04-03 | Prepare later, but do not treat as a current blocker. |
| No dedicated public `/support` or `/help` route was found | Accurate | Route search returned `about`, `faq`, and `legal` routes only; no support/help route exists | This is a real gap. |
| Web privacy notice is incomplete | Accurate and understated | `apps/web/app/legal/privacy/page.tsx:17-103` plus repo behavior listed below | This is the main web-policy gap. |
| iOS Premium purchase surface does not clearly show pricing/renewal/legal links adjacent to CTA | Accurate | `apps/mobile/app/(tabs)/profile.tsx:287-381,554-585`, `packages/contracts/src/index.ts:1982-1994`, `apps/web/lib/server/billingCore.ts:144-154` | High-risk review item. |
| Apple sign-in posture is inconsistent | Accurate | `apps/mobile/eas.json:22-27`, `apps/mobile/app.json:10-20`, `apps/mobile/app/sign-in.tsx:64-82,252-269`, `apps/mobile/src/auth/appleAuth.ts:24-30,82-89`, `apps/mobile/src/auth/supabaseAuth.ts:382-412` | This is one of the most important decision points in the entire audit. |
| Checked-in iOS plist evidence may include dev-client residue | Accurate | `apps/mobile/ios/TMinusZero/Info.plist:53-65`, `apps/mobile/ios/TMinusZero.xcodeproj/project.pbxproj:246-301`, `apps/mobile/package.json:46`, `apps/mobile/ios/Podfile.lock` search hits | Needs real release-archive verification. |

### 3. Requirement Matrix

The earlier matrix was directionally correct, but one item was too generous.

| Requirement | Original verdict | Audited verdict | Evidence | Correction |
| --- | --- | --- | --- | --- |
| Public privacy policy URL | Likely compliant | Repo-ready, console verify | `apps/web/app/legal/privacy/page.tsx:4-8` | The route exists and is canonical. App Store Connect still must point to it. |
| Privacy policy easily accessible in-app | Compliant | Partial | `apps/mobile/app/legal/privacy.tsx:5-57`, `apps/mobile/app/(tabs)/profile.tsx:600-602` | Apple asks for a privacy policy link within the app. The repo shows a native summary screen, not evidence of a link to the canonical public privacy-policy URL. |
| Public support URL | Gap | Gap | no `apps/web/app/support/page.tsx` or `apps/web/app/help/page.tsx`; route search confirms absence | No correction. |
| Accurate App Privacy answers | Needs external verification | Verify | existing worksheet plus current code | No correction. |
| Accurate metadata/screenshots | Needs external verification | Verify | App Store Connect-only | No correction. |
| In-app account deletion initiation | Compliant | Compliant | `apps/mobile/app/legal/privacy-choices.tsx:225-247`, `apps/mobile/src/components/MobileAccountDeletionPanel.tsx:79-157` | No correction. |
| Restore purchases | Compliant | Compliant | `apps/mobile/app/(tabs)/profile.tsx:363-370,575-584`, `apps/mobile/src/billing/useNativeBilling.ts:243-267` | No correction. |
| Auto-renewable subscription legal clarity | Partial | Partial, high-risk | `apps/mobile/app/(tabs)/profile.tsx:287-381,554-585` | No correction. This is still a real gap. |
| Terms link for subscriptions | Partial | Partial, high-risk | `apps/web/app/legal/terms/page.tsx:39-41`; native billing surfaces do not place terms/privacy near purchase CTA | No correction. |
| Required permission purpose strings | Partial | Partial, verify | `apps/mobile/app.json:15-20`, `apps/mobile/ios/TMinusZero/Info.plist:60-69` | No correction. |
| Privacy manifest / required-reason APIs | Partial | Partial, verify | `apps/mobile/ios/TMinusZero/PrivacyInfo.xcprivacy:5-46` | No correction. |
| About page | Not required | Accurate | Apple docs reviewed | No correction. |
| FAQ page | Not required | Accurate | Apple docs reviewed | No correction. |
| Marketing URL | Optional | Accurate | Apple docs reviewed | No correction. |
| User Privacy Choices URL | Optional but useful | Accurate | `apps/web/app/legal/privacy-choices/page.tsx` exists | Strong optional field. |
| Accessibility Nutrition Labels | Optional for now | Accurate | Apple docs reviewed | No correction. |

### 4. Web Privacy and Tracking Audit

The earlier web section is materially correct, but it should be sharpened in four places.

#### 4.1 Cookies

Accurate.

- Supabase auth/session cookies are configured in `apps/web/lib/api/supabase.ts:24-36`.
- Privacy-preference cookies are defined in `apps/web/lib/privacy/choices.ts:1-5`.
- Their browser attributes are set in `apps/web/lib/privacy/clientCookies.ts:13-25` with `Path=/`, `Max-Age`, `SameSite=Lax`, and `Secure` on HTTPS.

What the original audit understated:

- These are not minor implementation details. They are core public-policy content and should be named in the website privacy notice.

#### 4.2 Browser storage

Accurate.

Representative evidence:

- auth callback state: `apps/web/app/auth/callback/AuthCallbackClient.tsx:79-151`
- premium claim state: `apps/web/components/AuthForm.tsx:250-252`
- AR runtime/calibration state: `apps/web/components/ar/ArSession.tsx:412-419,1634-1636,1952-2063,2180-2183,2836-2839`
- session cache for AR policy: `apps/web/lib/ar/runtimePolicyClient.ts:21-36`
- dismissal state: `apps/web/components/FeedbackWidget.tsx:288-297`, `apps/web/components/SocialReferrerDisclaimer.tsx:17-29`, `apps/web/components/IOSInstallPrompt.tsx:22-43`
- debug toggles: `apps/web/components/LaunchFeed.tsx:134,675-676`

Correction to the earlier audit:

- The earlier document was correct that this is first-party state, not ad-tech tracking.
- It was not explicit enough that the current privacy notice does not mention this storage at all.

#### 4.3 Global Privacy Control

Accurate but should be elevated in importance.

- browser-side GPC detection: `apps/web/app/legal/privacy-choices/privacy-choices-client.tsx:21-24,113-117,215-218`
- server-side GPC header handling: `apps/web/lib/server/privacyPreferences.ts:25-30,38,53-63`
- global cookie/account promotion behavior: `apps/web/components/PrivacySignals.tsx:28-35,37-68`

This is not just a UI preference. It is a disclosed privacy-control behavior and should be called out in the main privacy notice.

#### 4.4 Third-party content and scripts

Accurate, but the earlier audit omitted CAPTCHA script loading.

Confirmed third-party surfaces:

- X tweet iframe: `apps/web/components/XTweetEmbed.tsx:31-40,53-60`
- X widgets script: `apps/web/components/XTimelineEmbed.tsx:149-154`
- YouTube embed: `apps/web/app/launches/[id]/page.tsx:6723-6734`
- Vimeo embed: `apps/web/app/launches/[id]/page.tsx:6736-6742`
- Turnstile or hCaptcha scripts when configured: `apps/web/components/CaptchaWidget.tsx:44-47,103-107`, mounted from `apps/web/components/AuthForm.tsx:391-398`

Correction to the earlier audit:

- The privacy notice lists CAPTCHA providers as processors in `apps/web/app/legal/privacy/page.tsx:91-93`.
- It does not make clear that client-side third-party scripts can be loaded when CAPTCHA is enabled.

#### 4.5 Support route

Accurate.

Route search output shows:

- `apps/web/app/legal/privacy-choices/page.tsx`
- `apps/web/app/legal/data/page.tsx`
- `apps/web/app/legal/terms/page.tsx`
- `apps/web/app/docs/about/page.tsx`
- `apps/web/app/legal/privacy/page.tsx`
- `apps/web/app/docs/faq/page.tsx`
- `apps/web/app/about/page.tsx`

No `support` or `help` route is present.

#### 4.6 Privacy notice quality

Accurate, and still understated.

Current privacy notice content is in `apps/web/app/legal/privacy/page.tsx:17-103`.

What it does cover:

- account data
- push registration data
- preferences
- billing state
- communications
- email preferences
- automatic data
- processor/vendor categories

What it does not clearly cover:

- essential auth/session cookies
- privacy-preference cookies
- localStorage/sessionStorage
- GPC handling
- X/YouTube/Vimeo/CAPTCHA client-side loading behavior
- retention/deletion framing
- how users revoke consent or change privacy choices beyond a simple link

Targeted word search confirms the gap:

- the only hit for `retain|retention|delete|deletion|consent|cookie|localStorage|sessionStorage|Global Privacy Control|GPC|YouTube|Vimeo|X|Twitter` in the privacy page is the delete-account sentence at line 25.

#### 4.7 Cookie banner conclusion

The earlier audit is directionally correct but needs careful wording.

Repo-truth conclusion:

- there is no current source/dependency evidence of ad-tech tracking or analytics SDKs
- there is no cookie-consent/banner implementation in the repo
- the current repo does not justify adding a classic ad-tech consent banner purely for Apple or for repo-truth accuracy

Auditor caveat:

- this is not a universal legal opinion for every jurisdiction
- it is a repo-backed product conclusion that the current codebase does not look like an ad-tech or ATT-style tracking implementation

#### 4.8 Privacy choices copy mismatch

The earlier audit found this. It is real.

- web label says `Block third-party video embeds (YouTube/Vimeo)` in `apps/web/app/legal/privacy-choices/privacy-choices-client.tsx:247-258`
- the same preference also blocks X embeds on launch pages in `apps/web/app/launches/[id]/page.tsx:2899-2915,2942-2958,2982-2998`
- mobile wording is broader and more accurate: `Block third-party embeds` in `apps/mobile/app/legal/privacy-choices.tsx:191-199`

Conclusion:

- web privacy-choices copy is narrower than actual behavior
- mobile copy is the better wording

### 5. iOS and App Store Audit

The earlier iOS section is strong on surface presence but too soft on Apple placement and review quality.

#### 5.1 In-app legal surfaces

Present:

- privacy notice: `apps/mobile/app/legal/privacy.tsx:5-57`
- terms: `apps/mobile/app/legal/terms.tsx:5-64`
- privacy choices: `apps/mobile/app/legal/privacy-choices.tsx:142-259`
- profile navigation to legal surfaces: `apps/mobile/app/(tabs)/profile.tsx:596-603`

Correction to the earlier audit:

- presence is not the whole test
- Apple asks for a privacy policy link within the app
- the current native privacy screen is a summary screen with native route actions, not evidence of a link to the canonical public privacy-policy URL used in App Store Connect

Audited verdict:

- privacy-policy-within-app: `Partial`, not `Compliant`

#### 5.2 Account deletion

Compliant and strong.

Evidence:

- privacy-choices delete panel: `apps/mobile/app/legal/privacy-choices.tsx:225-247`
- richer profile deletion panel: `apps/mobile/src/components/MobileAccountDeletionPanel.tsx:79-157`

What is good here:

- explains first-party data deletion
- explains residual legal/security/processor records
- handles active store subscriptions with explicit store-management guidance
- requires typed `DELETE`

This is one of the cleaner App Review-facing parts of the app.

#### 5.3 Restore purchases

Compliant.

Evidence:

- guest surface: `apps/mobile/app/(tabs)/profile.tsx:356-370`
- signed-in surface: `apps/mobile/app/(tabs)/profile.tsx:575-584`
- hook implementation: `apps/mobile/src/billing/useNativeBilling.ts:243-267`

No correction to the earlier audit.

#### 5.4 Subscription pricing, renewal, and legal clarity

Partial, and this is likely the single clearest in-app review risk.

What exists:

- purchase CTA and restore action on the guest profile surface: `apps/mobile/app/(tabs)/profile.tsx:287-381`
- purchase/manage/restore on the signed-in billing surface: `apps/mobile/app/(tabs)/profile.tsx:554-585`
- generic billing copy in `buildBillingMessage`: `apps/mobile/app/(tabs)/profile.tsx:690-704`
- product data already exists in shared contracts: `packages/contracts/src/index.ts:1982-1994`
- current configured product defaults include `Premium Monthly` and `$3.99/mo`: `apps/web/lib/server/billingCore.ts:144-154`

What is missing near the purchase CTA:

- concrete product name
- concrete price label
- explicit billing cadence
- explicit auto-renew wording
- clear manage/cancel wording before purchase
- terms and privacy links adjacent to the purchase action

Reviewer view:

- a reviewer can see that the app sells a subscription
- the point-of-purchase surface still looks lighter than Apple’s preferred clarity bar

#### 5.5 Support URL and support contact

Support contact exists, but Support URL does not.

Evidence:

- native contact is email-only in `apps/mobile/src/features/account/LegalSummaryScreen.tsx:83`
- support email constant: `apps/mobile/src/features/account/constants.ts:1-2`
- web legal pages expose support email in `apps/web/app/legal/privacy/page.tsx:96-103` and `apps/web/app/legal/terms/page.tsx:51-58`
- no support/help route exists on web

Audited verdict:

- App Store Connect Support URL: `Gap`
- in-app support/contact discoverability: `Present but weak`

#### 5.6 Sign in with Apple

This is not a theoretical issue. The repo currently looks like production shipping intent, while revocation remains unfinished.

Shipping evidence:

- app config enables Apple sign-in capability: `apps/mobile/app.json:10-20`
- production EAS env enables the feature flag: `apps/mobile/eas.json:22-27`
- sign-in screen checks availability and shows the Apple button: `apps/mobile/app/sign-in.tsx:64-82,252-269`
- auth flow signs in with Apple via Supabase: `apps/mobile/src/auth/supabaseAuth.ts:382-412`

Unfinished evidence:

- revocation capture is a placeholder: `apps/mobile/src/auth/appleAuth.ts:82-89`
- sign-in completion still calls the placeholder: `apps/mobile/src/auth/supabaseAuth.ts:407-410`

Older docs now drift from repo truth:

- `docs/mobile-store-submission-checklist-2026-03-19.md:20,65-70`
- `docs/app-store-connect-privacy-worksheet-2026-03-19.md:85-88`
- `docs/mobile-store-compliance-gap-closure-plan-2026-03-19.md:21,64-69,110-114`

Audited conclusion:

- if Apple sign-in is intended to ship in production, the current repo is not cleanly finished from a compliance and reviewer-confidence standpoint
- if Apple sign-in is not intended to ship yet, the production config is wrong and the older docs are describing a state that no longer matches the repo

#### 5.7 Permission strings and plist hygiene

Partial, verify.

Good:

- app.json includes camera, motion, and location purpose strings: `apps/mobile/app.json:15-20`

Needs attention:

- checked-in plist includes `NSFaceIDUsageDescription` with no current code evidence of Face ID or local-auth usage: `apps/mobile/ios/TMinusZero/Info.plist:62-63`
- checked-in plist includes local-network and Bonjour keys that look tied to Expo dev tooling: `apps/mobile/ios/TMinusZero/Info.plist:53-65`
- no non-iOS-source hit was found for `LocalAuthentication|FaceID|biometric` under `apps/mobile`

Release-mitigation evidence exists:

- there is a release strip phase for Expo dev-launcher local-network keys in `apps/mobile/ios/TMinusZero.xcodeproj/project.pbxproj:246-258`

Why this is still not closed:

- Expo dev-client and related pods are still present in the dependency graph and pod resources:
  - `apps/mobile/package.json:46`
  - `apps/mobile/ios/Podfile.lock` search hits for `expo-dev-client`, `expo-dev-launcher`, and `expo-dev-menu`
  - resource copy phase includes `EXDevLauncher.bundle` and `EXDevMenu.bundle` in `apps/mobile/ios/TMinusZero.xcodeproj/project.pbxproj:266-297`

Audited verdict:

- do not call this compliant until a real release archive is inspected

#### 5.8 Privacy manifest and SDK manifests

Partial, verify.

Evidence:

- app privacy manifest exists: `apps/mobile/ios/TMinusZero/PrivacyInfo.xcprivacy:5-46`
- `NSPrivacyTracking=false`
- required-reason API categories are declared

Why this is still open:

- pod privacy bundles are copied into the app build in `apps/mobile/ios/TMinusZero.xcodeproj/project.pbxproj:266-297`
- App Store Connect privacy answers still need to reflect final bundled SDK behavior and actual collected data

The earlier audit was correct here.

#### 5.9 Legal copy drift across surfaces

The earlier audit did not emphasize this enough.

Current dates:

- web privacy notice: `Last updated: March 19, 2026` in `apps/web/app/legal/privacy/page.tsx:14`
- web terms: `Last updated: March 19, 2026` in `apps/web/app/legal/terms/page.tsx:14`
- mobile privacy notice: `Jan 20, 2026` in `apps/mobile/app/legal/privacy.tsx:10`
- mobile terms: `Jan 30, 2026` in `apps/mobile/app/legal/terms.tsx:10`

Auditor note:

- this is not an automatic rejection
- it is exactly the kind of cross-surface drift that makes reviewers and users wonder which copy is canonical

## Surface Map: What Lives Where

### Public web

- `Privacy Policy URL`: should be `https://www.tminuszero.app/legal/privacy`
- `Terms URL`: should be `https://www.tminuszero.app/legal/terms`
- `Support URL`: should be a new `https://www.tminuszero.app/support`
- `User Privacy Choices URL`: optional, strong candidate is `https://www.tminuszero.app/legal/privacy-choices`
- `About` and `FAQ`: optional, not compliance-required

### In-app iOS

- `Profile -> Privacy Policy`: should open the canonical privacy policy or host the full canonical policy natively
- `Profile -> Terms`: should remain easily reachable
- `Profile -> Privacy Choices`: should remain easily reachable
- `Profile -> Billing`: should show product name, price, renewal, manage/cancel, restore, and terms/privacy links near purchase
- `Profile -> Delete Account`: already present and strong
- `Profile -> Support`: currently email-only; stronger if it opens support/help directly

### App Store Connect

- `Privacy Policy URL`: required
- `Support URL`: required
- `App Privacy`: required, must match shipped build and bundled SDKs
- `Description/screenshots/previews`: required, must accurately match the app
- `Review notes/demo credentials`: required when review cannot complete without them
- `User Privacy Choices URL`: optional but useful
- `Accessibility Nutrition Labels`: optional for now

### iOS bundle / archive

- `Info.plist` permission strings
- entitlements and Apple sign-in capability if shipped
- app privacy manifest plus bundled SDK manifests
- final release-archive contents after build-phase stripping

## Ranked Findings

### High severity

1. No dedicated public Support URL exists.
2. The public privacy notice is materially incomplete for the website’s actual cookie, storage, GPC, and third-party embed behavior.
3. The in-app privacy-policy requirement should be treated as partial, not complete, because the repo shows a native summary screen rather than a clear privacy-policy link to the canonical public URL.
4. The subscription purchase surface does not show enough concrete billing/legal disclosure near the purchase CTA.
5. Apple sign-in production posture is inconsistent with the current code and with the older docs.

### Medium severity

1. Web privacy-choices copy is narrower than actual behavior because it says YouTube/Vimeo while also blocking X embeds.
2. Legal copy and update dates drift across web and mobile.
3. Face ID usage text appears in the checked-in plist with no repo evidence of Face ID use.
4. Expo dev-client/dev-launcher residue is still in the dependency graph and release verification is mandatory.
5. In-app support/contact is present but weak and email-only.

### Lower severity / verify-only

1. App Store Connect privacy answers, screenshots, review notes, and demo credentials remain manual verification items.
2. Accessibility Nutrition Labels are optional today.
3. No current repo basis exists for a classic analytics-cookie banner, ATT prompt, or ad-tech tracking disclosure.

## Action Framing For The Next Plan

### Remove

- If Apple sign-in is not ready to ship, disable it for production rather than shipping a half-finished path.
- Remove unused Face ID permission text if there is truly no Face ID or biometric feature.
- Remove any remaining production-visible dev-launcher residue if release-archive inspection shows leakage.

### Enhance

- Rewrite the public privacy policy so it accurately covers:
  - auth/session cookies
  - privacy-preference cookies
  - localStorage/sessionStorage
  - GPC handling
  - X/YouTube/Vimeo embeds
  - CAPTCHA script loading when enabled
  - retention/deletion framing
  - how users change privacy choices or request deletion
- Strengthen the native purchase surfaces with explicit plan/price/renewal/legal text at the purchase point.
- Make support/contact more usable on both web and iOS.
- Align legal copy dates and canonical language across web and mobile.

### Move

- Move the canonical privacy-policy experience toward a single source of truth.
- Move purchase-law/terms links closer to the purchase CTA.
- Move support information out of legal-only pages into a dedicated help/support surface.

### Place

- Place a dedicated `/support` route on web and use it as the App Store Connect Support URL.
- Place a clear privacy-policy link inside the iOS app that points to the same policy submitted in App Store Connect.
- Place terms and privacy links directly on or immediately adjacent to the subscription purchase panel.
- Place deletion instructions and billing-test notes in App Review notes for submission.

### Verify

- Build and inspect a real production iOS archive for final plist keys, entitlements, bundled SDK resources, and privacy manifests.
- Re-answer App Store Connect privacy questions from the shipped build, not from older docs.
- Verify screenshots, description, age rating, review notes, and demo-account strategy in App Store Connect.
- Decide whether Apple sign-in is shipping or not, then make config, docs, and review notes consistent with that decision.

### Do Not Add Just For Apple

- Do not add an About page for compliance.
- Do not add a FAQ page for compliance.
- Do not add an ATT prompt unless real cross-app/site tracking is introduced.
- Do not add a classic analytics-cookie banner unless actual product behavior changes or a separate legal review requires it.

## Final Auditor Summary

The first audit was directionally strong. Its biggest weakness was being slightly too generous on the in-app privacy-policy requirement and slightly too soft on the Apple sign-in shipping risk. The repo already has solid foundations for deletion, restore purchases, native legal surfaces, and a low-tracking posture. The real work now is not to add more pages. It is to tighten truthfulness, placement, and submission-readiness:

- create a real support URL
- make the public privacy notice match actual web behavior
- make the purchase point legally and commercially clearer
- decide whether Apple sign-in is shipping, then make the code and docs say the same thing
- verify the actual release archive before submission
