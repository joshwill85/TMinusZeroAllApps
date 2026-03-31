# Push-Only Notification Cutover Plan

Date: 2026-03-29

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope type: customer-facing plus shared backend/admin language cleanup

## Product Decision

- Retire SMS notifications.
- Retire notification email delivery, including launch-day notification email.
- Retire browser/web push delivery and browser-based notification management.
- Keep native iOS/Android push as the only user-facing alert channel.
- Keep essential non-notification email unchanged:
  auth/account recovery, billing/service mail, support replies, and marketing email preference/unsubscribe.

## Safety Mode

- Use a phase-1 compatibility cutover rather than destructive deletion.
- Keep historical database rows, tables, migrations, and compatibility fields in place.
- Legacy read APIs return safe retired values during the compatibility window.
- Legacy write APIs reject retired-channel mutations with an explicit retirement error.
- Preserve the newer native mobile push v2 flow and the shared alert-rule path that already maps to push-only rules.

## Implementation Slices

1. Backend/API retirement
- Centralize legacy-channel retirement behavior in the web BFF.
- Keep `/api/v1/mobile/push/*` as the only writable mobile notification path.
- Return safe retired payloads from old preference and launch-notification reads.
- Reject SMS/email/browser-push mutation attempts with `native_mobile_push_only`.

2. Dispatch/send cutover
- Stop creating SMS, email, and browser-push work in dispatch jobs.
- Continue only mobile push v2 delivery.
- Mark queued/processing legacy outbox rows as skipped/retired instead of deleting them.

3. Stored state normalization
- Add an additive migration that disables legacy preference booleans, deactivates web-push destinations, and removes `email`/`sms` from unified rule channel arrays.
- Do not drop legacy columns or tables in this cutover.

4. Customer surface cleanup
- Web notifications UI becomes mobile-app-only messaging.
- Remove SMS/email/browser-push wording from mobile and web customer/legal/docs copy.
- Keep marketing-email controls intact.

5. Verification
- Use the pinned toolchain before final verification.
- Run shared boundary, contract, typecheck, and lint tasks after implementation.

## Rollback Notes

- Re-enable legacy routes and workers by reverting this cutover slice; no schema rollback is required because the migration is additive and non-destructive.
- Historical notification data remains intact for audit/recovery.
