# Phase 4 Mobile Acceptance

This document is the evidence checklist for the remaining mobile-core Phase 4 gates in `docs/three-platform-overhaul-plan.md`.

## Automated Gates

- Pinned toolchain only:
  - `node -v`
  - `npm -v`
  - `npm run doctor`
  - `npm ci`
- Repo-owned preflight bundle:
  - `npm run acceptance:preflight -- --out-dir=.artifacts/three-platform-acceptance`
- Repo-owned local-stack bundle:
  - `npm run acceptance:local -- --skip-mobile-e2e --out-dir=.artifacts/three-platform-local-acceptance`
  - This path resets local Supabase, applies migrations, seeds deterministic free/premium fixture data, starts `apps/web`, runs the pinned acceptance preflight, and captures the local rate-limit smoke output.
- Required automated checks:
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run lint --workspace @tminuszero/mobile`
  - `npm run type-check:mobile`
- Detox:
  - unified local entrypoint: `npm run mobile:e2e:acceptance`
  - iOS suite: `npm run mobile:e2e:acceptance:ios`
  - Android suite: `npm run mobile:e2e:acceptance:android`
- Local authenticated Detox coverage does not require a separate environment.
  - `npm run acceptance:local` seeds deterministic credentials and launch ids from `scripts/three-platform-local-fixture.ts`.
  - For direct local Detox runs, reuse the same local Supabase/web stack env that `acceptance:local` prepares.
- CI or remote authenticated Detox coverage can still use these env vars or secrets:
  - `EXPO_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `TMZ_MOBILE_E2E_EMAIL`
  - `TMZ_MOBILE_E2E_PASSWORD`
- Simulator and emulator push-registration coverage can use the deterministic test seam:
  - `EXPO_PUBLIC_MOBILE_E2E_PUSH=1`
  - `EXPO_PUBLIC_MOBILE_E2E_PUSH_TOKEN=ExponentPushToken[detox-e2e]`
- `acceptance:local` automatically injects the simulator-safe push seam for local mobile E2E runs.
- The E2E push seam only exercises the shared backend registration path. It does not replace physical-device delivery proof.
- CI uploads Detox artifacts from `apps/mobile/.artifacts/detox/{ios,android}` after every run. Attach those artifacts in the tracker before checking the mobile E2E boxes.
- The local-stack bundle also emits:
  - `.artifacts/three-platform-local-acceptance/seed.json`
  - `.artifacts/three-platform-local-acceptance/preflight/summary.md`
  - `.artifacts/three-platform-local-acceptance/preflight/billing/billing-evidence.json`
  - `.artifacts/three-platform-local-acceptance/rate-limit-smoke.json`

## Real-Device Push Runbook

- Use an internal `preview` build from `eas.json`.
- Device prerequisites:
  - one physical iPhone on a currently supported iOS release
  - one physical Android device on a currently supported Android release
  - signed-in account with premium alert capability
- Required run:
  - sign in
  - open `Prefs`
  - tap `Enable push alerts`
  - confirm the device shows `Push enabled: yes` and `Device registered: yes`
  - tap `Send push test`
  - verify the notification arrives
  - tap the notification and confirm it routes into launch detail or preferences fallback
  - disable push and confirm the device returns to an unregistered state
  - sign out and confirm push is removed for that installation
- Evidence to attach to the tracker:
  - build profile and build id
  - device model and OS version
  - screenshot of `Prefs` after registration
  - screenshot of delivered notification
  - screenshot after tap-through route
  - backend timestamps for the matching device row when available

## Low-End Device Perf Gate

- Capture on one older supported iPhone and one budget or older supported Android device.
- Record these metrics before checking the Phase 4 performance box:
  - cold start to visible feed shell
  - feed scroll trace over at least 20 launch cards
  - tab switch from Feed -> Search -> Profile -> Feed
  - search submit latency for `starlink`
  - push-enable flow latency from tap to registered state
- Pass thresholds:
  - cold start: under 3.0s on iPhone, under 3.5s on Android
  - tab switch: under 500ms with no new session or entitlement request
  - feed/detail/search reuse: `npm run test:mobile-query-guard` must stay green
  - scroll: no timer-storm regression and no visible repeated image or list thrash during the capture
- Attach screenshots, traces, or screen recordings to the tracker progress log.

## Rollout Gates

- `preview` channel:
  - internal dogfood only
  - requires automated gates plus one successful real-device push run on each platform
- Store beta:
  - TestFlight and Android Internal App Sharing
  - requires green Detox, green contract/query guards, and the low-end perf evidence above
- `production` channel:
  - requires no open Phase 4 acceptance items
  - requires rollback note for the promoted build id
  - requires the tracker progress log to reference the exact evidence artifacts used for promotion
