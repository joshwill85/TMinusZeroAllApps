# Apple Sign In Linking And Rollout Plan

Date: 2026-04-03

Status: implementation is now in repo for web and mobile login-method management. Remaining work is release gating, real-device verification, and production Apple configuration.

Related docs:
- `docs/2026-04-03-web-ios-compliance-source-of-truth.md`
- `docs/2026-04-03-cookie-privacy-and-apple-sign-in-hardening-plan.md`
- `docs/three-platform-overhaul-plan.md`

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: not included except where the shared auth/backend policy affects future parity
- Admin/internal impact: no
- Shared API/backend impact: yes

## Summary

This plan brings Sign in with Apple to a mainstream, Apple-safe standard for T-Minus Zero without overreaching.

The key product position is:
- Allow net-new Apple accounts.
- Require explicit linking for existing TMZ accounts.
- Never auto-merge or auto-link based on guessed identity.
- Rely on Supabase same-email identity linking for verified non-private-email matches instead of heuristic account merges.
- Allow first-time private relay Apple accounts when there is no existing Apple link, while making it clear that existing members should sign in first and link Apple from account settings.
- Prefer self-serve linking and unlinking, with support reserved for true conflicts.
- Do not enable the production feature until code, Apple configuration, and real-device verification are all complete.

## Research-Backed Decisions

### 1. Apple Sign In is optional for this app today

- The repo currently offers first-party email/password plus Apple, not a third-party social login set that would force Guideline 4.8 parity.
- This means the goal is not minimum compliance alone. The goal is shipping a high-quality Apple flow if Apple Sign In remains enabled.

### 2. Existing accounts should use explicit linking

- Existing members should sign in with their current TMZ method first.
- After sign-in, they should link Apple from `Account > Login Methods`.
- This matches mainstream auth-provider guidance and avoids unsafe identity guessing.

### 3. Net-new Apple accounts are allowed

- A user with no deterministic existing-account conflict can create an account with Apple.
- The Apple identity itself is the canonical provider key, not the Apple relay email.

### 4. No auto-merge, no heuristic identity matching

- Do not merge accounts based on:
  - similar emails
  - relay aliases
  - profile names
  - device history
  - support-side assumptions
- Only explicit user-authenticated linking may attach Apple to an existing account.

### 5. Deterministic duplicate prevention only

- Supabase can automatically resolve verified same-email Apple identities without a second customer-facing merge step.
- If Apple returns a private relay email and there is no existing Apple link, the system still cannot safely infer account ownership.
- Because of that, `allow private relay net-new accounts` and `guarantee zero duplicates` cannot both be true.

### 6. Support should not be the default path

- Self-serve linking is the standard path.
- Support handles only:
  - Apple identity already linked elsewhere
  - duplicate-account cleanup created before this policy
  - ownership disputes
  - unrecoverable credential state mismatches

### 7. Unlink should be allowed only with a backup recovery method

- Industry-standard behavior is not "never unlink" in all cases.
- Safer default:
  - allow unlink only when another recoverable sign-in method already exists
  - block unlink if Apple is the only login method
  - if blocked, require the user to add email/password first or delete the account

### 8. Release gate must be stronger than code complete

- Apple Sign In should ship only after:
  - code implementation complete
  - Apple Developer configuration complete
  - Supabase configuration complete
  - real-device verification complete
  - App Review notes complete

## Locked Policy For This Plan

- Apple Sign In stays optional and must be able to be disabled behind release flags.
- Existing TMZ accounts must link Apple from a signed-in session.
- Net-new Apple accounts are allowed.
- Apple private relay accounts are allowed for net-new users when there is no deterministic existing-account match.
- No automatic merge or automatic link is allowed.
- Verified same-email Apple identities should resolve through Supabase linking rather than heuristic merge logic.
- Self-serve linking is the default. Support is the exception path.
- Unlink is allowed only when another recoverable login method exists.
- Account deletion remains the final fallback path for users who only want Apple removed.
- The production feature remains off until the release gate in this plan passes.

## Non-Goals

- No identity guessing across private relay aliases.
- No destructive auth migrations.
- No broad replacement of the current email/password system.
- No Android-specific product work in this slice.
- No requirement to implement Apple account-upgrade extensions in v1.

## Required User Flows

### Flow A: Net-new Apple account

- User taps `Continue with Apple`.
- If Apple identity is already linked to a TMZ account, sign in.
- If Apple identity is not linked and there is no deterministic conflict, create the TMZ account and sign in.
- If Apple returns private relay, treat the relay address as a contact alias, not as proof of existing-account ownership.

### Flow B: Existing TMZ account wants Apple

- User signs in with email/password first.
- User opens `Account > Login Methods`.
- User taps `Link Sign in with Apple`.
- Successful Apple auth links the Apple identity to the current TMZ account.
- Future Apple sign-ins resolve to that same account.

### Flow C: Apple sign-in hits an existing non-private-email account

- User taps `Continue with Apple`.
- Backend determines:
  - Apple identity is not yet linked
  - Apple returned a non-private email
  - that email already belongs to an existing TMZ account
- Do not create a new account.
- Show a clear message:
  - `An account already exists. Sign in to your T-Minus Zero account first, then link Sign in with Apple from Login Methods.`

### Flow D: Apple identity already linked elsewhere

- If a signed-in user attempts to link an Apple identity that is already attached to another TMZ account:
  - block the link
  - do not mutate any auth state
  - show a support-directed conflict message

### Flow E: Unlink Apple

- If another recoverable login method exists:
  - require recent reauthentication
  - allow unlink
  - keep the TMZ account intact
- If no backup login exists:
  - block unlink
  - present:
    - `Add another sign-in method first`
    - `Delete account`

## Implementation Plan

### Phase 1: Policy, copy, and release guardrails

- Add one source-of-truth policy reference in docs and support copy.
- Keep Apple Sign In behind explicit release flags on web and iOS.
- Add customer-facing guidance on sign-in surfaces:
  - `Already have a T-Minus Zero account? Sign in first, then link Sign in with Apple in Login Methods.`
- Add support guidance for conflict cases.

Acceptance:
- policy language approved
- release-flag strategy defined
- App Review note template drafted

### Phase 2: Shared auth-method model and additive APIs

- Add a viewer auth-methods read model.
- Prefer additive `/api/v1` routes rather than web-only helpers.

Implemented endpoints and surfaces:
- `GET /api/v1/me/auth-methods`
- `DELETE /api/v1/me/auth/apple` to clear stored Apple revocation artifacts after unlink
- client-side Supabase `linkIdentity(...)` / `unlinkIdentity(...)` from signed-in web and iOS account settings

Recommended response fields:
- `methods`
- `emailPasswordEnabled`
- `apple.linked`
- `apple.linkedAt`
- `apple.appleUserIdPresent`
- `apple.emailIsPrivateRelay`
- `apple.canLink`
- `apple.canUnlink`
- `apple.unlinkBlockedReason`

Required error codes:
- `account_exists_requires_link`
- `apple_link_required`
- `apple_already_linked`
- `apple_linked_to_other_account`
- `apple_link_requires_sign_in`
- `apple_unlink_requires_backup_method`
- `apple_unlink_requires_recent_auth`

Acceptance:
- contracts are additive only
- routes are versioned and documented
- no breaking changes to existing email/password auth

### Phase 3: Backend identity resolution rules

- Resolve Apple sign-in by Apple subject first.
- Treat the Apple subject as the provider identity key.
- For first-time Apple sign-in:
  - if non-private email deterministically matches an existing TMZ account, block and require explicit link
  - if no deterministic match exists, allow net-new account creation
- Continue to fail closed if Apple token capture or revocation-material persistence fails.
- Keep Apple deletion-time revocation logic as the source of truth for Apple-connected account deletion.

Acceptance:
- duplicate-prevention rules are deterministic and testable
- no heuristic merge behavior exists
- conflict outcomes are explicit and user-readable

### Phase 4: Web UX

- Keep Apple button only on sign-in, not generic sign-up, unless product explicitly decides otherwise.
- Add preflight guidance near the Apple button for existing members.
- Add a signed-in `Account > Login Methods` surface.
- Update callback and auth-error handling for new conflict/link codes.
- Add an unlink action only when allowed by the auth-methods response.

Primary file candidates:
- `apps/web/components/AuthForm.tsx`
- `apps/web/app/auth/callback/AuthCallbackClient.tsx`
- `apps/web/app/account/page.tsx`
- new `apps/web/app/account/login-methods/*`

Acceptance:
- existing-account conflict is understandable without support
- signed-in linking is self-serve
- unlink is guarded by backend capability flags

### Phase 5: iOS UX

- Add `Login Methods` entry from profile/account settings.
- Keep the official native Apple button on the sign-in screen.
- Add the signed-in Apple link flow in native account settings.
- Add unlink UI only when another recovery method exists and the backend allows it.
- Keep deletion flow as the fallback for users who only want Apple removed.

Primary file candidates:
- `apps/mobile/app/sign-in.tsx`
- `apps/mobile/app/(tabs)/profile.tsx`
- new login-methods screen under `apps/mobile/src/features/account/*`
- `apps/mobile/src/auth/supabaseAuth.ts`

Acceptance:
- signed-in linking works on a real device
- native error copy matches backend conflict codes
- unlink is impossible when Apple is the only recovery method

### Phase 6: Apple Developer + Supabase configuration

- Confirm Sign in with Apple is enabled for the iOS App ID.
- Confirm the Services ID is associated to the website and correct return URLs.
- Group related identifiers for Sign in with Apple so users grant consent once across related app/web surfaces where appropriate.
- Configure private email relay for outbound auth/support email domains that must reach private relay users.
- Confirm Supabase Apple provider config matches:
  - iOS client ID
  - web Services ID
  - allowed redirect URLs
- Decide whether to enable Apple server-to-server notifications for backend account-management visibility and configure it if used.

Acceptance:
- Apple portal settings match production bundle ID, Services ID, and domains
- private relay email delivery is testable
- Supabase redirect and client IDs are production-correct

### Phase 7: Release verification

- Run verification only on the pinned toolchain.
- Complete web, iOS, and backend verification before enabling production flags.

Required tests:
- Web Apple sign-in for an already-linked Apple user
- Web Apple sign-in for a first-time non-private-email user
- Web Apple sign-in deterministic conflict against an existing email/password account
- Web Apple sign-in for a first-time private-relay user
- iPhone real-device first Apple sign-in
- iPhone returning Apple sign-in
- signed-in Apple linking on iPhone
- unlink on web and iOS when a backup method exists
- blocked unlink when no backup method exists
- credential revoked / transferred handling on iPhone
- Apple-authenticated account deletion
- App Review smoke path with reviewer login notes and deletion instructions

Required commands before verification:
- `node -v && npm -v`
- `npm run doctor`
- `npm ci`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Acceptance:
- production flags are still off until all required tests pass
- release checklist is complete
- App Review notes are ready

## File And Contract Touch Map

Shared/API:
- `packages/contracts/src/index.ts`
- `packages/api-client/src/index.ts`
- new `/api/v1/me/auth-methods`
- new `/api/v1/me/auth/apple/link`
- new `/api/v1/me/auth/apple/unlink`
- `apps/web/lib/server/appleAuth.ts`
- `apps/web/lib/server/accountDeletion.ts`

Web:
- `apps/web/components/AuthForm.tsx`
- `apps/web/app/auth/callback/AuthCallbackClient.tsx`
- `apps/web/app/account/page.tsx`
- new `apps/web/app/account/login-methods/*`

iOS:
- `apps/mobile/app/sign-in.tsx`
- `apps/mobile/app/(tabs)/profile.tsx`
- `apps/mobile/src/auth/appleAuth.ts`
- `apps/mobile/src/auth/supabaseAuth.ts`
- `apps/mobile/src/auth/appleAccountDeletion.ts`
- new `apps/mobile/src/features/account/LoginMethodsScreen.tsx`

Docs:
- `docs/2026-04-03-web-ios-compliance-source-of-truth.md`
- `docs/2026-04-03-cookie-privacy-and-apple-sign-in-hardening-plan.md`
- support / privacy / App Review notes docs as needed

## User-Facing Copy Requirements

Sign-in preflight:
- `Already have a T-Minus Zero account? Sign in first, then link Sign in with Apple in Login Methods.`

Deterministic existing-account conflict:
- `An account already exists. Sign in to your T-Minus Zero account first, then link Sign in with Apple from Login Methods.`

Apple linked elsewhere:
- `This Apple account is already linked to another T-Minus Zero account. Contact support if you need help recovering access.`

Blocked unlink:
- `Add another sign-in method before removing Sign in with Apple.`

Deletion fallback:
- `If you only want to remove Sign in with Apple and cannot add another sign-in method, delete your account instead.`

## Rollout Notes

- Keep production Apple Sign In disabled until Phase 7 passes.
- Roll out in this order:
  1. contracts and backend rules
  2. web conflict handling and login methods
  3. iOS login methods and link flow
  4. unlink flow
  5. portal config and real-device verification
  6. App Review notes and production enablement

## Rollback Notes

- Do not remove email/password auth.
- Keep all auth-model changes additive.
- If release verification fails:
  - disable Apple Sign In feature flags
  - leave existing email/password paths intact
  - do not delete any Apple token-store data needed for later retry

## Optional Follow-Up, Not A Blocker

- Implement Apple's account-authentication modification upgrade path for a more native "upgrade existing account to Sign in with Apple" experience.
- Add Android `Login Methods` parity later if the product wants consistent account-management UI across native platforms.
