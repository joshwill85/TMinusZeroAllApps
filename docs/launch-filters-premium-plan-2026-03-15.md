# Launch Filters Premium Three-Platform Plan

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Bring the current web launch-feed filter model to native feed surfaces and make launch filters a Premium feature across customer-facing surfaces, while keeping default unfiltered browsing available and avoiding accidental changes to watchlists or follows.

## Source Of Truth

- Web filter UX and behavior: `apps/web/components/LaunchFeed.tsx`
- Web filter options endpoint: `apps/web/app/api/filters/route.ts`
- Shared filter value schema: `packages/contracts/src/index.ts`
- Shared launch-feed request shape: `packages/api-client/src/index.ts`, `packages/query/src/index.ts`
- Current mobile feed entry point: `apps/mobile/app/(tabs)/feed.tsx`
- Current mobile preset read surface: `apps/mobile/app/(tabs)/preferences.tsx`
- Three-platform architecture anchor: `docs/three-platform-overhaul-plan.md`

## Current State

- Web currently supports eight filter keys: `range`, `sort`, `region`, `location`, `state`, `pad`, `provider`, and `status`.
- Web filter state, normalization, equality, defaults, and active-count logic all live inside `apps/web/components/LaunchFeed.tsx`; none of that behavior is shared today.
- Web dynamic facet options come from `/api/filters`; that route is web-only and is not exposed through `/api/v1` or `packages/api-client`.
- Web filter controls are effectively auth-gated today, not Premium-gated. Free signed-in users can still use filters and saved presets because the current flow piggybacks on auth and `canUseSavedItems`.
- That behavior has drifted from the earlier Premium intent documented in `docs/premium-phases-implementation-plan.md`, which treated presets as Premium-only.
- Mobile feed is hardcoded to an unfiltered public feed. There is no native filter state, no filter-options query, no Premium gate, and no preset create/update/delete flow.
- Mobile can read filter presets today, but only as a passive list in Preferences.

## Recommended Product Decisions

- Treat launch filters as Premium across web, iOS, and Android.
- Keep default unfiltered browsing available to guest and free viewers so the launch feed remains open.
- Do not reuse `canUseSavedItems` for filter access unless we intentionally want to re-lock watchlists and follows too.
- Add an explicit launch-filter entitlement capability and a filter-preset limit so filter monetization can evolve independently from watchlist rules.

## Phase 0: Entitlement Split

- Add additive entitlement fields in shared domain and contracts, for example `capabilities.canUseLaunchFilters` and `limits.filterPresetLimit`.
- Update server entitlement resolution so Premium and admin viewers get filter access; guest and free viewers do not.
- Keep `canUseSavedItems` unchanged unless product separately decides to re-scope watchlists.
- Define downgrade behavior explicitly: if a viewer loses filter access, reset active UI state to the default feed instead of leaving a locked preset or filtered session applied.

## Phase 1: Shared Filter Foundation

- Extract the launch-filter model out of `apps/web/components/LaunchFeed.tsx` into shared helpers in `packages/domain` or `packages/contracts`.
- Shared helpers should cover:
  - defaults
  - normalization
  - equality
  - active-filter counting
  - surface-neutral labels where useful
- Add a versioned shared filter-options API instead of relying on web-only `/api/filters`.
- Recommended endpoint shape: `/api/v1/launches/filter-options`.
- Request parameters should match the current web dependency model: `mode`, `range`, `region`, `location`, `state`, `pad`, `provider`, and `status`.
- Add shared API-client and query support for filter options and preset mutations so web and mobile stop re-implementing transport details separately.

## Phase 2: Web Premium-Gate Realignment

- Change `LaunchFeed` so filter entry points are gated by the new Premium filter capability instead of plain auth state.
- Keep the filter affordance visible for guest and free viewers, but route interaction to the existing upsell pattern instead of hiding the feature entirely.
- Keep Following and watchlist actions on their own entitlement path so this change does not silently alter saved-item behavior.
- Align preset save, apply, and default behavior with the new filter capability and the new filter-preset limit.
- Reconcile current web behavior with the Premium intent already documented in `docs/premium-phases-implementation-plan.md`.

## Phase 3: Native Feed Parity

- Add a filter entry point to `apps/mobile/app/(tabs)/feed.tsx`, using a native sheet or modal rather than a direct web layout clone.
- Mirror the web filter fields and ordering:
  - Time: `range`, `status`, `sort`
  - Location: `region`, `location`, `state`
  - Mission: `provider`, `pad`
- Match web behavior for:
  - reset to defaults
  - active-filter count
  - dependent option loading
  - preset apply, save, and default flows once shared mutations exist
- For Premium viewers, resolve feed mode with the same entitlement logic as web so filtered results do not diverge by platform.
- For locked viewers, show native Premium CTAs that hand off to the existing billing path in `apps/mobile/app/(tabs)/profile.tsx`.

## Phase 4: Preset And Settings Parity

- Upgrade mobile from read-only preset display to actionable preset management.
- Minimum parity set:
  - apply a preset from Feed
  - save the current filter set
  - set a default preset
- If rename and delete are not part of the first native slice, keep them available in a dedicated management surface and track full parity as follow-up.
- Decide whether preset management lives entirely in the feed filter sheet, in Preferences, or split between quick apply on Feed and deeper management in Preferences.
- Keep the server contract additive so existing preset consumers remain compatible during rollout.

## Rollout Order

1. Entitlement capability and limit split
2. Shared `/api/v1` filter-options contract plus client and query plumbing
3. Web Premium gating and regression hardening
4. Mobile filter apply and reset UX
5. Mobile preset management parity
6. Analytics and copy polish

## Key Risks

- Reusing `canUseSavedItems` would widen blast radius and could unexpectedly re-lock watchlists and follows.
- Keeping `/api/filters` web-only would force mobile-specific drift and duplicate filter-option logic.
- Mobile parity will stay shallow if we ship only local controls without preset and default behavior.
- Premium downgrades need a clean fallback path or users can land in a filtered state they can no longer edit.

## Rollback Notes

- Phase 0 and Phase 1 must be additive so current feed behavior keeps working during rollout.
- Web gating can ship behind a flag if we want to stage Premium copy before the native surface is ready.
- Mobile UI can ship independently once shared contracts are live.

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
- targeted web feed smoke around Premium gating
- targeted iOS and Android feed smoke around filter apply, reset, and locked-state upgrade flow
