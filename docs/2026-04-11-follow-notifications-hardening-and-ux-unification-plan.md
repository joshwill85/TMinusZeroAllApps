# Follow And Notifications Hardening And UX Unification Plan

Last updated: 2026-04-11

## Scope Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing or admin/internal: both

## Why This Slice Exists

- The live notification product is now native mobile push only, but the repo still carries multiple overlapping models:
  - legacy account notification tables and endpoints
  - unified `notification_rules_v3` and `notification_push_destinations_v3`
  - account-synced follow management on web
  - device-scoped public/basic mobile push rules
- The current ownership model is not intuitive:
  - signed-out users are device-scoped guests, which is expected
  - signed-in unpaid users are also treated as device-scoped guests for mobile push, which is not expected
- Following and alerts are functionally related but not clearly separated in user-facing product semantics.
- The current mobile and server validation rules have already drifted in at least one important place:
  - the basic broad-rule reminder offsets exposed in mobile `Preferences` do not match the server-allowed starter offsets
- The current shared capability and copy layer still describes retired browser/email-era notification capabilities, which creates future product drift risk.
- There is no dedicated internal support surface for debugging entitlements, rules, destinations, outbox state, and send failures in one place.

## Target End State

At completion:

1. Signed-out users may create only temporary device-scoped starter alerts.
2. Signed-in users, including signed-in `anon`, own follow and alert rules at the account level.
3. Premium expands scopes, limits, and delivery sophistication rather than changing rule ownership.
4. Follow and alert become separate first-class concepts in product language and server behavior:
   - `Follow` means save or track a source in-account
   - `Alert` means deliver push for a source to registered devices
5. `notification_rules_v3` and `notification_push_destinations_v3` are the only live source of truth for notification behavior.
6. Mobile is the only live push-management surface:
   - device registration
   - current-device enablement
   - live delivery controls
7. Web manages account-level sources and read-only status:
   - follows
   - saved presets
   - alert-source relationships
   - clear handoff to mobile for device delivery
8. Support can inspect entitlement source, rule ownership, destinations, outbox rows, and send failures from one internal web-only tool.

## Locked Decisions

- Live launch alerts remain native mobile push only in this slice.
- Browser push, SMS notifications, and launch-alert email are not reintroduced in this cleanup.
- `guest` ownership is reserved for signed-out device-scoped behavior only.
- Authenticated viewers use `user` ownership for follows and alert rules, even if their tier is `anon`.
- Premium continues to gate advanced scopes and delivery behavior:
  - broad recurring follow scopes beyond the starter set
  - more reminder windows
  - daily digests
  - status-change alerts
  - NET-change alerts
- Starter `anon` behavior remains intentionally small and explicit.
- The migration remains additive first:
  - no destructive table drops in the first implementation passes
  - legacy readers stay compatibility-safe until the new write path is fully soaked
- Copy must be explicit about account scope versus device scope on every surface.

## Starter Capability Matrix

### Signed-out guest

- One current/future launch alert slot on the current device
- `All U.S.` starter alert on the current device
- No saved watchlists
- No saved presets
- No recurring provider, rocket, pad, site, or state follows
- No daily digests
- No status-change alerts
- No NET-change alerts

### Signed-in anon

- Same starter scope limits as guest, but account-owned
- Rules sync at the account level
- Delivery still requires at least one active mobile push destination
- No premium-only broad recurring scopes or advanced delivery

### Premium

- Account-owned follows and alert rules
- Saved watchlists and presets
- Broad recurring scopes:
  - provider
  - rocket
  - pad
  - launch site
  - state
  - all launches
  - saved preset
  - followed sources
- Advanced delivery:
  - more reminder windows
  - daily digest
  - status-change alerts
  - NET-change alerts

## Decision Gates

### Decision Gate A: Signed-in anon ownership

Recommended default:

- Move authenticated `anon` follows and starter alerts to account ownership.
- Keep the entitlement tier as `anon`.
- Keep delivery limited to the starter capability set unless Premium is active.

Reason:

- This preserves the repo's `anon | premium` customer model while removing the unintuitive "signed in but still guest-owned" behavior.

### Decision Gate B: Web notification management posture

Recommended default:

- Keep web read-only for live push-device management.
- Allow web to manage account-level follows and alert sources.
- Add an account status summary so users can see what exists without editing device delivery from web.

Reason:

- This preserves the push-only mobile delivery cutover while still making web useful and understandable.

### Decision Gate C: Legacy notification table retirement timing

Recommended default:

- Stop adding new product logic on legacy tables immediately.
- Keep compatibility reads while the new unified write path is soaked.
- Only then deprecate or freeze legacy writes.

Reason:

- This minimizes risk while removing the current split-brain maintenance burden.

## Phases

## Phase 0 - Policy Lock And Inventory Freeze

Goal:

- Approve one durable product and ownership model before code changes start.

Changes:

1. Approve this plan as the slice source of truth.
2. Freeze the starter capability matrix for:
   - signed-out guest
   - signed-in anon
   - premium
3. Inventory every current write path into follow and alert state:
   - watchlists
   - watchlist rules
   - legacy alert rules
   - legacy launch notification preferences
   - unified mobile push rules
   - push destinations
4. Inventory every customer-facing management surface and label each control as:
   - follow management
   - alert-source management
   - delivery/device management
   - retired/read-only
5. Define the rollout feature flags:
   - principal resolution flag
   - unified write path flag
   - web alert-status summary flag

Acceptance:

- One approved ownership and capability model exists.
- Every active write path and management surface is classified.

Rollback:

- None needed; this phase is planning-only.

## Phase 1 - Immediate Stabilization And Truth Alignment

Goal:

- Fix the current user-facing inconsistencies without yet changing the broader ownership model.

Changes:

1. Centralize reminder offset policy in one shared source of truth used by mobile UI and server validation.
2. Align starter and premium reminder windows across:
   - mobile launch-level alerts
   - mobile broad-rule editing
   - server rule validation
   - contracts
3. Remove stale capability and copy references to retired channels:
   - browser launch alerts
   - launch-day email for live launch notifications
   - web-managed launch push setup
4. Standardize product copy so users can always distinguish:
   - `Follow`
   - `Alert`
   - `Account`
   - `This device`
5. Make every web notification affordance explicitly read-only or mobile-handoff if it cannot mutate live push delivery.
6. Add regression coverage for:
   - starter alert creation
   - starter broad-rule editing
   - premium advanced control validation

Acceptance:

- No starter UI exposes invalid reminder choices.
- No active customer copy implies retired channels are live.
- Web no longer feels partially editable where it is actually read-only.

Rollback:

- Revert shared policy constants and copy changes by surface if needed.

## Phase 2 - Ownership And Principal Realignment

Goal:

- Make authenticated `anon` behavior intuitive and account-owned.

Changes:

1. Replace the current principal resolution rules with:
   - signed out -> `guest`
   - signed in -> `user`
2. Keep tier gating separate from ownership:
   - `anon` -> starter scopes only
   - `premium` -> starter plus advanced scopes and settings
3. Add sign-in migration flow:
   - detect guest starter rules on the current installation
   - copy or merge them into the user owner on sign-in
   - preserve device registration on the current device where safe
4. Keep `deviceSecret` authorization only for guest-owned state.
5. Update send and dispatch logic so:
   - signed-in `anon` user-owned starter rules can dispatch
   - premium-only scopes and settings still enforce premium at write and send time
6. Add explicit downgrade behavior for premium lapse:
   - premium-only delivery settings stop sending
   - starter-scope account rules can remain if still within `anon` policy

Acceptance:

- Signed-in `anon` rules are account-owned and deterministic.
- Signed-out behavior remains device-scoped and secure.
- Upgrade and sign-in do not silently discard starter alert intent.

Rollback:

- Keep principal resolution behind a server-side flag during rollout.
- Preserve the old guest-owner path until the new ownership model has soaked.

## Phase 3 - Single Live Write Path On Unified V3

Goal:

- Remove split-brain live behavior by making unified v3 the only live notification write path.

Changes:

1. Introduce explicit server services:
   - `FollowService`
   - `AlertRuleService`
   - `PushDestinationService`
   - `NotificationOwnershipService`
2. Route all live follow and alert writes through unified rule helpers instead of mixing direct legacy table writes with mirrored updates.
3. Keep compatibility-safe read adapters for legacy endpoints during migration, but stop treating legacy rows as the primary product state.
4. Add consistency checks between legacy rows and unified rows during the soak window if dual-write remains temporarily necessary.
5. Move mobile saved/follow actions and web saved/follow actions onto the same server-side rule-creation path.
6. Document the remaining legacy-only tables and their retirement conditions.
7. Backfill or retire stale queued mobile push outbox rows during the ownership and downgrade transition:
   - refresh policy metadata on still-valid queued rows
   - skip stale premium-only queued rows that no longer qualify

Acceptance:

- All new live writes go through unified services.
- There is one canonical rule-owner and scope-normalization path.
- Legacy tables are no longer the source of truth for live alert behavior.
- Stale queued rows from pre-hardening policy metadata do not silently strand valid starter alerts.

Rollback:

- Preserve compatibility wrappers and optional dual-write while the unified path is soaking.

## Phase 4 - Surface UX Consolidation

Goal:

- Make follow and alert management intuitive across web, iOS, and Android.

Changes:

1. Make mobile `Preferences` the primary `Alerts` hub:
   - current-device push status
   - test push
   - current-device enable/disable
   - account alert rules
   - starter and premium alert-source sections
   - device and account explanations
2. Make mobile `Saved` the primary `Follows and saved views` hub:
   - watchlists
   - watchlist rules
   - filter presets
   - alert-source toggles derived from those sources
3. Keep the launch follow sheet pattern, but harden the language:
   - `Following` tab means save/track
   - `Notifications` tab means push delivery for this launch
4. Add account/device scope messaging everywhere it matters:
   - starter public rules
   - signed-in anon starter rules
   - premium synced rules
5. Make web `Saved` explicitly the account-level source manager, not a push-device manager.
6. Upgrade the web `Notifications` page from pure retirement text to a clearer status handoff:
   - mobile-push-only explanation
   - account alert summary
   - registered-device summary if available
   - link into native app for live delivery edits

Acceptance:

- Users can answer three questions without guessing:
  - What am I following?
  - What will send a push?
  - Which device can receive it?
- Web and mobile no longer present overlapping but inconsistent notification responsibilities.

Rollback:

- Gate the new alerts-hub and status-summary UX behind surface flags if needed.

## Phase 5 - Internal Support, Observability, And Lifecycle Hardening

Goal:

- Make the system operable and debuggable in production.

Changes:

1. Add a web-only internal notification inspector showing:
   - effective entitlement and source
   - owner kind resolution
   - unified rules
   - push destinations
   - recent outbox rows
   - recent send failures
   - recent guest-to-user migration activity
2. Add structured metrics and logs for:
   - rule create and delete by scope and tier
   - guest-to-user copy or merge
   - skipped sends by reason
   - disabled devices by reason
   - invalid token rates
   - outbox age and retry counts
3. Add scheduled cleanup or maintenance jobs for:
   - stale guest rules
   - stale disabled destinations
   - duplicate scope rows
   - impossible starter-scope states
4. Add explicit lifecycle tests for:
   - sign-in while a guest starter rule exists
   - sign-out
   - premium upgrade
   - premium lapse
   - push permission revoked
   - token rotation
   - app reinstall

Acceptance:

- Support can debug a broken notification story without direct SQL spelunking.
- Lifecycle transitions are deterministic and tested.

Rollback:

- Internal tooling is additive and can remain disabled if a UI issue appears.

## Phase 6 - Legacy Retirement And Final Hardening

Goal:

- Finish the cleanup once unified behavior has soaked and evidence is stable.

Changes:

1. Freeze or retire legacy notification writes that are no longer needed for live behavior.
2. Remove stale customer-facing compatibility copy and dormant feature flags tied to retired notification channels.
3. Remove compatibility-only contract fields once no active surface depends on them.
4. Reduce legacy tables to:
   - migration history
   - compatibility reads if still necessary
   - archival/ops-only surfaces
5. Produce a final runbook for notification ownership, routing, and failure handling.

Acceptance:

- No live push behavior depends on the legacy notification tables.
- The product model is explainable in one short support script.
- The codebase no longer contains contradictory notification-era capability language.

Rollback:

- Keep additive migrations reversible and delay destructive cleanup until after a full soak window.

## Public Contracts And API Changes

- Keep `/api/v1` changes additive during rollout.
- Introduce one shared policy contract for:
  - starter scopes
  - premium scopes
  - starter reminder windows
  - premium reminder windows
  - per-scope delivery constraints
- Update mobile push access semantics so `ownerKind` reflects sign-out vs signed-in ownership, not paid status.
- Add additive status payloads for web/mobile account alert summaries if needed.
- Add additive device-summary payloads for read-only web status surfaces and internal support screens.
- Keep any legacy notification-preferences response compatibility-safe until consumers are migrated off dormant fields.

## Data And Backend Work

- Add a shared notification policy helper in `packages/domain` or another shared package used by server and mobile UI.
- Add server-side notification services around unified rule creation, updates, deletion, ownership resolution, and device management.
- Add additive migrations for:
  - authenticated `anon` account-owned starter rules
  - guest-to-user migration support
  - internal support or audit views if needed
- Add background cleanup logic for stale guest/device state.
- Keep send-time entitlement enforcement for premium-only scopes and settings.

## Surface-Specific Notes

### Web

- Web remains no-browser-push and no-live-device-management.
- Web should still manage account-level follows and saved alert sources.
- Web should show alert status clearly enough that users understand what exists and where to edit it.

### iOS

- iOS remains a primary live push-management surface.
- Device registration and account-owned rules must be clearly separated in UI and data flow.

### Android

- Android matches iOS in push-management responsibility and account-owned rule behavior.
- Permission-revocation and token-rotation handling need the same lifecycle guarantees as iOS.

### Admin/internal

- Admin stays web-only for notification support tooling.
- No customer-facing admin surface is added as part of this slice.

## Blast Radius

- `apps/web/lib/server/v1/mobilePushV2.ts`
- `apps/web/lib/server/v1/mobileApi.ts`
- `apps/web/lib/server/notificationsV3.ts`
- `apps/web/lib/server/entitlements.ts`
- `apps/web/app/me/preferences/page.tsx`
- `apps/web/app/account/saved/page.tsx`
- `apps/web/components/WatchlistFollows.tsx`
- `apps/web/components/LaunchFeed.tsx`
- `apps/mobile/src/providers/MobilePushProvider.tsx`
- `apps/mobile/src/components/LaunchAlertsPanel.tsx`
- `apps/mobile/src/components/LaunchFollowSheet.tsx`
- `apps/mobile/app/(tabs)/preferences.tsx`
- `apps/mobile/app/(tabs)/saved.tsx`
- `apps/mobile/app/(tabs)/feed.tsx`
- `apps/mobile/app/launches/[id].tsx`
- `apps/mobile/src/watchlists/usePrimaryWatchlist.ts`
- `packages/contracts/src/index.ts`
- `packages/domain/src/viewer.ts`
- `packages/domain/src/viewerExperience.ts`
- additive `supabase/migrations/*`
- `supabase/functions/notifications-dispatch/index.ts`
- `supabase/functions/notifications-send/index.ts`

## Rollout Order

1. Policy lock, starter capability matrix, and surface inventory.
2. Shared reminder-window and capability truth alignment.
3. Principal and ownership realignment behind flags.
4. Unified live write-path migration.
5. Mobile/web UX consolidation.
6. Internal support and lifecycle hardening.
7. Legacy retirement after soak and evidence hold.

## Rollback Notes

- Keep principal resolution behind a server-side flag during the ownership cutover.
- Keep compatibility reads and any required dual-write until unified-only writes have soaked.
- Keep `/api/v1` changes additive so older mobile builds do not hard-fail.
- Delay destructive legacy cleanup until after support tooling confirms there is no hidden dependency.

## Verification Set

- Required toolchain validation:
  - `node -v && npm -v`
  - `npm run doctor`
  - `npm ci`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
- Acceptance coverage:
  - signed-out user can create and remove one starter launch alert
  - signed-out user can create and edit `All U.S.` starter alert within starter policy limits
  - signed-in `anon` owns starter rules at the account level after sign-in
  - guest starter rules copy or merge correctly on sign-in
  - premium upgrade preserves existing starter intent and unlocks advanced controls without data loss
  - premium lapse stops premium-only sends and leaves starter behavior deterministic
  - web saved follow actions and mobile saved follow actions converge on the same canonical rule shape
  - web notification surfaces do not mutate live device delivery
  - invalid push tokens disable only the affected destination
  - skipped-send reasons are visible in internal tooling
- Mobile E2E when environment supports it:
  - launch detail follow sheet
  - feed follow sheet
  - preferences alerts hub
  - push permission revoke and re-enable

## Open Follow-Ups

- Decide whether signed-in `anon` starter alerts should sync to all registered devices by default or require per-device enablement opt-in.
- Decide whether web should expose a read-only registered-device list on the account page or only on a dedicated notification-status surface.
- Decide whether starter `anon` should keep `All U.S.` permanently or move to a more explicit starter-rule model later.
