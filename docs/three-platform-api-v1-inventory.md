# Three-Platform API Inventory and `/api/v1` Mapping

Last updated: 2026-03-08

This inventory captures the current route surface and maps the mobile-critical product flows to the planned `/api/v1` contracts.

## Current Route Surface Snapshot

- Total `apps/web/app/api` route files: `135`
- `apps/web/app/api/public/*`: `46`
- `apps/web/app/api/me/*`: `30`
- `apps/web/app/api/admin/*`: `18`

Current migration hotspots by raw browser `/api/*` usage:

- `apps/web/app/me/preferences/page.tsx`
- `apps/web/app/account/page.tsx`
- `apps/web/components/BillingPanel.tsx`
- `apps/web/components/LaunchFeed.tsx`
- `apps/web/app/legal/privacy-choices/privacy-choices-client.tsx`
- `apps/web/app/account/integrations/page.tsx`

## Mobile-Core Contracts

| Product surface | Current source of truth | Planned `/api/v1` contract | Auth mode | Phase notes |
| --- | --- | --- | --- | --- |
| Viewer session | Browser Supabase auth state plus `/api/me/profile` and `/api/me/subscription` | `GET /api/v1/viewer/session` | Cookie or bearer | Single normalized session read path |
| Entitlements | `/api/me/subscription` | `GET /api/v1/viewer/entitlements` | Cookie or bearer | Remove read-time Stripe reconciliation |
| Launch feed | `/api/public/launches` | `GET /api/v1/launches` | Public | Remove admin retry fallback on hot path |
| Launch detail | `apps/web/app/launches/[id]/page.tsx` server composition plus public subresource routes | `GET /api/v1/launches/:id` | Public core + entitled subresources | Initial canonical JSON detail route now exists, but richer parity extraction is still pending |
| Search | `/api/search` | `GET /api/v1/search` | Public | Move warm/sync behavior off request path |
| Profile | `/api/me/profile` | `GET /api/v1/me/profile`, `PATCH /api/v1/me/profile` | Cookie or bearer | Normalize current `POST` update path |
| Watchlists | `/api/me/watchlists`, `/api/me/watchlists/[id]`, `/rules`, `/launches` | `/api/v1/me/watchlists/*` | Cookie or bearer | Preserve capability/limit checks |
| Filter presets | `/api/me/filter-presets`, `/api/me/filter-presets/[id]` | `/api/v1/me/filter-presets/*` | Cookie or bearer | Shared contract with saved-items UI |
| Notification preferences | `/api/me/notifications/preferences` | `GET/PATCH /api/v1/me/notification-preferences` | Cookie or bearer | Legacy read shape remains for compatibility; write attempts retire to native-mobile-push-only |
| Launch-specific notifications | `/api/me/notifications/launches/[id]` | `GET/PATCH /api/v1/me/launch-notifications/:launchId` | Cookie or bearer | Legacy read shape remains disabled; launch alert management now lives in native mobile push flows |
| Push device registration | `/api/me/notifications/push/subscribe`, `/unsubscribe`, `/test` | `POST /api/v1/me/devices/push` and `DELETE /api/v1/me/devices/push/:deviceId` | Cookie or bearer | Web/browser push routes are retired; native mobile device registration remains the supported path |

## Later-Phase Non-Admin User Features

These stay out of mobile core but are part of the end-state parity target:

| Product surface | Current source of truth | Planned `/api/v1` contract family |
| --- | --- | --- |
| Calendar feeds | `/api/me/calendar-feeds/*`, `/api/calendar/[token]`, `/api/launches/*/ics` | `/api/v1/me/calendar-feeds/*` |
| RSS feeds | `/api/me/rss-feeds/*`, `/app/rss/[token]` | `/api/v1/me/rss-feeds/*` |
| Embed widgets | `/api/me/embed-widgets/*`, `/api/embed/next-launch` | `/api/v1/me/embed-widgets/*` |
| Privacy/export/delete account | `/api/me/privacy/preferences`, `/api/me/export`, `/api/me/account/delete` | `/api/v1/me/privacy/*`, `/api/v1/me/export`, `/api/v1/me/account/delete` |
| Billing summary/manage | `/api/me/subscription`, `/api/billing/*` | `/api/v1/viewer/entitlements`, `/api/v1/me/billing/*` |

## Out of Scope for `/api/v1` Mobile Core

- `apps/web/app/api/admin/*`
- `apps/web/app/api/tipjar/*`
- OG/debug routes
- Internal revalidation routes
- Program/editorial public content routes that are not required for core mobile journeys

## Implementation Constraints

- `/api/v1` is additive-only within v1.
- Legacy `app/api/public/*` and `app/api/me/*` routes stay functional until both web and mobile are migrated.
- Native clients use `Authorization: Bearer <Supabase access token>`.
- Initial `/api/v1` read routes now exist for session, entitlements, launches, launch detail, search, profile, watchlists, filter presets, notification preferences, launch notifications, and push-device registration.
- Launch detail still needs deeper extraction from the page composition for full parity with the current web detail experience.
