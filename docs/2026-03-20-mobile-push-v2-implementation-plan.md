# Mobile Push V2 Implementation Plan

Date: 2026-03-20

## Platform Matrix
- Web: not included for customer UX
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Scope
- Finish the additive mobile push v2 stack for the native app.
- Keep this work isolated from the parallel anon/premium tier-removal session.
- Treat notifications as push-only on mobile.

## Deliverables
- Additive mobile push v2 send-path support in Supabase jobs.
- Guest/basic and premium/advanced mobile push rule delivery.
- Device ownership cleanup so a single installation does not stay active under both guest and user ownership.
- Preferences UI alignment so anon users can see premium notification sources in a gated state.

## Rules
- Guest/basic scopes:
  - `all_us`
  - `state`
  - `launch`
- Premium scopes:
  - guest/basic scopes plus `all_launches`, `preset`, and `follow`
- Guest/basic delivery:
  - one prelaunch offset only
- Premium delivery:
  - up to three prelaunch offsets
  - optional daily digest time
  - optional status-change filters
  - optional NET-change alerts

## Backend Plan
1. Dispatch into `mobile_push_outbox_v2` from `mobile_push_rules_v2`.
2. Claim and send `mobile_push_outbox_v2` rows through Expo push.
3. Update `mobile_push_installations_v2` send/receipt/failure state per installation.
4. Requeue retryable failures and fail stale locks independently from the legacy notification tables.
5. Preserve the legacy email/SMS/browser push stack while mobile migrates to v2.

## Mobile Plan
1. Keep device registration device-scoped, not account-global.
2. Use launch detail for launch-scoped rules.
3. Use Preferences for broad rules.
4. Show premium-only sources and advanced controls to anon in a gated state.

## Rollout Notes
- This slice is additive and should not break legacy `/api/v1/me/*` notification flows.
- Signed-in unpaid users continue to resolve through the guest/basic mobile push path.
- The separate anon/premium membership cleanup can migrate product labels and entitlement helpers independently.

## Verification
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`

## Rollback
- Disable the new mobile routes and stop dispatching `mobile_push_outbox_v2`.
- Existing legacy notification jobs remain available while v2 is being hardened.
