# 2026-04-11 Anon/Premium Alignment and Retirement Plan

Platform matrix:
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing or admin/internal: customer-facing with backend/admin enforcement updates

## Summary

Align anon versus premium behavior to one canonical entitlement model, remove retired browser-alert and launch-day-email drift, and harden premium-only forecast data so public detail paths cannot fetch or return it.

## Implementation

1. Canonicalize entitlement capabilities and limits in `packages/domain/src/viewer.ts`.
   - Keep one-off calendar, launch filters, search, calendar browsing, single-launch follow, and `All U.S.` basic alerts available to anon.
   - Retire `canUseBrowserLaunchAlerts` and `canUseLaunchDayEmail` as active capabilities by forcing them off everywhere.
   - Keep `canUseEnhancedForecastInsights` as the single premium forecast capability.

2. Remove capability drift across web bootstrap and helper layers.
   - Build guest web entitlements from the shared domain capability and limit helpers instead of maintaining a second hand-written matrix.
   - Replace duplicated web-only tier helpers with thin re-exports or wrappers around the shared domain layer.
   - Update premium and mode-status copy so it refers to native push notifications instead of browser alerts.

3. Harden mobile push rule ownership and editor behavior.
   - Keep anon on guest or installation-scoped push rules and premium on account-owned user rules.
   - Move reminder-window options and max-offset rules into a shared constant set used by backend validation and mobile editors.
   - Align the mobile Preferences broad-rule editor with backend scope rules:
     - launch detail basic reminders: `1, 5, 10, 60`
     - premium reminders: `1, 5, 10, 30, 60, 120, 360, 720, 1440`
     - guest `all_us` broad rules: one reminder offset
     - premium broad rules: up to three reminder offsets

4. Split public detail from premium forecast enrichment.
   - Stop fetching WS45 forecast, operational, and planning weather for the cached public detail core.
   - Fetch premium forecast data only when the resolved entitlement allows `canUseEnhancedForecastInsights`.
   - Add a serializer-level safety filter so anon and public payloads cannot include premium weather cards even if a future caller over-fetches.
   - Keep public NWS and other intentionally free weather surfaces available.

5. Retire launch-day email as a product feature.
   - Keep response schemas wire-compatible for now, but always return disabled defaults.
   - Remove launch-day email from premium capability/copy surfaces.
   - Stop launch-day email dispatch work in `supabase/functions/notifications-dispatch`.
   - Leave physical DB column removal and contract field deletion for a later compatibility cleanup.

## Verification

- `npm run doctor`
- `npm run test:shared-domain`
- `npm run test:gating-alignment-guard`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run check:three-platform:boundaries`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Guardrails

- No breaking `/api/v1` removals in this change.
- No browser-alert revival.
- No launch-day-email UI restoration.
- No changes that widen anon access beyond the audited free surface.
