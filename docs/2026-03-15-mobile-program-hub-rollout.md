# Mobile Program Hub Rollout

Date: 2026-03-15

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Land the first safe mobile parity slice for the three customer program hubs without changing current web behavior:

- add guest-safe rollout flags to the shared viewer session
- add native mobile route plumbing behind those flags
- ship Blue Origin first as the initial native hub family
- keep Artemis and SpaceX dark-shipped and unchanged for now

## Current Slice

This slice is intentionally additive and rollback-safe.

1. Shared contracts
- extend the viewer session payload with per-hub mobile rollout flags
- add Blue Origin mobile hub contracts for overview, missions, flights, travelers, vehicles, engines, and contracts

2. Web/API
- keep existing web pages and public routes unchanged
- add additive `/api/v1/blue-origin/*` wrappers backed by current server loaders
- read rollout flags from `system_settings` with safe false defaults on failure

3. Mobile
- add native Blue Origin routes under the same canonical pathname family used by web
- gate feed chips, search result routing, and Docking Bay links on rollout flags
- preserve current search/browser fallback whenever a route is not enabled or not yet implemented

## Rollout Keys

- `mobile_hub_blue_origin_native_enabled`
- `mobile_hub_blue_origin_external_deep_links_enabled`
- `mobile_hub_spacex_native_enabled`
- `mobile_hub_spacex_external_deep_links_enabled`
- `mobile_hub_artemis_native_enabled`
- `mobile_hub_artemis_external_deep_links_enabled`

## Rollback

- turning a hub `nativeEnabled` flag off returns mobile entry points to the current production fallback
- turning a hub `externalDeepLinksEnabled` flag off preserves browser handling for external links
- web routes remain canonical and unchanged throughout the rollout

## Verification Set

- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" node -v && npm -v`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run doctor`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run check:three-platform:boundaries`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run test:v1-contracts`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run test:mobile-query-guard`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run type-check:ci`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run type-check:mobile`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run lint`
- `PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run lint --workspace @tminuszero/mobile`

