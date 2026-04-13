# SEO Phase Plan

Date: 2026-04-12

This is a no-code planning document. It sequences the fixes needed to align live behavior with the repo’s existing SEO architecture.

## Scope

Customer-facing web SEO only.

Platform matrix:

- Web: included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes

## Phase 0: Lock the Evidence

Goal:

- Preserve the audit baseline before touching behavior.

Work:

- keep the current crawl artifact and local verification notes
- save the exact production log excerpts for homepage `500` and sitemap timeouts
- capture the current `robots.txt` and sitemap host leakage to the staging domain

Key files:

- `docs/seo/repo-audit.md`
- `docs/seo/route-intent-map.md`
- `docs/seo/indexing-rules.md`
- `docs/seo/schema-map.md`

Success criteria:

- baseline evidence is stable enough to compare before/after output

## Phase 1: Canonical Host and Staging Safety

Goal:

- Make production always emit the canonical production host.
- Make staging always emit hard noindex/disallow behavior.

Primary files:

- `apps/web/lib/server/indexing.ts`
- `apps/web/lib/server/env.ts`
- `apps/web/app/layout.tsx`
- `apps/web/app/robots.ts`
- `apps/web/lib/server/seo.ts`
- `apps/web/lib/server/siteMeta.ts`

Required outcome:

- production canonicals, JSON-LD URLs, OG URLs, and sitemap hosts all use `https://www.tminuszero.app`
- preview/staging cannot become indexable because of a host/env mismatch

Verification:

- fetch `/robots.txt`
- fetch `/`
- fetch one indexable detail page
- inspect canonical, JSON-LD root URLs, OG URLs, and sitemap URLs

## Phase 2: Bring the Query-Intent Landing Layer Live

Goal:

- Make the 12 dedicated intent pages resolve in production mode.

Primary files:

- `apps/web/app/(intent-landings)/*/page.tsx`
- `apps/web/lib/server/launchIntentLanding.tsx`
- `apps/web/lib/server/launchIntentLandingConfig.ts`
- any route-group or runtime wiring needed to make these pages actually serve

Required outcome:

- all 12 intent pages return `200`
- each returns its expected title, H1, canonical, and structured data

Verification:

- direct fetch of all 12 routes
- rerun the existing `scripts/seo-tests.ts` expectations once the local harness is made reliable

## Phase 3: Stabilize the Primary Canonical Pages

Goal:

- Remove production-mode runtime failures on high-value canonical pages.

Primary files:

- `apps/web/app/page.tsx`
- any failing data dependencies surfaced by the local production logs
- shared query/cache layers behind home and core sitemap routes

Required outcome:

- `/` returns `200`
- `/sitemap.xml` returns within a practical crawl window
- `/sitemap-launches.xml` returns within a practical crawl window

Verification:

- production build/start
- fetch `/`
- fetch `/sitemap.xml`
- fetch `/sitemap-launches.xml`
- confirm no statement-timeout cascade in the server log

## Phase 4: Turn Soft Redirects Into Hard Redirects

Goal:

- Remove `200 OK` alias shells that currently emit duplicate homepage metadata before refreshing.

Primary files:

- `apps/web/app/new-glenn/page.tsx`
- `apps/web/app/new-shepard/page.tsx`
- `apps/web/app/blue-moon/page.tsx`
- `apps/web/app/blue-ring/page.tsx`
- `apps/web/app/be-4/page.tsx`
- any other page-level alias route currently using render-time `permanentRedirect()`
- `apps/web/next.config.mjs` or middleware if edge-level redirects are the chosen mechanism

Required outcome:

- alias routes return clean HTTP `308` responses
- crawlers never see a `200` HTML shell with duplicate metadata on alias URLs

Verification:

- `curl -I` and `curl -D -` on representative alias routes
- confirm no homepage title/description is emitted on alias responses

## Phase 5: Clean the Index Set

Goal:

- Keep only true search-entry pages indexable.

Primary files:

- `apps/web/lib/server/sitemapData.ts`
- `apps/web/app/upgrade/page.tsx`
- `apps/web/app/legal/privacy-choices/page.tsx`
- `apps/web/app/providers/[slug]/page.tsx`
- `apps/web/app/spacex/contracts/[contractKey]/page.tsx`
- `apps/web/app/blue-origin/contracts/[contractKey]/page.tsx`
- `apps/web/app/artemis/contracts/[piid]/page.tsx`
- `apps/web/lib/server/seoAliases.ts`

Required outcome:

- `/upgrade` is no longer indexable or sitemapped
- `/legal/privacy-choices` is no longer indexable or sitemapped
- provider news remains merged into `/launch-providers/[slug]`
- program contract detail pages consolidate to `/contracts/[contractUid]`

Verification:

- fetch affected pages and confirm robots/canonical behavior
- inspect sitemap output for removal of utility URLs

## Phase 6: Strengthen Schema and Internal Linking

Goal:

- Improve discovery and SERP readiness for the canonical pages that remain.

Primary files:

- `apps/web/app/page.tsx`
- `apps/web/components/ProgramHubDock.tsx`
- `apps/web/app/site-map/page.tsx`
- `apps/web/lib/server/launchIntentLandingConfig.ts`
- `apps/web/app/artemis/content/page.tsx`
- `apps/web/components/spacex/SpaceXMissionPage.tsx`
- `apps/web/app/spacex/missions/page.tsx`
- `apps/web/app/blue-origin/missions/page.tsx`
- `apps/web/app/spacex/flights/[slug]/page.tsx`

Required outcome:

- intent landing pages are linked from one or more crawlable site-level surfaces
- `/artemis/content` either gains route-level schema or is deindexed
- SpaceX mission pages move closer to Blue Origin mission-page schema quality
- weak-link pages gain contextual links beyond global nav/footer

Verification:

- re-crawl internal link counts
- re-check schema type coverage on upgraded pages

## Phase 7: Automate Regression Detection

Goal:

- Make these failures hard to reintroduce.

Primary files:

- `scripts/seo-tests.ts`
- any local harness/wrapper needed so the script runs reliably from the pinned toolchain

Required outcome:

- the repo SEO test suite runs locally without PATH surprises
- it covers:
  - query-cluster landing routes
  - canonical host correctness
  - noindex behavior for utility/faceted routes
  - sitemap health
  - redirect correctness

Verification:

- run the SEO suite after a fresh build
- add it to the web verification checklist used before deployment

## Minimum Final Verification Set

After implementation, rerun all of the following under the pinned toolchain:

- `node -v && npm -v`
- `npm run doctor`
- `npm run build --workspace @tminuszero/web`
- local production server start
- representative fetches:
  - `/`
  - all 12 intent landing pages
  - `/artemis`
  - `/launch-providers/spacex`
  - `/providers/spacex`
  - `/upgrade`
  - `/legal/privacy-choices`
  - `/robots.txt`
  - `/sitemap.xml`
  - `/sitemap-launches.xml`
  - `/sitemap-entities.xml`
- duplicate title/H1/description/canonical pass
- placeholder/loading-string pass
- structured-data coverage pass
- internal-link coverage pass

