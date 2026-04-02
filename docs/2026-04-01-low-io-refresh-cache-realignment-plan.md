# 2026-04-01 Low-IO Refresh Cache Realignment Plan

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Scope: customer-facing

## Goal

Keep background freshness checks and UI application separate, stop customer gestures from triggering provider fetches, and align anonymous infrastructure cache policy with the public 2-hour product cadence.

## Approved Behavior

### Premium mobile

- Feed pull-down only applies a pending live update that background polling already discovered.
- Feed pull-down does not trigger a fresh payload fetch when nothing newer is pending.
- Launch detail pull-down applies a pending update immediately.
- If launch detail has no pending update, pull-down performs one cheap detail-version check and only fetches the detail payload when the version is newer.

### Anonymous mobile

- Feed and launch-detail pull-down perform no network request.
- Pull-down shows a top banner with the next scheduled public refresh time.
- That banner includes the standard mobile Premium CTA: `Go Premium for near-live data`.
- Scheduled public updates auto-apply when the background public version check detects a newer snapshot, so anon users are not stranded on stale UI.

### Backend and cache policy

- Customer feed/detail request paths remain DB/cache-only.
- Request-time LL2 fallback is removed from booster enrichment.
- Feed/detail payload and version routes are protected with durable route rate limits.
- Anonymous homepage/public feed/AR-eligibility cache buckets move from `60s` to `600s`.
- Public feed metadata now advertises the customer-visible public cadence: `120 minutes`.

## Rollout Notes

1. Land mobile gesture behavior changes first so pull-down semantics match product policy.
2. Lock down customer request paths and rate limits on the server.
3. Realign public cache TTLs and public cadence metadata.
4. Update regression guards to enforce the new contract.

## Verification Set

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
