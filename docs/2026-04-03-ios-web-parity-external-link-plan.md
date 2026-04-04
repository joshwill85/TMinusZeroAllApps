# 2026-04-03 iOS vs Web Parity and External-Link Reduction Plan

## Platform matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: customer-facing plus admin/internal parity boundaries

## Goal

Reduce avoidable iOS link-outs, close the remaining meaningful iOS-vs-web customer gaps, and make outbound-link behavior consistent across native surfaces without widening intentionally web-only product areas.

## Non-goals

- Do not port admin, ops, billing override, or other internal tooling to mobile.
- Do not port web-only SEO, share, sitemap, embed-hosting, or browser distribution pages into native screens.
- Do not replace App Store, Google Play, map-provider, or calendar-provider destinations with in-app copies.
- Do not attempt broad article ingestion or a generic in-app browser rewrite in the first slice.

## Repo-backed current state

### Real iOS customer gaps

1. SpaceX drone ship pages are web-only today.
2. Program-hub root entry points are rollout-gated on mobile and can still fall back to core provider routes.
3. FAA raw NOTAM text is not rendered natively; launch detail links out to FAA pages instead.

### Intentionally web-only surfaces

1. Admin and ops tooling remain web-only.
2. Share, embed, sitemap, and app-association pages remain web-only.
3. Web Stripe `/upgrade` and tip-jar flows remain web-only; mobile uses native billing and store management links.
4. Hosted mobile-auth helper pages remain web infrastructure, not native parity targets.

### Already-native or mostly-native surfaces

1. Launch feed, launch detail, search, saved, preferences, account basics, docs/legal, contracts, satellites, catalog, and core entity detail surfaces already render primary product value natively.
2. Most current outbound links are source, official, provider-action, or media links rather than evidence of missing native product pages.

## Outbound-link policy

Use three buckets only.

### Bucket A: keep external

These should stay external because the destination is the product.

1. Billing and subscription management:
   - App Store / Google Play management
   - delete-account subscription-management handoff
2. Maps:
   - Apple Maps / Google Maps pad navigation
   - external map destinations from launch detail and FAA map
3. Calendar provider actions:
   - Google Calendar
   - Outlook Calendar
   - `webcal://` subscription handoff
4. Live media:
   - webcast streams
   - social video posts
   - YouTube / X / external live coverage
5. Official/source pages where verification matters more than in-app rendering:
   - NASA mission/source pages
   - FAA official graphics page
   - USAspending / SSC / Defense source pages
   - provider official vehicle or engine pages

### Bucket B: keep native first, external second

These already have enough in-app value to keep users in the app first, with external links reduced to secondary source actions.

1. Launch detail:
   - countdown, status, weather/JEP, FAA summary, maps preview, related links remain native
   - source/coverage links stay secondary actions
2. Contracts:
   - facts, family members, related routes stay native
   - source record stays secondary
3. Catalog:
   - facts, related launches, native cross-links stay native
   - info/wiki/source links stay secondary
4. Entity detail:
   - provider, rocket, location, and pad detail stay native
   - official/source links stay secondary
5. Program hubs:
   - mission pages, related flights, linked entities, and in-house contract facts stay native
   - official/source links stay secondary

### Bucket C: bring in natively next

These are the best current candidates to reduce link-outs.

1. SpaceX drone ship list and detail pages
2. FAA raw NOTAM text presentation inside launch detail
3. Program-hub root entry parity once rollout gating is intentionally enabled for mobile

## Screen-by-screen rules

### Launch card and launch detail

Keep external:

1. webcast and replay destinations
2. Apple Maps / Google Maps opens
3. FAA graphic/source page

Bring in or improve natively:

1. render FAA raw NOTAM text in-app
2. keep all launch-resource lists grouped under native sections before source actions
3. standardize non-map, non-billing, non-calendar source links through the in-app browser helper instead of mixing direct `Linking.openURL`

### News

Keep external for now:

1. article destinations

Reason:

1. current mobile news already provides native discovery and launch linkage
2. full native article reading would require a separate ingestion/licensing decision

### Contracts

Keep native first:

1. contract facts
2. family members
3. related native routes

Keep external second:

1. USAspending and agency source links

No immediate parity gap here.

### Satellites and catalog

Keep native first:

1. detail facts
2. related launch links
3. native owner/entity routes where available

Keep external second:

1. source, wiki, and external owner/profile links

No immediate parity gap here.

### Entity detail

Keep native first:

1. provider, rocket, pad, and location detail

Keep external second:

1. official pages and external references

No immediate parity gap here.

### Program hubs

Keep native first:

1. mission hubs
2. related launch and entity routes
3. internal contract facts and grouped in-house records

Keep external second:

1. official mission pages
2. official vehicle/engine pages
3. source records and public update links

Bring in next:

1. enable consistent native root-entry routing after rollout validation
2. do not replace official/source pages with scraped copies

### Billing and account deletion

Keep external:

1. App Store / Play subscription management

No native replacement should be attempted.

### Docs, legal, and info hub

Keep native:

1. first-party docs and legal pages

Keep external second:

1. explicit external source actions only

No parity gap here.

## Exact parity tickets

### Ticket 1: Native SpaceX drone ship pages

Goal:

1. add native list and detail screens for drone ships
2. route `/spacex/drone-ships` and `/spacex/drone-ships/[slug]` to native mobile destinations
3. unhide those results from mobile search

Scope:

1. shared contract/additive `/api/v1` payload if needed
2. mobile route screens
3. navigation normalization
4. mobile search support

Why first:

1. it is the clearest real customer-facing web-only gap
2. the web content model already exists, so risk is lower than inventing a new surface

### Ticket 2: Native FAA raw NOTAM sheet

Goal:

1. show raw NOTAM text in a native sheet or expandable panel on launch detail
2. keep the FAA graphic page as the external official-source action

Scope:

1. shared/mobile payload addition only if current FAA data shape lacks raw text
2. launch-detail UI
3. FAA map/detail consistency checks

Why second:

1. reduces avoidable launch-detail link-outs
2. fits an existing native FAA feature area

### Ticket 3: Outbound-link handler normalization

Goal:

1. route source/reference links through one in-app browser helper
2. reserve direct `Linking.openURL` for:
   - maps
   - billing/store management
   - calendar-provider handoff
   - live media when direct app handoff is preferred

Scope:

1. mobile launch detail
2. related/live tabs
3. customer route screens
4. program-hub source-link rows

Why third:

1. this is cleanup and consistency work, not a missing product surface
2. it should follow the first native-content win

### Ticket 4: Program-hub root rollout completion

Goal:

1. move supported program-hub entry points to always-native mobile routes when product signs off

Scope:

1. rollout flags
2. search/index expectations
3. entry-link normalization

Why later:

1. detail routes already exist
2. this is rollout policy more than raw missing capability

## Safest first slice

Ship this order.

1. Ticket 2 first if the goal is lowest-risk link reduction:
   - contained mobile launch-detail work
   - no broad navigation or search impact
   - immediate reduction in avoidable external FAA exits
2. Ticket 1 next if the goal is highest-value parity:
   - closes the largest true content gap
   - requires additive route/data work but stays well-scoped
3. Ticket 3 after that:
   - standardizes outbound behavior once the first native gap is closed
4. Ticket 4 last:
   - rollout/policy change rather than foundational missing content

Recommended default:

1. build FAA raw NOTAM native first
2. then build SpaceX drone ship native pages

That sequence reduces risk while still making visible parity progress.

## Implementation notes

1. Prefer additive `/api/v1` contracts if new payload is required.
2. Do not make mobile depend on web-only modules or scrape pages on read.
3. Keep source links visible as provenance, even when native summaries/facts are rendered.
4. Avoid importing web share/embed concepts into mobile just to claim parity.
5. For launch-detail links, use one helper that chooses:
   - in-app browser for source/reference pages
   - direct system open for maps, store management, and provider-action handoff

## Rollout and rollback

### Rollout

1. Land the smallest additive contract changes first.
2. Ship the mobile UI slice behind existing native routes.
3. Verify search/navigation behavior if a new route family is added.
4. Rebuild device apps after each shipped slice.

### Rollback

1. FAA raw NOTAM native UI can be reverted independently from the rest.
2. Drone ship native routes can fall back to the current hidden/unsupported behavior if needed.
3. Outbound-link handler normalization can be reverted independently as long as the old handlers remain intact.

## Verification set

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Acceptance checks

1. Mobile search no longer hides supported drone-ship routes once native pages are added.
2. Launch detail can show FAA raw text without leaving the app.
3. Maps, billing, and calendar still hand off externally.
4. Contract, catalog, entity, and program-hub source links still preserve provenance and open correctly.
5. No admin, embed, share, or other intentionally web-only surfaces leak into mobile scope.
