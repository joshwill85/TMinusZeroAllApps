# Entitlement Realignment Three-Platform Plan

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Realign `anon`, signed-in `free`, and `premium` so the same entitlement contract drives web, iOS, Android, and shared notification delivery without silently keeping old free saved-item behavior alive.

## Locked Tier Matrix

- `anon`
  - public browsing only
  - 2-hour refresh cadence
  - no account-synced filters, calendar, saved items, or alerts
  - no dedicated anon pricing card
- signed-in `free`
  - 15-minute refresh cadence
  - feed filters on web, iOS, and Android
  - launch calendar page on web, iOS, and Android
  - one-off add-to-calendar from launch detail
  - basic mobile push alerts by launch, all US launches, or state
  - alert-rule management is account-shared and can be managed from web
  - no saved presets, default filter, follows, recurring feeds, browser push, RSS, embeds, AR, enhanced forecast, or launch-day email
- `premium`
  - 15-second refresh cadence
  - live feed and change log
  - saved filter presets and default filter
  - follows using current implemented follow types only: `launch`, `provider`, `pad`, `tier`
  - advanced alerts by saved filter preset and selected follows
  - recurring calendar feeds, RSS feeds, embed widgets
  - browser push, launch-day email, AR trajectory, enhanced forecast insights

## Contract Changes

- Make `canUseSavedItems` premium-only.
- Make `canUseLaunchFilters`, `canUseLaunchCalendar`, and `canUseOneOffCalendar` available to signed-in free and premium viewers.
- Keep `canUseInstantAlerts` as a temporary premium-only compatibility alias.
- Add additive capabilities:
  - `canManageFilterPresets`
  - `canManageFollows`
  - `canUseBasicAlertRules`
  - `canUseAdvancedAlertRules`
  - `canUseBrowserLaunchAlerts`
- Free limits become zero for presets, watchlists, and follow rules.
- Premium limits stay at `25` presets, `5` watchlists, and `200` follow rules.

## Backend Rollout

1. Update shared entitlement/domain/contracts first.
2. Add additive account-scoped alert rules under `/api/v1/me/alert-rules`.
3. Keep per-launch alert preferences for launch-detail alerts.
4. Allow free mobile push delivery while keeping browser push premium-only.
5. Keep premium tokenized integrations active only while premium access remains valid.

## Downgrade Rules

- Premium-only saved data remains stored but read-only when the viewer downgrades.
- Premium recurring calendar, RSS, and embed tokens stop returning premium data after downgrade.
- External calendar imports created from one-off ICS exports cannot be removed remotely.

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
