# Entitlements And Alert Rules Rollout Plan

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Realign `anon`, signed-in `free`, and `premium` behavior across the three customer surfaces so the product matches the approved plan:

- `anon`: browse-only, no saved or alert tooling.
- signed-in `free`: 15-minute refresh, feed filters, calendar page, one-off add-to-calendar, and basic launch alerts delivered to native mobile push devices.
- `premium`: 15-second refresh, saved presets/default filter, follows, premium web/browser alerts, recurring integrations, change log, RSS, embeds, AR, enhanced forecast, and launch-day email.

## Shared Contract Changes

- Keep `canUseInstantAlerts` as a temporary Premium-only compatibility alias.
- Make `canUseSavedItems` Premium-only.
- Make `canUseLaunchFilters`, `canUseLaunchCalendar`, and `canUseOneOffCalendar` available to signed-in free and Premium users.
- Add additive capabilities:
  - `canManageFilterPresets`
  - `canManageFollows`
  - `canUseBasicAlertRules`
  - `canUseAdvancedAlertRules`
  - `canUseBrowserLaunchAlerts`
- Free limits become zero for saved presets/watchlists/follow rules. Premium keeps the current higher limits.

## Backend And API Slice

- Add `/api/v1/me/alert-rules` as an additive shared resource for account-scoped launch alerts.
- First supported rule kinds:
  - `region_us`
  - `state`
  - `filter_preset`
  - `follow`
- Keep existing per-launch alert preferences for launch-detail alert configuration.
- Allow free signed-in users to enable push preferences and receive push alerts on iOS/Android Expo devices.
- Keep browser/web push delivery Premium-only.
- Keep SMS and launch-day email Premium-only.

## Data Model

- Add one additive table for account-shared alert rules keyed by `user_id`.
- Store selectors, not copied launch ids, so future launches can match dynamically.
- Keep Premium-only rules stored after downgrade, but skip them in dispatch until Premium is restored.
- Do not remotely remove previously imported one-off calendar events; revoke Premium tokenized feeds instead.

## Rollout Order

1. Shared entitlement capability and limit updates.
2. Additive alert-rule contracts, API client, query plumbing, and Supabase migration.
3. Shared backend gating changes for saved items, push registration, per-launch alerts, and alert-rule CRUD.
4. Notification dispatch/send updates so free mobile push works and Premium-only web/browser push remains gated.
5. Web UI copy and gating alignment.
6. Mobile UI copy and gating alignment, including launch-detail launch-alert entry points.

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

## Rollback Notes

- The new alert-rules path is additive and can be ignored by clients if rollout stalls.
- Premium-only saved data remains stored through downgrade; UI falls back to read-only/locked states without destructive cleanup.
- Push delivery changes must preserve Premium browser push while allowing free Expo/mobile push.
