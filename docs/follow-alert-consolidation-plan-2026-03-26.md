# Unified Notifications and Following Overhaul Plan

Date: 2026-03-26

## Platform Matrix
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing: yes

## Goals
- Remove `free` and normalize every non-premium viewer to `anon`.
- Collapse reminders, alert rules, launch-level notification prefs, and guest push rules into one notification rule system.
- Keep `Follow` as the primary customer action while making it notification-backed under the hood.
- Give anon exactly one launch follow and one state follow with push delivery.
- Replace watchlist-backed follows with a single `Following` collection and adapter-backed compatibility during rollout.

## Locked Decisions
- `Follow` stays the visible action on cards and detail.
- `Notifications` is the umbrella settings surface.
- `Reminder` is only a rule setting, not a separate product area.
- `Anon` gets push only, with one launch rule and one state rule.
- `Anon` state follow sends launch reminders only. No daily digest.
- Premium gets launch, rocket, provider, pad, launch site, and state follows plus advanced channels and settings.

## Implementation Order
1. Shared contracts and entitlement cleanup
2. Unified notification tables, compatibility migration, and helper layer
3. Route adapters and dispatch/send cutover
4. Web and mobile grouped follow UI plus notifications copy cleanup
5. Legacy route/table freeze and cleanup

## Storage Direction
- Canonical stores:
  - `notification_push_destinations_v3`
  - `notification_rules_v3`
  - extended `notifications_outbox`
- Legacy stores remain temporarily for compatibility/backfill:
  - `watchlists`
  - `watchlist_rules`
  - `launch_notification_preferences`
  - `notification_alert_rules`
  - `mobile_push_installations_v2`
  - `mobile_push_rules_v2`
  - `mobile_push_outbox_v2`
  - `push_subscriptions`

## Compatibility Rules
- Old watchlist APIs read/write unified follow rules through a synthetic single collection.
- Old launch notification APIs read/write unified launch-scoped rules.
- Old alert-rule APIs read/write unified state, preset, and follow rules.
- Old mobile-push APIs read/write unified push destinations and unified push-backed rules.
- Calendar/feed follow sources continue to use follow scope metadata during the compatibility window.

## Verification
- Run under pinned Node/npm only.
- Required checks after implementation:
  - `npm run doctor`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:smoke`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
