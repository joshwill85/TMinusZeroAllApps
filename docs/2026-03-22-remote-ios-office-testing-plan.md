# Remote iPhone Office Testing Plan

Date: 2026-03-22

## Platform Matrix

- Web: included for a separate staging deployment only
- iOS: included
- Android: not included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Non-Negotiable Constraints

- Do not modify, reconfigure, or redeploy the live `tminuszero.app` Vercel-backed web app repo.
- Do not alias this repo to the canonical production domain.
- Use a separate public HTTPS staging origin for this repo.
- Keep changes additive and reversible.

## Goal

Allow remote iPhone testing without the developer Mac by:

1. serving this repo from a separate public HTTPS staging host,
2. producing a standalone iOS build that does not depend on Metro or local APIs,
3. avoiding any impact on the existing live `tminuszero.app` web app.

## Findings

- The mobile app requires a real HTTPS API base URL for non-development builds.
- The mobile app also relies on related hosted web surfaces from the same deployment family, including the hosted auth challenge flow.
- The current local iPhone success is not sufficiently reproducible for remote distribution because critical fixes only exist in ignored/generated local files.
- The app icon currently points at ignored iOS output instead of a tracked asset.
- Expo/EAS is scaffolded in the repo, but the project is not yet linked to an Expo project in source and local EAS auth is not configured on this machine.
- The existing live `tminuszero.app` Vercel project is separate and must remain untouched.

## Recommended Rollout

### Phase 1: Repo Hardening

- Move the mobile icon to a tracked asset path under `apps/mobile/assets`.
- Replace the manual Xcode `ENABLE_USER_SCRIPT_SANDBOXING = NO` tweak with a checked-in Expo config plugin.
- Keep all generated native changes out of the release path.
- Re-run the relevant mobile verification set after these changes.

### Phase 2: Separate Staging Host

- Create a new Vercel project for this repo only.
- Set the Vercel Node major to `20.x`.
- Deploy this repo to its own public staging URL.
- Verify that the staging origin serves:
  - `/api/v1/launches/version`
  - `/api/v1/launches`
  - `/api/v1/viewer/session`
  - `/mobile-auth/challenge`

### Phase 3: Mobile Preview Build Readiness

- Link the mobile app to an Expo project.
- Set preview/prod-safe env values for:
  - `EXPO_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_SITE_URL`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_ANON_KEY`
  - `EXPO_PUBLIC_EAS_PROJECT_ID` or `EAS_PROJECT_ID`
  - `APPLE_DEVELOPER_TEAM_ID` or `APPLE_APP_LINK_APP_IDS`
  - `MOBILE_APP_LINK_HOSTS` for staging-only app-link entitlements
- Choose the distribution path:
  - fastest: EAS internal distribution for the current iPhone
  - more durable: TestFlight after staging is stable

### Phase 4: Remote Device Verification

- Install the standalone iOS build on the iPhone.
- Verify launch feed, auth challenge, navigation, and launch detail work off the Mac and off the local network.
- Capture exact build URL, backend host, and verification evidence for reuse.

## Verification Set

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run type-check:mobile`
- `npm run lint --workspace @tminuszero/mobile`

## Rollback Notes

- Repo changes are additive and local to this repo.
- Staging deployment is isolated from the existing live Vercel project and production domain.
- If staging fails, remove or stop using the staging host without touching the live site.

## External Dependencies

- Expo account login or `EXPO_TOKEN`
- Apple team/app-link values for preview/production-safe mobile builds
- Separate Vercel project for this repo
