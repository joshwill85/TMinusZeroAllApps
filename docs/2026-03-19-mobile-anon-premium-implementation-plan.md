## Mobile Anon/Premium Implementation Plan

Date: 2026-03-19

Platform matrix
- Web: not included for customer UX
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

Scope
- Mobile moves to two effective product memberships: `anon` and `premium`.
- Signed-in unpaid mobile users keep account access but product capabilities match `anon`.
- Launch browsing stays US-first by default, while filters continue to support `Non-US` and `All locations`.

Implementation slices
1. Add a shared mobile entitlement projection so mobile UI resolves capabilities from `anon` or `premium` without changing the canonical backend billing tier model.
2. Update Feed, Saved, Calendar, Launch Detail, Profile, and Settings to use the mobile projection.
3. Keep filters open to all mobile users while gating saves, default preset, follows, Following/My Launches, recurring calendar feeds, and advanced notifications behind Premium.
4. Add a shared mobile toast with a 5 second timeout and inline undo action for follow mutations.
5. Make one-off launch ICS export public for mobile launch detail while keeping recurring calendar feeds premium.
6. Extend recurring calendar feeds with source metadata for `all_launches`, `preset`, and `follow`, while persisting the effective filters used by the token route.
7. Add additive mobile push-only notification routes and storage for guest and premium rules, without reusing the current email/SMS-focused mobile API surface.
8. Extend notification dispatch/send jobs to read the new mobile rule/device tables and deliver guest + premium push notifications.

Rollout / rollback notes
- Mobile entitlement projection is client-side and reversible without touching canonical billing state.
- Calendar feed source metadata is additive and keeps the existing tokenized feed behavior intact.
- Notification guest/premium v2 storage and routes are additive; legacy account-backed tables remain in place during migration.
- If the v2 notification pipeline regresses, mobile can fall back to read-only UI while preserving existing account-backed web behavior.

Verification set
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Open items tracked in code
- Mobile followable entities remain `launch`, `provider`, and `pad` in this pass.
- Mobile notifications are push-only; email and SMS controls are removed from mobile surfaces.
- Premium status-change filters will initially ship as `changed`, `go`, `hold`, `scrubbed`, and `tbd`.
