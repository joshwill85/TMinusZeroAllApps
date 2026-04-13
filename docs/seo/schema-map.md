# Schema Map

Date: 2026-04-12

## Global Schema Layer

| Layer | Schema types | Source file | Notes |
| --- | --- | --- | --- |
| global layout | `Organization`, `WebSite` | `apps/web/app/layout.tsx` | site-wide publisher and `SearchAction`; currently using the staging host in local production verification |

## Rich Schema Coverage

| Route family | Schema types | Source files | Notes |
| --- | --- | --- | --- |
| `/` | `BreadcrumbList`, `CollectionPage`, `ItemList` of `Event` | `apps/web/app/page.tsx` | strong homepage schedule schema when the page renders successfully |
| intent landing routes | `BreadcrumbList`, page-level `CollectionPage` or `WebPage`, main entity (`Organization`, `Product`, or `Place`), `ItemList`, featured `Event` | `apps/web/lib/server/launchIntentLanding.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | source coverage is strong, but local production responses are `404` |
| `/news` | `BreadcrumbList`, `CollectionPage`, `ItemList` of `NewsArticle` / `BlogPosting` / `Report` | `apps/web/app/news/page.tsx` | good news schema coverage |
| `/launch-providers/[slug]` | `BreadcrumbList`, `CollectionPage`, `Organization`, `ItemList` | `apps/web/app/launch-providers/[slug]/page.tsx` | strong provider-schedule schema |
| `/providers/[slug]` | `BreadcrumbList`, `CollectionPage`, `Organization`, `ItemList` | `apps/web/app/providers/[slug]/page.tsx` | useful schema, but ranking should consolidate to `/launch-providers/[slug]` |
| `/launches/[id]` | `BreadcrumbList`, `WebPage`, `Event`, optional `VideoObject`, embedded `Product` for rocket | `apps/web/app/launches/[id]/page.tsx` | strongest detail-page schema in the repo |
| `/rockets/[id]` | `BreadcrumbList`, `CollectionPage`, `Product` | `apps/web/app/rockets/[id]/page.tsx` | strong rocket hub schema |
| `/locations/[id]` | `BreadcrumbList`, `CollectionPage`, `Place` | `apps/web/app/locations/[id]/page.tsx` | strong location hub schema |
| `/catalog/[entity]` | `BreadcrumbList`, `CollectionPage`, `ItemList` | `apps/web/components/catalog/CatalogCollectionView.tsx` | collection-level catalog schema |
| `/artemis-i` to `/artemis-vii` | `BreadcrumbList`, `CollectionPage`, `Event`, `ItemList`, `FAQPage` | `apps/web/components/artemis/ArtemisPlannedMissionPage.tsx` | strong mission-level schema through shared component |
| `/artemis` | route-level JSON-LD including `BreadcrumbList` and collection-style program schema | `apps/web/app/artemis/page.tsx` | strong program hub coverage |
| `/starship/[slug]` | `BreadcrumbList`, `CollectionPage`, `Event`, `ItemList`, `FAQPage` | `apps/web/app/starship/[slug]/page.tsx` | strong flight-level Starship coverage |
| `/spacex` | `BreadcrumbList`, `CollectionPage` | `apps/web/app/spacex/page.tsx` | program hub coverage is present but lighter than launch detail |
| `/blue-origin` | `CollectionPage` plus additional program JSON-LD | `apps/web/app/blue-origin/page.tsx` | program hub coverage is present |
| `/blue-origin/missions/[mission]` | `BreadcrumbList`, `CollectionPage`, `Event` | `apps/web/components/blueorigin/BlueOriginMissionPage.tsx` | materially richer than SpaceX mission schema |
| `/artemis/awardees`, `/artemis/awardees/[slug]` | collection/profile-style JSON-LD | `apps/web/app/artemis/awardees/**/*.tsx` | editorial awardee layer has explicit schema |
| `/contracts`, `/contracts/[contractUid]` | collection/detail JSON-LD | `apps/web/app/contracts/**/*.tsx` | canonical contract layer has schema |
| `/satellites`, `/satellites/owners`, `/satellites/owners/[owner]`, `/satellites/[norad]` | collection/profile/detail JSON-LD | `apps/web/app/satellites/**/*.tsx` | strong satellite reference coverage |
| `/docs/faq` | `BreadcrumbList`, `WebPage`, `FAQPage` | `apps/web/app/docs/faq/page.tsx` | best schema in the docs cluster |

## Thin or Missing Schema Coverage

| Route family | Source file | Current state | Gap |
| --- | --- | --- | --- |
| `/artemis/content` | `apps/web/app/artemis/content/page.tsx` | indexable and in core sitemap | no route-level JSON-LD |
| `/upgrade` | `apps/web/app/upgrade/page.tsx` | currently indexable and in core sitemap | no route-level JSON-LD |
| `/legal/privacy-choices` | `apps/web/app/legal/privacy-choices/page.tsx` | currently indexable and in core sitemap | no route-level JSON-LD |
| `/spacex/missions/[mission]` | `apps/web/components/spacex/SpaceXMissionPage.tsx` | indexable | only `BreadcrumbList`; lacks `CollectionPage`, `Event`, and `FAQPage` despite having sections that support them |
| `/spacex/missions` | `apps/web/app/spacex/missions/page.tsx` | indexable | only `BreadcrumbList`; no collection-level schema |
| `/blue-origin/missions` | `apps/web/app/blue-origin/missions/page.tsx` | indexable | only `BreadcrumbList`; no collection-level schema |
| `/spacex/flights/[slug]` | `apps/web/app/spacex/flights/[slug]/page.tsx` | indexable | only `BreadcrumbList`; no flight-level `Event` schema despite launch/timing content |
| intent landing routes | `apps/web/lib/server/launchIntentLanding.tsx` and `apps/web/app/(intent-landings)/*/page.tsx` | source coverage is rich | local production responses are `404`, so live schema output is absent |

## Crawl-Based Structured Data Notes

Successful crawl sample:

- 56 `200` pages were inspected.
- none of the successful crawl targets were completely missing JSON-LD.

Important nuance:

- The crawl result does not contradict the source-level gaps above.
- The three clearest missing-schema routes were not part of the successful-schema gap list because they either still emitted global layout JSON-LD or were not the main missing pages in the 56-route sample.
- The intent-landing routes are the biggest schema loss in practice because they are the routes meant for the highest-value query clusters, yet they currently 404.

## Route Families That Should Be Upgraded First

1. `/rocket-launches-today`, `/next-spacex-launch`, `/spacex-launch-schedule`, `/falcon-9-launch-schedule`, `/starship-launch-schedule`, `/blue-origin-launch-schedule`, `/ula-launch-schedule`, `/nasa-launch-schedule`, `/florida-rocket-launch-schedule`, `/cape-canaveral-launch-schedule`, `/vandenberg-launch-schedule`, `/starbase-launch-schedule`
   Reason: they are the exact target cluster pages and already have rich schema in source, but no live output.
2. `/spacex/missions/[mission]`
   Reason: these are indexable mission-family landing pages with meaningful content depth and noticeably thinner schema than Blue Origin mission pages.
3. `/artemis/content`
   Reason: currently indexable and in sitemap, but structurally behaves like a feed with zero route-level JSON-LD.
4. `/upgrade` and `/legal/privacy-choices`
   Reason: either remove from the index set or give them the schema posture appropriate to their final indexing decision. The preferred outcome is likely deindexing, not richer schema.

