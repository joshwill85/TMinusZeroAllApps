# Mobile Native Auth Hardening Plan

Date: 2026-03-15

## Platform Matrix

- Web: dependency surface only for shared `/api/v1` routes and the hosted challenge page
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Ship a safe iOS/Android password-auth migration that restores live sign-in, sign-up, resend verification, and password recovery while keeping real-user friction low and using the current Cloudflare Turnstile + Supabase stack.

## Implementation Slices

### Slice 1: Shared guest mobile-auth contract

- Add typed `/api/v1/mobile-auth/*` contracts for:
  - `risk/start`
  - `challenge/complete`
  - `sign-in`
  - `sign-up`
  - `resend`
  - `recover`
- Keep the returned mobile session payload shape aligned with the current native bootstrap flow.
- Extend post-success auth context with an optional `riskSessionId`.

### Slice 2: Backend risk and challenge orchestration

- Add additive database tables for mobile auth risk sessions and append-only risk events.
- Add `system_settings` rollout controls for enforcement mode, forced visible challenges, and non-production bypasses.
- Reuse Cloudflare Turnstile for the challenge layer.
- Call Supabase Auth server-side with the verified Turnstile token so mobile no longer posts raw password flows directly to `/auth/v1/*`.

### Slice 3: Native mobile flow migration

- Replace direct password auth REST calls in `apps/mobile` with a guest `/api/v1/mobile-auth/*` flow.
- Use a stable auth-specific installation ID from SecureStore for rate-limit and observability keys.
- Keep OAuth/PKCE flows unchanged.
- Keep attestation additive and rollout-controlled; non-production builds use an explicit bypass path.

### Slice 4: Rollout and verification

- Default production controls to shadow mode first.
- Capture metrics for challenge disposition, auth success/failure, and rate-limit hits before enforcement widens.
- Validate with the pinned toolchain and both iOS/Android mobile checks.

## Safety Notes

- Do not introduce a second identity system.
- Do not persist raw Turnstile tokens, raw attestation tokens, or raw installation IDs in database tables.
- Keep all schema and route changes additive.
- Keep the general web auth UX unchanged.

## Verification

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run test:mobile-security-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run mobile:e2e:test:ios`
- `npm run mobile:e2e:test:android`
