# SEO Repo Audit

Date: 2026-04-12

## Scope

Customer-facing and SEO-relevant web surfaces only.

Platform matrix:

- Web: included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes

This audit covered route templates, metadata generation, robots rules, sitemap generation, canonical logic, structured data, internal linking, and rendering behavior for production and staging/indexing safety.

## Method

1. Read the App Router route tree under `apps/web/app` and the shared SEO helpers under `apps/web/lib/server`.
2. Verified pinned local toolchain with `node -v`, `npm -v`, and `npm run doctor`.
3. Ran `npm ci`.
4. Ran `npm run build --workspace @tminuszero/web`.
5. Started the production server locally from `apps/web` with:
   `NEXT_TELEMETRY_DISABLED=1 NODE_ENV=production VERCEL_ENV=production NEXT_PUBLIC_SITE_URL=https://www.tminuszero.app NEXT_PUBLIC_OG_IMAGE_VERSION=seo-audit node ../../node_modules/next/dist/bin/next start -p 3100`
6. Crawled rendered HTML and sitemap endpoints with `x-forwarded-proto: https`.
7. Parsed `/tmp/tmz-seo-crawl.json` for duplicates, placeholder strings, schema presence, and internal-link counts.

## Executive Summary

The repo already contains a strong SEO architecture on paper: a shared metadata layer, route-level canonical control, tiered sitemaps, JSON-LD across major landing pages, and a dedicated launch-intent landing system for the exact query clusters in scope. The current production behavior is not matching that architecture.

The highest-impact issues are:

1. The 12 dedicated query-cluster landing pages exist in source and in the built route manifest, but all 12 return `404` in the local production build.
2. The homepage `/`, which is still the fallback target for several launch-schedule queries, returns `500` in the local production build.
3. Canonicals, `robots.txt`, sitemap hosts, Open Graph URLs, and schema roots are resolving to `https://tminuszero-mobile-staging.vercel.app` instead of the canonical production host.
4. Several page-level `permanentRedirect()` aliases return `200` HTML shells with refresh/meta redirect payloads instead of clean HTTP `308` redirects.
5. The intent-landing layer is not linked from `/`, `/site-map`, or `ProgramHubDock`, so even if the routes were live, internal discovery is weak.
6. Utility/account-management pages such as `/upgrade` and `/legal/privacy-choices` are currently indexable and present in the core sitemap.

## Key Findings

### P0. Canonical host resolution is build-time and currently leaking a staging host

Evidence:

- `apps/web/lib/server/indexing.ts`
- `apps/web/lib/server/env.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/robots.ts`
- `apps/web/lib/server/siteMeta.ts`

Observed behavior:

- Local production crawl returned canonicals and sitemap hosts on `https://tminuszero-mobile-staging.vercel.app`.
- `robots.txt` emitted `Host:` and all `Sitemap:` entries on the staging host.
- Global JSON-LD `Organization` and `WebSite` URLs also used the staging host.

Why it is happening:

- `getIndexingSiteUrl()` and `getSiteUrl()` derive the site URL from build-time env.
- `layout.tsx`, `robots.ts`, `seo.ts`, and `siteMeta.ts` all consume those helpers.
- Middleware host redirects do not repair already-rendered canonical tags, OG tags, JSON-LD URLs, or sitemap URLs.

Implication:

- Production HTML can point search engines at the wrong host even when request-time redirects are correct.
- Staging protection is env-driven, not host-driven.

### P0. The priority query-cluster landing system is present in source but not live

Evidence:

- `apps/web/app/(intent-landings)/*/page.tsx`
- `apps/web/lib/server/launchIntentLanding.tsx`
- `apps/web/lib/server/launchIntentLandingConfig.ts`
- `apps/web/.next/server/app/(intent-landings)/*`
- `apps/web/.next/routes-manifest.json`

Observed behavior:

- `/spacex-launch-schedule`
- `/next-spacex-launch`
- `/falcon-9-launch-schedule`
- `/starship-launch-schedule`
- `/blue-origin-launch-schedule`
- `/ula-launch-schedule`
- `/nasa-launch-schedule`
- `/florida-rocket-launch-schedule`
- `/cape-canaveral-launch-schedule`
- `/vandenberg-launch-schedule`
- `/starbase-launch-schedule`
- `/rocket-launches-today`

All returned local production `404` pages with `robots: noindex`, despite the route files existing and the built manifest registering them as static routes.

Implication:

- The intended canonical destinations for the exact query clusters in this audit are not currently serving.
- Query intent falls back to weaker or broken pages.

### P0. The homepage fallback for broad launch-schedule intent is failing in production mode

Evidence:

- `apps/web/app/page.tsx`
- local production server logs during crawl

Observed behavior:

- `/` returned `500 Internal Server Error`.
- Server logs included:
  - `TypeError: Cannot read properties of undefined (reading 'call')`
  - repeated statement timeouts on Artemis and SpaceX queries
  - `canonical contracts cache replace rpc error { message: 'DELETE requires a WHERE clause' }`

Implication:

- The current fallback answer for broad queries such as `rocket launches today` and `rocket launch schedule` is broken in local production verification.

### P1. Redirect implementation is inconsistent between hard edge redirects and soft page-render redirects

Evidence:

- Hard redirects: `apps/web/next.config.mjs`, `apps/web/middleware.ts`
- Soft redirect pages:
  - `apps/web/app/new-glenn/page.tsx`
  - `apps/web/app/new-shepard/page.tsx`
  - `apps/web/app/blue-moon/page.tsx`
  - `apps/web/app/blue-ring/page.tsx`
  - `apps/web/app/be-4/page.tsx`

Observed behavior:

- `/artemis-2` and `/spacex/jellyfish-effect` returned true HTTP `308`.
- `/new-glenn` returned `200 OK` HTML containing:
  - the homepage title/description
  - `<meta id="__next-page-redirect" http-equiv="refresh" ...>`
  - an RSC `NEXT_REDIRECT` payload

Implication:

- Search engines and non-JS crawlers receive a duplicate-metadata HTML shell instead of a clean hard redirect.
- This explains the duplicate homepage title/description findings on several alias routes.

### P1. The core sitemap layer is heavy enough to time out locally

Evidence:

- `apps/web/app/sitemap.ts`
- `apps/web/app/sitemap-launches.xml/route.ts`
- `apps/web/lib/server/sitemapData.ts`

Observed behavior:

- `/sitemap.xml` timed out during crawl.
- `/sitemap-launches.xml` timed out during crawl.
- Smaller sitemap tiers completed.

Implication:

- The sitemap architecture is correct conceptually, but the heaviest tiers are too expensive under current runtime conditions.
- That is a crawl reliability risk even before considering query performance issues elsewhere.

### P1. The sitemap core currently includes utility pages that should not be indexed

Evidence:

- `apps/web/lib/server/sitemapData.ts`
- `apps/web/app/upgrade/page.tsx`
- `apps/web/app/legal/privacy-choices/page.tsx`

Observed behavior:

- `STATIC_PATHS` includes `/upgrade`.
- `STATIC_PATHS` includes `/legal/privacy-choices`.
- Both pages are currently canonical index pages.

Implication:

- Account/billing-utility pages are being promoted as search-entry pages.

### P1. Internal linking does not surface the high-intent landing pages

Evidence:

- `apps/web/components/ProgramHubDock.tsx`
- `apps/web/app/page.tsx`
- `apps/web/app/site-map/page.tsx`
- `apps/web/lib/server/launchIntentLandingConfig.ts`

Observed behavior:

- No site-wide navigation or site map links point at:
  `/spacex-launch-schedule`, `/next-spacex-launch`, `/falcon-9-launch-schedule`,
  `/starship-launch-schedule`, `/blue-origin-launch-schedule`, `/ula-launch-schedule`,
  `/nasa-launch-schedule`, `/florida-rocket-launch-schedule`, `/cape-canaveral-launch-schedule`,
  `/vandenberg-launch-schedule`, `/starbase-launch-schedule`, or `/rocket-launches-today`.
- Those routes only link to each other inside `launchIntentLandingConfig.ts`.

Implication:

- Even if the routes were live, internal PageRank flow and crawl discovery would be weak.

### P2. Structured-data coverage is uneven

Evidence:

- Missing:
  - `apps/web/app/artemis/content/page.tsx`
  - `apps/web/app/upgrade/page.tsx`
  - `apps/web/app/legal/privacy-choices/page.tsx`
- Thin:
  - `apps/web/components/spacex/SpaceXMissionPage.tsx`
  - `apps/web/app/spacex/missions/page.tsx`
  - `apps/web/app/spacex/flights/[slug]/page.tsx`
- Strong comparison:
  - `apps/web/components/blueorigin/BlueOriginMissionPage.tsx`
  - `apps/web/components/artemis/ArtemisPlannedMissionPage.tsx`
  - `apps/web/lib/server/launchIntentLanding.tsx`

Observed behavior:

- Rich schema is implemented on home, launch detail, rocket hubs, location hubs, Artemis planned mission pages, Blue Origin mission pages, and the intent-landing builder.
- `artemis/content`, `upgrade`, and `legal/privacy-choices` ship no route-level JSON-LD.
- SpaceX mission pages only emit `BreadcrumbList`, while Blue Origin mission pages emit `BreadcrumbList`, `CollectionPage`, and `Event`.

## Verification Report

### Crawl status summary

- 56 routes returned `200`
- 3 routes returned `308`
- 1 route returned `500`
- 6 sitemap requests or route checks timed out / did not complete

### Placeholder and loading strings found

| Route | Finding |
| --- | --- |
| `/docs/faq` | `Time TBD` |
| `/starship` | `Time TBD` plus repeated `loading...` fragments leaking from the streamed payload |
| `/artemis` | multiple uppercase `LOADING ...` fragments plus `date TBD` |
| `/spacex/missions/falcon-9` | `No passenger records currently available.` |
| `/spacex/missions/starship` | `No passenger records currently available.` and `Time TBD` |
| `/blue-origin/missions/new-glenn` | `No passenger records currently available.` |
| `/upgrade` | `Loading upgrade options...` |
| `/legal/privacy-choices` | `Loading…` and `loading preferences for T-Minus Zero` |
| `/auth/sign-in` | `Loading sign-in...` |

Notes:

- Some `loading` matches on `/starship` and `/artemis` are not just visible fallback copy; they are payload text leaking into the rendered HTML stream.

### Duplicate titles, H1s, descriptions, and canonicals

#### Duplicate titles

| Value | Routes | Interpretation |
| --- | --- | --- |
| `T-Minus Zero \| US Rocket Launch Schedule` | `/new-glenn`, `/new-shepard`, `/blue-moon`, `/blue-ring`, `/be-4` | alias pages are returning redirect shells with homepage metadata |
| `Starship Program Workbench & Flight Tracker \| T-Minus Zero` | `/starship`, `/starship?mode=technical` | expected canonical + noindex facet variant |

#### Duplicate H1s

| Value | Routes | Interpretation |
| --- | --- | --- |
| `Starship Program` | `/starship`, `/starship?mode=technical` | expected canonical + noindex facet variant |
| `Agency for Defense Development` | `/launch-providers/agency-for-defense-development`, `/providers/agency-for-defense-development` | provider schedule page vs provider news page share the same entity heading |

#### Duplicate descriptions

| Value | Routes | Interpretation |
| --- | --- | --- |
| homepage description | `/share/site`, `/unsubscribe`, `/new-glenn`, `/new-shepard`, `/blue-moon`, `/blue-ring`, `/be-4` | utility/alias surfaces are inheriting generic homepage copy |
| Starship description | `/starship`, `/starship?mode=technical` | expected canonical + noindex facet variant |

#### Duplicate canonicals

| Canonical | Routes | Interpretation |
| --- | --- | --- |
| `https://tminuszero-mobile-staging.vercel.app/starship` | `/starship`, `/starship?mode=technical` | expected canonical consolidation, but on the wrong host |

### Sitemap contents by file

| Sitemap | Result | Contents |
| --- | --- | --- |
| `/sitemap.xml` | local request timed out | source-defined core tier from `apps/web/lib/server/sitemapData.ts`: `STATIC_PATHS`, catalog collection pages, and near-term launch detail pages |
| `/sitemap-launches.xml` | local request timed out | source-defined long-tail tier: long-tail launch detail pages, Blue Origin historical launches, SpaceX flight pages, and Starship flight pages |
| `/sitemap-entities.xml` | verified locally | 3,111 URLs: provider schedule hubs, rocket hubs, location hubs, Artemis awardees, canonical contract detail pages, Blue Origin traveler pages |
| `/sitemap-catalog.xml` | verified locally | 4,166 URLs, all catalog detail pages under `/catalog/[entity]/[id]` |
| `/sitemap-satellites.xml` | verified locally | 1,000 satellite detail pages under `/satellites/[norad]` |
| `/sitemap-satellite-owners.xml` | verified locally | 130 URLs: `/satellites/owners` plus 129 owner profile pages |

Additional verified behavior:

- All locally fetched sitemap hosts used `https://tminuszero-mobile-staging.vercel.app`.

### Routes missing structured data

From successful crawl responses, every `200` page in the crawl sample had at least one JSON-LD block. Source inspection still found meaningful gaps:

| Route family | Source file | Gap |
| --- | --- | --- |
| `/artemis/content` | `apps/web/app/artemis/content/page.tsx` | no route-level JSON-LD despite being indexable and in the core sitemap |
| `/upgrade` | `apps/web/app/upgrade/page.tsx` | no route-level JSON-LD on a currently indexable utility page |
| `/legal/privacy-choices` | `apps/web/app/legal/privacy-choices/page.tsx` | no route-level JSON-LD on a currently indexable utility page |
| `/spacex/missions/[mission]` | `apps/web/components/spacex/SpaceXMissionPage.tsx` | only `BreadcrumbList`; no `CollectionPage`, `Event`, or `FAQPage` |
| intent landing routes | `apps/web/lib/server/launchIntentLanding.tsx` plus `apps/web/app/(intent-landings)/*/page.tsx` | source has rich JSON-LD, but live local production responses are `404`, so live schema value is zero |

### Routes with weak internal-link coverage

Measured from rendered HTML crawl counts:

| Route | Internal link count | Notes |
| --- | --- | --- |
| `/upgrade` | 0 | no crawl-visible internal links on a currently indexable page |
| `/about` | 8 | mostly global nav/footer links only |
| `/docs/about` | 8 | mostly global nav/footer links only |
| `/docs/faq` | 8 | mostly global nav/footer links only |
| `/docs/roadmap` | 8 | mostly global nav/footer links only |
| `/support` | 8 | mostly global nav/footer links only |
| `/legal/data` | 8 | mostly global nav/footer links only |
| `/legal/privacy-choices` | 8 | mostly global nav/footer links only |
| `/launch-providers/agency-for-defense-development` | 10 | thin contextual cross-linking for provider schedule pages |
| `/providers/agency-for-defense-development` | 10 | thin contextual cross-linking for provider news pages |
| `/locations/air-launch-to-orbit-189` | 14 | better than docs/legal pages, but still fairly shallow for location hubs |

Additional architectural gap:

- None of the 12 query-cluster landing pages are linked from `/`, `/site-map`, or `ProgramHubDock`.

## Production vs Staging Safety

Intended staging behavior is present in source:

- `apps/web/app/layout.tsx` adds deployment-wide `robots: noindex, nofollow` when `isNonProductionDeployment()` is true.
- `apps/web/app/robots.ts` returns `Disallow: /` when `shouldAllowPublicIndexing()` is false.
- `apps/web/middleware.ts` applies deployment `X-Robots-Tag: noindex, nofollow` headers in non-production environments.

The weakness is that all three protections are env-driven. If a production build gets a staging host value, or a staging deployment is built with production-like env, request-time host redirects do not protect canonical tags, JSON-LD URLs, sitemap hosts, or Open Graph image URLs already emitted into HTML.

## Documents Produced

- `docs/seo/route-intent-map.md`
- `docs/seo/indexing-rules.md`
- `docs/seo/schema-map.md`
- `docs/seo/phase-plan.md`

