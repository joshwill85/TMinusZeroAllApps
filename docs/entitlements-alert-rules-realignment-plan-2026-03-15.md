# Entitlements And Alert Rules Realignment Plan

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Realign anon, free signed-in, and premium access across web plus native surfaces without widening scope into admin tooling.

## Locked Product Decisions

- `anon` stays browse-only with public data and a `2` hour refresh cadence. Do not show a dedicated anon pricing card.
- `free` signed-in gets `15` minute refreshes, feed filters, the calendar page, and one-off add-to-calendar from launch detail across web, iOS, and Android.
- `free` does not get saved presets, watchlists, follows, browser alerts, recurring integrations, RSS, embeds, AR, change log, enhanced forecast, or launch-day email.
- `premium` keeps `15` second live refresh, saved presets with a default preset, follows on the current implemented types (`launch`, `provider`, `pad`, `tier`), recurring calendar feeds, RSS/Atom, embed widgets, AR, enhanced forecast insights, change log, browser alerts, and launch-day email.
- `free` alert delivery is mobile-push only. Shared alert rules can still be created or managed from web.
- `free` alert scopes are:
  - per-launch alerts from launch detail
  - all US launches
  - specific US state
- `premium` alert scopes add:
  - saved filter presets
  - selected follows
- Premium-only saved and integration resources remain stored after downgrade, but become inactive/read-only until Premium returns.
- Premium integration tokens stop working after downgrade. External calendars or feed readers cannot be cleaned up remotely after import.

## Contract Changes

- Shared entitlement capabilities become:
  - `canUseSavedItems`: premium only
  - `canUseLaunchFilters`: free and premium
  - `canManageFilterPresets`: premium only
  - `canManageFollows`: premium only
  - `canUseLaunchCalendar`: free and premium
  - `canUseOneOffCalendar`: free and premium
  - `canUseBasicAlertRules`: free and premium
  - `canUseAdvancedAlertRules`: premium only
  - `canUseBrowserLaunchAlerts`: premium only
  - keep `canUseInstantAlerts` as a temporary premium-only compatibility alias
- Shared entitlement limits become:
  - anon: `0` presets, `0` watchlists, `0` follow rules
  - free: `0` presets, `0` watchlists, `0` follow rules
  - premium: `25` presets, `5` watchlists, `200` follow rules
- Add additive `/api/v1/me/alert-rules` contracts for account-shared rules with kinds:
  - `region_us`
  - `state`
  - `filter_preset`
  - `follow`
- Keep `/api/v1/me/launch-notifications/[id]` for per-launch alert setup on launch detail.

## Backend Shape

- New shared table: `account_alert_rules`
  - additive schema only
  - stores account-owned push alert selectors plus schedule fields already used by per-launch alerts
  - supports one selector per row so dispatch can dedupe on existing `(user, launch, channel, event_type)` outbox keys
- `/api/v1/me/notification-preferences`
  - free can enable push
  - SMS and launch-day email stay premium-only
- `/api/v1/me/push-devices/test`
  - free mobile users can self-test Expo/native push
  - browser push self-test remains premium-only on the web-only route
- Notification dispatch/send workers
  - stop treating all push as paid-only
  - allow free delivery to active Expo devices
  - keep browser `push_subscriptions` delivery premium/admin only
  - expand dispatch to resolve account alert rules into launch matches

## Client Scope

- Web
  - keep feed filters visible to signed-in free users
  - move saved presets, follows, recurring integrations, and browser alerts behind premium
  - allow free access to the calendar page and one-off add-to-calendar
  - add/manage shared alert rules from account preferences
- iOS / Android
  - keep feed filters available to signed-in free users
  - keep calendar page and one-off add-to-calendar available to signed-in free users
  - add launch-detail alert entry for free per-launch mobile push alerts
  - expose shared alert-rule management in profile/preferences
  - keep saved items and advanced alerts premium-only, with disabled/read-only downgrade copy

## Rollout Order

1. Shared entitlement and contract update
2. Additive alert-rules schema plus `/api/v1` route/client/query plumbing
3. Backend gating changes for saved items, calendar, push enablement, and dispatch/send
4. Web entitlement and copy alignment
5. Mobile entitlement and copy alignment
6. Pinned-toolchain verification

## Rollback Notes

- The new alert-rules route and table are additive and can be ignored by older clients.
- Existing per-launch alert routes remain intact during rollout.
- Premium-only saved/integration writes stay server-gated even if older UI copy lags.
- If alert-rule dispatch regresses, per-launch alerts still continue through the existing table.

## Verification

Run under the pinned toolchain:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- targeted web account/preferences/feed/calendar smoke
- targeted iOS and Android feed/calendar/detail/preferences smoke
