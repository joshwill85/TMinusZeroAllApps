# Indexing Rules

Date: 2026-04-12

Legend for the recommended SEO rule set:

- `canonical index`
- `noindex,follow`
- `merge into another canonical`
- `redirect legacy alias`

Private/admin/auth/utility routes that should remain hard `noindex, nofollow` are listed separately at the end because they are not canonical search-entry candidates.

## Canonical Index

| Route family | Recommended rule | Current state | Source files | Notes |
| --- | --- | --- | --- | --- |
| `/` | `canonical index` | local production `500`; query-parameter variants mostly noindex | `apps/web/app/page.tsx` | broadest live launch-schedule entry point |
| `/?page=N` | `canonical index` | implemented | `apps/web/app/page.tsx` | only pure pagination should remain indexable |
| `/rocket-launches-today` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/rocket-launches-today/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `rocket launches today` |
| `/next-spacex-launch` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/next-spacex-launch/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `next SpaceX launch` |
| `/spacex-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/spacex-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `SpaceX launch schedule` |
| `/falcon-9-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/falcon-9-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `Falcon 9 launch schedule` |
| `/starship-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/starship-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `Starship launch schedule` |
| `/blue-origin-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/blue-origin-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `Blue Origin launch schedule` |
| `/ula-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/ula-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `ULA launch schedule` |
| `/nasa-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/nasa-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for `NASA launch schedule` |
| `/florida-rocket-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/florida-rocket-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for state-level Florida launch intent |
| `/cape-canaveral-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/cape-canaveral-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for Cape Canaveral intent |
| `/vandenberg-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/vandenberg-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for Vandenberg intent |
| `/starbase-launch-schedule` | `canonical index` | source exists, local production `404` | `apps/web/app/(intent-landings)/starbase-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | intended winner for Starbase intent |
| `/news` | `canonical index` | implemented; filtered variants noindex | `apps/web/app/news/page.tsx` | good canonical for space/launch news |
| `/launch-providers` | `canonical index` | implemented | `apps/web/app/launch-providers/page.tsx` | provider directory |
| `/launch-providers/[slug]` | `canonical index` | implemented; empty schedules fall back to noindex | `apps/web/app/launch-providers/[slug]/page.tsx` | best live provider-schedule family |
| `/launches/[id]` | `canonical index` | implemented | `apps/web/app/launches/[id]/page.tsx` | launch-detail canonical |
| `/rockets/[id]` | `canonical index` | implemented | `apps/web/app/rockets/[id]/page.tsx` | rocket/vehicle canonical |
| `/locations/[id]` | `canonical index` | implemented | `apps/web/app/locations/[id]/page.tsx` | launch-location canonical |
| `/contracts` | `canonical index` | implemented; faceted variants noindex | `apps/web/app/contracts/page.tsx` | global canonical contract index |
| `/contracts/[contractUid]` | `canonical index` | implemented | `apps/web/app/contracts/[contractUid]/page.tsx` | global canonical contract detail |
| `/catalog` | `canonical index` | implemented | `apps/web/app/catalog/page.tsx` | catalog root hub |
| `/catalog/[entity]` | `canonical index` | implemented; any search/filter/page param noindex | `apps/web/app/catalog/[entity]/page.tsx`, `apps/web/components/catalog/CatalogCollectionView.tsx` | collection canonical for non-faceted view |
| `/catalog/[entity]/[id]` for non-aliased entities | `canonical index` | implemented | `apps/web/app/catalog/[entity]/[id]/page.tsx`, `apps/web/lib/server/seoAliases.ts` | only entities without dedicated alias hubs should stay canonical here |
| `/artemis` | `canonical index` | implemented | `apps/web/app/artemis/page.tsx` | best live answer for `Artemis launch schedule` |
| `/artemis-i`, `/artemis-ii`, `/artemis-iii`, `/artemis-iv`, `/artemis-v`, `/artemis-vi`, `/artemis-vii` | `canonical index` | implemented | `apps/web/app/artemis-*/page.tsx`, `apps/web/components/artemis/ArtemisPlannedMissionPage.tsx` | mission-level canonical pages |
| `/artemis/awardees` | `canonical index` | implemented; filtered variants noindex | `apps/web/app/artemis/awardees/page.tsx` | awardee directory |
| `/artemis/awardees/[slug]` | `canonical index` | implemented | `apps/web/app/artemis/awardees/[slug]/page.tsx` | approved editorial profiles only |
| `/artemis/content` | `canonical index` | implemented; filtered variants noindex | `apps/web/app/artemis/content/page.tsx` | currently indexable, though it behaves more like a faceted feed |
| `/artemis/contracts` | `canonical index` | implemented; faceted variants noindex | `apps/web/app/artemis/contracts/page.tsx` | scoped contract list can stay indexable if the program-level contract surface is retained |
| `/spacex` | `canonical index` | implemented | `apps/web/app/spacex/page.tsx` | SpaceX program hub |
| `/spacex/missions` | `canonical index` | implemented | `apps/web/app/spacex/missions/page.tsx` | mission-family directory |
| `/spacex/missions/[mission]` | `canonical index` | implemented | `apps/web/app/spacex/missions/[mission]/page.tsx`, `apps/web/components/spacex/SpaceXMissionPage.tsx` | strong intent fit, but schema is thin |
| `/spacex/vehicles`, `/spacex/vehicles/[slug]` | `canonical index` | implemented | `apps/web/app/spacex/vehicles/page.tsx`, `apps/web/app/spacex/vehicles/[slug]/page.tsx` | vehicle hub family |
| `/spacex/engines`, `/spacex/engines/[slug]` | `canonical index` | implemented | `apps/web/app/spacex/engines/page.tsx`, `apps/web/app/spacex/engines/[slug]/page.tsx` | engine hub family |
| `/spacex/flights`, `/spacex/flights/[slug]` | `canonical index` | implemented | `apps/web/app/spacex/flights/page.tsx`, `apps/web/app/spacex/flights/[slug]/page.tsx` | flight-level canonical pages |
| `/spacex/drone-ships`, `/spacex/drone-ships/[slug]` | `canonical index` | implemented | `apps/web/app/spacex/drone-ships/page.tsx`, `apps/web/app/spacex/drone-ships/[slug]/page.tsx` | drone-ship hub family |
| `/spacex/contracts` | `canonical index` | implemented; faceted variants noindex | `apps/web/app/spacex/contracts/page.tsx` | scoped contract list can stay indexable if retained |
| `/jellyfish-effect` | `canonical index` | implemented | `apps/web/app/jellyfish-effect/page.tsx` | stable editorial/program page |
| `/blue-origin` | `canonical index` | implemented | `apps/web/app/blue-origin/page.tsx` | Blue Origin program hub |
| `/blue-origin/missions`, `/blue-origin/missions/[mission]` | `canonical index` | implemented | `apps/web/app/blue-origin/missions/page.tsx`, `apps/web/app/blue-origin/missions/[mission]/page.tsx` | mission-family and mission-detail canonicals |
| `/blue-origin/vehicles`, `/blue-origin/vehicles/[slug]` | `canonical index` | implemented | `apps/web/app/blue-origin/vehicles/page.tsx`, `apps/web/app/blue-origin/vehicles/[slug]/page.tsx` | vehicle hub family |
| `/blue-origin/engines`, `/blue-origin/engines/[slug]` | `canonical index` | implemented | `apps/web/app/blue-origin/engines/page.tsx`, `apps/web/app/blue-origin/engines/[slug]/page.tsx` | engine hub family |
| `/blue-origin/flights` | `canonical index` | implemented | `apps/web/app/blue-origin/flights/page.tsx` | list page only; detail slug route redirects to launch pages |
| `/blue-origin/travelers`, `/blue-origin/travelers/[slug]` | `canonical index` | implemented | `apps/web/app/blue-origin/travelers/page.tsx`, `apps/web/app/blue-origin/travelers/[slug]/page.tsx` | traveler directory/detail canonicals |
| `/blue-origin/contracts` | `canonical index` | implemented; faceted variants noindex | `apps/web/app/blue-origin/contracts/page.tsx` | scoped contract list can stay indexable if retained |
| `/starship`, `/starship/[slug]` | `canonical index` | implemented | `apps/web/app/starship/page.tsx`, `apps/web/app/starship/[slug]/page.tsx` | strongest live Starship family |
| `/satellites`, `/satellites/owners`, `/satellites/owners/[owner]`, `/satellites/[norad]` | `canonical index` | implemented | `apps/web/app/satellites/**/*.tsx` | canonical satellite reference cluster |
| `/about`, `/info`, `/site-map` | `canonical index` | implemented | `apps/web/app/about/page.tsx`, `apps/web/app/info/page.tsx`, `apps/web/app/site-map/page.tsx` | site-level discovery/support surfaces |
| `/docs/about`, `/docs/faq`, `/docs/roadmap`, `/support` | `canonical index` | implemented | `apps/web/app/docs/**/*.tsx`, `apps/web/app/support/page.tsx` | low-volume but valid support/docs entry points |
| `/legal/privacy`, `/legal/terms`, `/legal/data` | `canonical index` | implemented | `apps/web/app/legal/**/*.tsx` | legal/data provenance canonicals |

## Noindex,follow

| Route family | Recommended rule | Current state | Source files | Notes |
| --- | --- | --- | --- | --- |
| faceted `/` | `noindex,follow` | implemented except pure `?page=N` | `apps/web/app/page.tsx`, `apps/web/middleware.ts` | only plain pagination should stay indexable |
| faceted `/news` | `noindex,follow` | implemented | `apps/web/app/news/page.tsx` | provider/type filters should not be indexed separately |
| faceted `/artemis` | `noindex,follow` | implemented | `apps/web/app/artemis/page.tsx` | dashboard/intel/filter variants should consolidate |
| faceted `/starship` | `noindex,follow` | implemented | `apps/web/app/starship/page.tsx` | mode/source/date variants should consolidate |
| faceted `/artemis/awardees` | `noindex,follow` | implemented | `apps/web/app/artemis/awardees/page.tsx` | query variants should consolidate |
| faceted `/artemis/content` | `noindex,follow` | implemented for filtered views | `apps/web/app/artemis/content/page.tsx` | current unfiltered page is still indexable |
| faceted `/catalog/[entity]` | `noindex,follow` | implemented | `apps/web/app/catalog/[entity]/page.tsx` | any query/region/page variant should consolidate |
| faceted `/contracts` | `noindex,follow` | implemented | `apps/web/app/contracts/page.tsx` | query/scope/page variants should consolidate |
| faceted `/spacex/contracts`, `/blue-origin/contracts`, `/artemis/contracts` | `noindex,follow` | implemented | `apps/web/app/spacex/contracts/page.tsx`, `apps/web/app/blue-origin/contracts/page.tsx`, `apps/web/app/artemis/contracts/page.tsx` | keep list pages canonical, but not their filtered variants |
| `/search` | `noindex,follow` | implemented | `apps/web/app/search/page.tsx` | correct for internal search results |
| `/calendar` | `noindex,follow` | current implementation is stronger `noindex, nofollow` | `apps/web/app/calendar/page.tsx`, `apps/web/middleware.ts` | utility calendar surface |
| `/upgrade` | `noindex,follow` | currently indexable and in core sitemap | `apps/web/app/upgrade/page.tsx`, `apps/web/lib/server/sitemapData.ts` | billing/upgrade utility, not a search target |
| `/legal/privacy-choices` | `noindex,follow` | currently indexable and in core sitemap | `apps/web/app/legal/privacy-choices/page.tsx`, `apps/web/lib/server/sitemapData.ts` | account-management utility, not a search target |
| empty `/launch-providers/[slug]` pages | `noindex,follow` | implemented through `buildIndexQualityNoIndexRobots()` | `apps/web/app/launch-providers/[slug]/page.tsx` | empty provider hubs should not stay indexable |

## Merge Into Another Canonical

| Route family | Recommended rule | Current state | Source files | Notes |
| --- | --- | --- | --- | --- |
| `/providers/[slug]` | `merge into another canonical` | already noindex with canonical to `/launch-providers/[slug]` | `apps/web/app/providers/[slug]/page.tsx` | coverage/news page should not rank separately from provider schedule page |
| `/catalog/[entity]/[id]` for provider agencies | `merge into another canonical` | implemented as redirect when alias exists | `apps/web/app/catalog/[entity]/[id]/page.tsx`, `apps/web/lib/server/seoAliases.ts` | provider agency entities should consolidate to `/launch-providers/[slug]` |
| `/catalog/[entity]/[id]` for launcher configurations | `merge into another canonical` | implemented as redirect when alias exists | `apps/web/app/catalog/[entity]/[id]/page.tsx`, `apps/web/lib/server/seoAliases.ts` | launcher configuration entities should consolidate to `/rockets/[id]` |
| `/spacex/contracts/[contractKey]` | `merge into another canonical` | currently self-canonical and indexable | `apps/web/app/spacex/contracts/[contractKey]/page.tsx`, `apps/web/app/contracts/[contractUid]/page.tsx` | same contract entity should consolidate to global canonical contract detail |
| `/blue-origin/contracts/[contractKey]` | `merge into another canonical` | currently self-canonical and indexable | `apps/web/app/blue-origin/contracts/[contractKey]/page.tsx`, `apps/web/app/contracts/[contractUid]/page.tsx` | same duplication pattern as SpaceX |
| `/artemis/contracts/[piid]` | `merge into another canonical` | currently self-canonical and indexable | `apps/web/app/artemis/contracts/[piid]/page.tsx`, `apps/web/app/contracts/[contractUid]/page.tsx` | same duplication pattern as SpaceX and Blue Origin |

## Redirect Legacy Alias

| Route family | Recommended rule | Current state | Source files | Notes |
| --- | --- | --- | --- | --- |
| `/artemis-2`, `/artemis-4`, `/artemis-5`, `/artemis-6`, `/artemis-7` | `redirect legacy alias` | hard `308` via `next.config.mjs` and route files | `apps/web/next.config.mjs`, `apps/web/app/artemis-*.tsx` | good pattern; these are real hard redirects |
| `/spacex/jellyfish-effect` | `redirect legacy alias` | hard `308` via `next.config.mjs` | `apps/web/next.config.mjs` | good pattern |
| `/new-glenn`, `/new-shepard`, `/blue-moon`, `/blue-ring`, `/be-4` | `redirect legacy alias` | page-level redirect returns `200` HTML shell on `GET` | `apps/web/app/new-glenn/page.tsx`, `apps/web/app/new-shepard/page.tsx`, `apps/web/app/blue-moon/page.tsx`, `apps/web/app/blue-ring/page.tsx`, `apps/web/app/be-4/page.tsx` | should be converted to hard redirect behavior |
| `/blue-origin/flights/[slug]` | `redirect legacy alias` | route already noindex and redirects to `/launches/[id]` | `apps/web/app/blue-origin/flights/[slug]/page.tsx` | detail slug should not be a second canonical |
| `/share/launch/[id]` | `redirect legacy alias` | implemented as redirect route | `apps/web/app/share/launch/[id]/route.ts` | share helper route, not canonical content |
| canonicalization aliases inside `/launch-providers/[slug]`, `/starship/[slug]`, `/spacex/missions/[mission]`, `/spacex/*/[slug]`, `/blue-origin/*/[slug]`, `/rockets/[id]`, `/locations/[id]`, `/satellites/owners/[owner]`, `/contracts/[contractUid]` | `redirect legacy alias` | implemented with `permanentRedirect()` | multiple page files under `apps/web/app/**` | current behavior is route-correct, but GET responses can still surface a soft redirect shell instead of a clean HTTP 308 |

## Hard Noindex Utility and Private Surfaces

These are not canonical candidates and should remain excluded:

| Route family | Current rule | Source files |
| --- | --- | --- |
| `/account/*` | `noindex, nofollow` | `apps/web/app/account/layout.tsx` |
| `/admin/*` | `noindex, nofollow` | `apps/web/app/admin/layout.tsx` |
| `/auth/*` | `noindex, nofollow` | `apps/web/app/auth/layout.tsx` |
| `/me/*` | `noindex, nofollow` | `apps/web/app/me/layout.tsx` |
| `/mobile-auth/challenge` | `noindex, nofollow` | `apps/web/app/mobile-auth/challenge/page.tsx`, `apps/web/middleware.ts` |
| `/premium-onboarding/legal` | `noindex, nofollow` | `apps/web/app/premium-onboarding/legal/page.tsx`, `apps/web/middleware.ts` |
| `/launches/[id]/ar` | `noindex, nofollow` | `apps/web/app/launches/[id]/ar/page.tsx`, `apps/web/middleware.ts` |
| `/embed/*` | `noindex, nofollow` | `apps/web/app/embed/next-launch/page.tsx`, `apps/web/app/robots.ts` |
| `/share/site`, `/share/launch-debug/[id]` | `noindex` utility surfaces | `apps/web/app/share/site/page.tsx`, `apps/web/app/share/launch-debug/[id]/page.tsx` |
| `/unsubscribe` | `noindex, nofollow` | `apps/web/app/unsubscribe/page.tsx`, `apps/web/app/robots.ts` |
| `/api/*`, OG image routes | `noindex, nofollow` or `noimageindex` | `apps/web/middleware.ts`, `apps/web/app/opengraph-image/jpeg/route.ts`, `apps/web/app/launches/[id]/opengraph-image/**` |

