# SMS Hard-Cut Purge Plan

## Summary

- Remove SMS and Twilio from all live product code, shared contracts, current customer-facing content, test fixtures, and active configuration.
- Break legacy SMS API compatibility immediately. Deleted SMS endpoints should disappear rather than return retired responses.
- Drop SMS database schema and data without archival by shipping a new destructive migration.
- Do not keep SMS-named public routes or replace them with a new standalone notification-policy page. Notification setup lives in `/preferences`; legal context stays in existing privacy and terms pages.
- Keep dated historical docs and past migrations intact as historical records.

## Implementation Changes

### Shared contracts and client

- Remove SMS verification request/response schemas, types, and API client methods.
- Remove SMS fields from notification preference contracts and account export payloads.
- Make launch-notification APIs push-only and remove SMS channel branches from payloads and client methods.
- Remove `sms` from active notification channel and delivery enums while preserving the remaining push and email values.

### Web and mobile surfaces

- Delete SMS/Twilio API routes and retired compatibility shims.
- Delete SMS-named docs and legal routes, mobile route screens, deep-link mappings, sitemap entries, FAQ references, and mobile reference aliases.
- Point any remaining notification-policy entry points at `/preferences`, `/legal/privacy`, or `/legal/terms` as appropriate.

### Backend and schema

- Remove SMS branches, counters, settings, and result fields from notification dispatch/send code.
- Remove active Supabase config and local env references for Twilio and SMS.
- Add a new migration that deletes SMS data, drops SMS columns and tables, and tightens channel constraints so SMS is no longer allowed.

### Verification

- Run pinned-toolchain checks for contracts, boundaries, typecheck, lint, and the affected smoke/guard scripts.
- Confirm deleted SMS routes return 404, notification payloads contain no SMS fields, account export omits SMS history, and the notification jobs no longer reference SMS schema or settings.
