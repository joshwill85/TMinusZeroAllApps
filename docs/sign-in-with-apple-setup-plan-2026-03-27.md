# Sign in with Apple Setup Plan

Date: 2026-03-27

## Platform Matrix

- Web: included
- iOS: included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Enable the existing browser-based Supabase OAuth flow for `Sign in with Apple` on web and the iOS Expo app without introducing the native AuthenticationServices path.

## Locked Decisions

- Keep the implementation on the existing Supabase OAuth redirect flow.
- Scope customer UI exposure to sign-in surfaces only.
- Do not widen this change into Android or native Apple auth entitlements.
- Keep Premium claim account creation unchanged for the explicit sign-up flow.

## Apple Configuration

- App ID: `app.tminuszero.mobile`
- Team ID: `R237HMY2GF`
- Services ID: `app.tminuszero.signin`
- Hosted Supabase Apple provider client IDs must include both:
  - `app.tminuszero.signin` for web OAuth
  - `app.tminuszero.mobile` for native iOS `signInWithIdToken`
- Services ID name: `T-Minus Zero Sign in with Apple`
- Sign in with Apple key ID: `36W646Y6KV`
- APNs key remains separate and is not reused here.

## Repo and Backend Changes

1. Enable `[auth.external.apple]` in `supabase/config.toml`.
2. Add the iOS deep-link redirect allow-list entries needed for Supabase OAuth.
3. Add a local script to generate the Apple client secret JWT from the downloaded `.p8` key.
4. Turn on the mobile Apple auth feature flag in local mobile env.
5. Add `Sign in with Apple` actions to:
   - `apps/web/components/AuthForm.tsx`
   - `apps/mobile/app/sign-in.tsx`

## Hosted Config Rollout

1. Generate a fresh Apple client secret JWT.
2. Update the hosted Supabase auth config through the Management API with:
   - the generated secret
   - Apple provider client IDs set to `app.tminuszero.signin,app.tminuszero.mobile`
3. Verify hosted redirect allow-list includes:
   - `https://www.tminuszero.app/auth/callback`
   - `https://tminuszero.app/auth/callback`
   - `tminuszero://auth/**`

## Operational Note

- Do not rely on `supabase config push` from this machine for hosted auth settings with CLI `2.75.0`.
- During setup, the CLI attempted to apply local-dev auth defaults such as `http://127.0.0.1:3000` as the hosted `site_url`.
- Use the Supabase Management API for future Apple secret rotation and hosted auth provider changes.

## Verification

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Remaining Risks

- Apple client secrets expire and must be rotated before expiry.
- A first-time Apple OAuth sign-in can create a new Supabase user, which is broader than the current Premium-only explicit sign-up UX.
- End-to-end validation still requires a real iPhone and a live Apple sign-in test.
