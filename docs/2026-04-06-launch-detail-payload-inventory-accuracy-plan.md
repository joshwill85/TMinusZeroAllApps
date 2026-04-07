# 2026-04-06 Launch Detail Payload Manifest And Inventory Accuracy Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Problem statement

- The shared `/api/v1/launches/[id]` payload currently collapses multiple inventory states into the same visible output.
- For launches where CelesTrak inventory is `pending` or `catalog_empty`, the RPC still returns a zero-filled reconciliation object.
- The shared launch-detail consumers surface those zeros as badge chips, which reads like real data instead of "not available yet".
- The shared tabbed mission surfaces also dropped the canonical web page's fallback payload summary when LL2 manifest rows are absent.

## Audit summary

- Canonical web full-page launch detail already preserves inventory status and shows state-aware copy for `pending`, `catalog_empty`, and `error`.
- Canonical mobile launch detail and the shared web/mobile tab mission views only receive `summaryBadges` plus object lists, so they cannot distinguish status states.
- Live production samples confirm:
  - `1957-001` returns `catalog_available` with one payload object and one rocket body.
  - `2026-067` and `2026-068` return `catalog_empty` with zero-filled reconciliation counts and no objects.
- LL2 manifest coverage is inherently sparse for some launch families. When LL2 rows are empty, the canonical web page still falls back to `launch.payloads`; the shared tabbed mission views do not.

## External source validation

- Launch Library 2 is the authoritative upstream launch/detail source we use for payload manifest rows and documents launch data plus payload-flight resources.
- CelesTrak supplemental GP queries support `INTDES` lookups for all objects associated with a launch designator.
- CelesTrak SATCAT exposes launch-associated object classifications such as payload, rocket body, debris, and unknown/non-standard records; these should only be presented as counts when catalog evidence exists.

## Implementation

### Phase 1: additive contract and payload shaping

- Extend the shared launch-detail inventory contract with additive status and reconciliation fields:
  - launch designator
  - inventory status/freshness
  - normalized reconciliation counts
- Keep current object lists intact.
- Change badge construction so `pending`, `catalog_empty`, and `error` inventories do not render misleading zero-count summary chips.

### Phase 2: shared mission UI parity

- Update `packages/launch-detail-ui` to:
  - derive inventory status copy from the additive fields
  - expose meaningful inventory stats only when they reflect real catalog evidence
  - expose a payload-summary fallback sourced from `launchData.payloads` when LL2 manifest rows are absent
- Update web and mobile mission tab components to render:
  - payload manifest when available
  - payload summary fallback when manifest is absent
  - inventory status copy instead of seven zero badges when catalog evidence is absent

### Phase 3: canonical mobile parity

- Update `apps/mobile/app/launches/[id].tsx` so the canonical mobile page matches the same inventory-state behavior and payload fallback behavior as the shared tab views.

## Rollout order

1. Additive contract updates in `packages/contracts`.
2. `/api/v1` launch detail shaping in `apps/web/lib/server/v1/mobileApi.ts`.
3. Shared extraction/model updates in `packages/launch-detail-ui`.
4. Web/mobile mission UI updates.
5. Canonical mobile full-page launch detail update.
6. Verification under the pinned toolchain.

## Rollback notes

- The contract change is additive and older consumers can ignore the new fields.
- Inventory badge suppression is presentation-only and can be reverted independently from the backend shape extension.
- Payload summary fallback uses already-available launch data and does not change upstream persistence.

## Verification

- Required after switching the shell back to Node `20.19.6` and npm `10.8.2`:
  - `node -v && npm -v`
  - `npm run doctor`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
- Targeted data checks:
  - a `catalog_available` launch still shows counts and objects
  - a `catalog_empty` launch shows status copy instead of seven `0` badges
  - a launch with no LL2 manifest rows but `launch.payloads` data shows a payload fallback summary
