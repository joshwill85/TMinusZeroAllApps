# 2026-04-04 Mobile Live Search Rollout Plan

## Platform matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Scope: customer-facing

## Goal

Ship live search on mobile with a hard cap of the top 3 results while keeping the shared search stack low-cost, safe, and broad enough to cover customer-facing assets without requiring native parity for every destination.

## Implementation slices

1. Mobile live-search UX
   - Query from draft input instead of submit-only route state.
   - Debounce route updates and search requests.
   - Limit visible results to the top 3.
   - Preserve deep-linkable `q` route state.
2. Shared search safety
   - Add durable rate limiting to `/api/v1/search`.
   - Keep cache headers and no read-time index refresh behavior.
3. Customer-facing route coverage
   - Stop hiding internal customer results on mobile when no native route exists.
   - Open non-native internal hits in the hosted site browser flow.
   - Expand static indexed pages and hubs for obvious customer-facing surfaces.
4. Verification updates
   - Adjust mobile E2E expectations to reflect live results rather than submit-only search.

## Contract and API notes

- No breaking `/api/v1/search` contract changes.
- Mobile will pass `limit=3` to the existing search route.
- Result routing remains client-side:
  - native route when available
  - hosted web fallback for internal customer routes
  - external browser for absolute URLs

## Rollout order

1. Shared API rate limit hardening
2. Mobile live-search behavior
3. Mobile fallback routing for web-only customer pages
4. Search registry coverage expansion
5. E2E expectation update

## Rollback

- Revert mobile live-search UI independently without changing the backend response shape.
- Revert `/api/v1/search` rate limiting independently if it proves too aggressive.
- Revert individual static registry entries without affecting search core behavior.

## Unresolved decisions

1. Whether to add popularity-based suggestions later
2. Whether to rank native results ahead of web-fallback results on mobile
3. Whether to add more first-class result types beyond the current shared schema

## Verification set

- `node -v && npm -v`
- `npm run doctor`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Current local blocker

- Local shell toolchain does not match repo pins in this workspace right now.
- Docker daemon is also unavailable, so runtime verification may need follow-up once the pinned environment is restored.
