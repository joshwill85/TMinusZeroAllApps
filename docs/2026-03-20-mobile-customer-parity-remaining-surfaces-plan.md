# Mobile Customer Parity Remaining Surfaces

Date: 2026-03-20

## Platform Matrix

- Web: included as reference and additive `/api/v1` BFF work
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Scope: customer-facing only

## Shipped In This Slice

- Added additive `/api/v1` support for:
  - `news`
  - canonical `contracts`
  - `satellites`
  - `info`
  - `content`
  - `catalog`
- Added native mobile routes and screens for:
  - `News`
  - `Contracts`
  - `Satellites`
  - `Catalog`
  - `Docs`
  - `About`
  - `Info`
  - `Jellyfish Effect`
  - `Legal/Data`
  - `Legal/SMS`
  - `Unsubscribe`
- Updated shared mobile route normalization so supported first-party customer paths resolve natively instead of falling back to browser opens.
- Updated the mobile dock/search surfaces so the new native customer routes are discoverable in app.

## Shipped In Follow-On Polish Slice

- Added full native customer detail payloads and screens for:
  - `/launch-providers/[slug]`
  - `/providers/[slug]` as the mobile alias
  - `/rockets/[id]`
  - `/locations/[id]`
  - `/catalog/pads/[id]`
- Added additive `/api/v1` detail endpoints for:
  - `providers/[slug]`
  - `rockets/[id]`
  - `locations/[id]`
  - `pads/[id]`
- Replaced the thin entity timeline/search placeholders with native detail pages that carry:
  - hero metadata
  - facts and stats
  - connected internal links
  - provider-linked news where available
  - upcoming and recent launches
- Added mobile polish work for:
  - feed card `Share`, `Calendar`, `Alerts`, and `AR` actions
  - native recurring-feed entry points from feed/calendar surfaces
  - preset-based alert toggles on saved presets
  - launch-detail/internal-link normalization so supported first-party links stay native

## Rollout Notes

- First-party customer routes added in this slice should remain native-only on mobile.
- External publisher/source links remain external.
- Existing richer native entity/program routes still take precedence over generic catalog detail routes when normalization can resolve to a better native destination.

## Remaining Gaps After This Slice

- Feed/card/calendar depth is materially closer, but still does not match every web affordance and layout nuance.
- Search results for explicitly unsupported routes should remain hidden until a native destination exists.
- Program/content families outside the shipped native surfaces should continue to normalize to existing native routes and should not reintroduce first-party browser fallback.

## Verification Set

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
