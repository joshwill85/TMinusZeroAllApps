# 2026-04-04 Admin Surface Lockdown Plan

## Summary

- Hard-hide admin routes and admin APIs from outsiders.
- Remove admin wording from customer-facing web, iOS, and Android surfaces.
- Move admin access testing out of normal account/profile flows into dedicated admin-only destinations.
- Add regression coverage so customer routes cannot reintroduce admin links, copy, or controls.

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

## Implementation Notes

- Web `/admin/**` must gate in the server layout before any admin shell or copy renders.
- `/api/admin/**` and the admin access-override endpoint must return 404 for non-admin or signed-out callers.
- Customer account/billing/profile surfaces must use neutral entitlement wording even when access is granted through an admin role or override.
- Admin access testing moves to dedicated admin destinations:
  - Web: `/admin/access`
  - Mobile: `/admin/access`
- Normal customer nav and account surfaces must not expose admin links or admin labels.

## Verification

- Add a dedicated admin-surface guard script.
- Extend mobile E2E to confirm non-admin deep links to `/admin/access` land in the generic not-found experience.
- Run the pinned-toolchain validation set after implementation.
