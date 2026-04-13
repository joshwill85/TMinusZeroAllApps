# Calendar Feed-Mode Integration Plan

Last updated: 2026-04-12

## Scope Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: no
- Customer-facing or admin/internal: customer-facing

## Summary

- Bring the launch calendar into the same `For You / Following / Filters` product model as the main feed.
- Keep calendar state local to calendar.
- Keep the slice client-side and additive: no `/api/v1` or Supabase changes.
- Keep recurring calendar-feed infrastructure intact and out of the critical path for this work.

## Locked Decisions

- Calendar keeps month-bounded browsing and always queries with `sort='soonest'`.
- `Following` uses the existing primary `My Launches` watchlist and remains Premium-only.
- Calendar filters are the month-safe subset only:
  - `region`
  - `state`
  - `location`
  - `pad`
  - `provider`
  - `status`
- Saved presets remain shared with feed.
- Calendar ignores preset `range` and `sort` when applying or matching presets.
- Saving from calendar writes the visible month-safe filters plus canonical feed defaults:
  - `range='year'`
  - `sort='soonest'`

## Implementation Passes

### Pass 1: Shared Filter Helpers

- Add shared helpers in `packages/domain/src/launchFilters.ts` for:
  - calendar-safe filter extraction
  - calendar active-filter counting
  - calendar preset matching ignoring `range` and `sort`
  - calendar preset persistence back into feed-compatible filter payloads

### Pass 2: Mobile Calendar Integration

- Extend `LaunchFilterSheet` with a calendar variant that hides feed-only time controls while preserving saved-view actions.
- Add local `For You / Following / Filters` state to `apps/mobile/app/(tabs)/calendar.tsx`.
- Reuse the primary-watchlist auto-create flow for `Following`.
- Filter the month view locally from the month dataset so calendar keeps stable month navigation and option lists.

### Pass 3: Web Calendar Integration

- Add calendar-local URL state for:
  - `mode`
  - `region`
  - `status`
  - `provider`
  - `state`
  - `location`
  - `pad`
- Replace the current ad hoc filter row with a calendar-safe panel that includes saved-view actions.
- Add `For You / Following` controls and primary-watchlist auto-create behavior.
- Keep state isolated to `/calendar` and do not sync back to the home feed.

## Verification Set

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Acceptance Notes

- Web anon keeps usable `For You` calendar browsing.
- Premium users get `Following` on both web and mobile calendar.
- Empty-state copy distinguishes:
  - empty following setup
  - no followed launches this month
  - filter-narrowed zero-state
- One-off add-to-calendar stays unchanged.
- Recurring-feed create/share/rotate/delete behavior stays intact.
