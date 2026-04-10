# 2026-04-10 Cache Audit Second Pass and Rollout Plan

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: engineering reliability and customer-facing shared foundations

## Purpose

This document is the second-pass decision record for caching and request-collapse work across the three-platform stack. It is intentionally stricter than a generic "add more cache" pass.

The goal is to reduce hidden traffic cost without breaking:

- premium gating
- RLS and auth boundaries
- launch-day freshness requirements
- `/api/v1` compatibility
- public-vs-live product behavior

This plan should be read alongside `docs/three-platform-overhaul-plan.md` and supersedes the narrower cache-only recommendations in `docs/2026-04-01-low-io-refresh-cache-realignment-plan.md`.

## 2026-04-10 Correction After Phase 1 Review

During the first implementation pass, we confirmed an important flaw in the original Phase 1 direction:

- a plain time-bucketed shared cache on the public launch feed can delay NET shifts, status changes, ordering changes, and corrected countdown inputs even when the upstream launch data has already changed
- premium live detail and premium live version correctness remain intact because those routes still return `private, no-store`
- the public feed plan therefore needs a stricter invalidation model before broader rollout

This update changes three decisions:

- public feed and public detail payload caches must be aligned to an explicit invalidation boundary, not a generic time bucket
- premium live freshness should move to event-driven invalidation with adaptive polling fallback instead of relying on cache TTLs
- version endpoints should read lightweight refresh-state records instead of repeatedly deriving freshness from broader table scans

## Decision Standard

- Never shared-cache a response body that varies by entitlement, auth state, admin override, privacy preference, observer location, or installation token.
- For premium-gated but non-user-specific data, authenticate first, then allow short-lived origin-side cache or request coalescing.
- For public data, prefer `createSupabasePublicClient()` or other site-read primitives so the read path is naturally shareable.
- Prefer shared cache layers such as `unstable_cache`, tagged revalidation, or cache tables over process-local `Map` caches.
- Prefer tag- or version-aligned invalidation over time-bucket invalidation for launch feeds and launch detail cores where NET/status changes matter.
- Do not let public version endpoints outrun the payload caches they are supposed to validate. Version and payload invalidation boundaries must stay aligned.
- For premium/live freshness, treat the change signal as a separate concern from the payload cache. The right pattern is `change signal -> invalidate query -> refetch private payload`, not `wait for payload cache TTL`.
- For high-fanout premium update delivery, prefer authenticated broadcast or server-side restream over raw per-subscriber database change fan-out.
- For fast-changing payloads, cache submodules with different TTLs instead of caching the whole payload indiscriminately.
- Normalize query params and bucket time inputs before building cache keys.
- Preserve `/api/v1` contracts where possible by changing internal assembly rather than public schema shape.

## Freshness Targets

- Premium live feed/detail, active client, realtime connected:
  - target low-single-digit-second invalidation from accepted launch write to client refetch
  - target p95 under `5s` for the change signal during launch windows
- Premium live feed/detail, realtime unavailable:
  - fallback polling target `5-15s` in hot windows
  - fallback polling target `30-60s` in warm windows
  - fallback polling target `120s` in cold windows
- Public feed/detail:
  - after a non-personalized launch change, the next request after tag invalidation must see fresh payloads
  - if tag invalidation is temporarily unavailable, fallback TTL must stay short enough to avoid user-visible countdown/status drift, with `<=60s` as the temporary ceiling
- Local countdown ticking can stay client-side at `1s`, but upstream NET/status changes must propagate fast enough to correct the underlying `launch.net` and `status` values without waiting for long cache expiry windows

## Cache Classes

### Class A: shared public cache

Safe for CDN plus shared origin cache. No auth- or viewer-dependent fields in the cached body.

### Class B: auth-gated origin cache

Authenticate first. Then serve from a short-lived origin cache or request-collapsed loader. Response to the client remains `private` or `no-store`.

### Class C: submodule cache only

Do not cache the whole endpoint body. Cache stable subqueries and assemble the final response dynamically.

### Class D: no shared cache

Keep `no-store`. Use rate limits and maybe tiny in-process request dedupe only if needed.

## Second-Pass Decisions

| Area | Current State | Decision | Cache Class | Starting TTL / Policy |
| --- | --- | --- | --- | --- |
| Public launch feed payload | Public headers exist, but origin loader recomputes filtered feed and enrichment on miss. A pure time-bucket cache is not fresh enough for schedule shifts. | Cache by normalized public feed params, but invalidate by explicit feed tags or version-seed boundaries. Do not rely on time buckets as the primary freshness control. Reuse the same loader for `/api/public/launches` and `/api/v1/launches?scope=public`. | A | Tag/version aligned. Temporary fallback TTL `<=60s` only until tag invalidation is live |
| Public launch feed version | Public scope still resolves viewer cadence and returns `private, no-store` | Make public version seed non-personalized and back it with a lightweight refresh-state record, not repeated broad scans. It must change in lockstep with payload invalidation. | A | `15-60s` or tag-backed seed reads; never materially faster than payload invalidation |
| Public launch detail payload | Full body contains `entitlements`, so whole-response shared cache is unsafe | Keep schema, but internally split into `public core + viewer overlay`. Cache only the public core and stable public modules. | C | Module-specific TTLs below |
| Public launch detail version | Public scope still resolves session/tier and returns `private, no-store` | Same boundary as feed version: expose a non-personalized public detail seed aligned to the cached public detail core and its invalidation tags. | A | `15-60s` or tag-backed seed reads; aligned with public detail core invalidation |
| Refresh-state read model | Version endpoints still derive freshness from broader source tables and related module reads | Add lightweight refresh-state records for public feed, live feed, public detail, and live detail. Version endpoints should read these seeds first, not recalculate freshness from hot tables on every poll. | A/B | Event-updated source of truth, not TTL-driven |
| Premium change signal | No cross-platform near-instant invalidation signal exists today | Add authenticated realtime broadcast topics for premium feed/detail invalidation. Clients invalidate query keys and refetch private payloads immediately on event. | B | Event-driven, no shared payload cache |
| Live feed payload | Premium-only and freshness-sensitive | Keep client response private. No broad shared caching. Allow only post-auth request collapse or `1-2s` keyed micro-cache if metrics show duplicate bursts. | B | Request collapse first; micro-cache only after auth and only if measured |
| Live feed version | Premium-only and polled often | Back with lightweight live refresh-state records and premium realtime invalidation. Polling stays as resilience fallback, not the primary freshness mechanism. | B | Event-driven primary path; fallback polling `5-15s` hot, `30-60s` warm, `120s` cold |
| Launch detail stable modules | Payload manifest, object inventory, vehicle timeline, rocket stats, booster stats, related news/events are reloaded from hot paths | Cache these submodules independently and compose them into both page and API payloads. | C | `300-1800s` depending on module |
| Launch detail fast modules | Weather, default JEP, FAA airspace, AR summary are fresher but not viewer-personalized | Keep dynamic assembly, but use shorter shared submodule caches where data is public and not observer-specific. | C | `30-300s` depending on module |
| Entitlements and privacy overlays | Response currently bundles entitlement object and privacy-sensitive embed policy | Never shared-cache. Compute per request. | D | `no-store` |
| News stream | Public route has short CDN cache, but backend is join-heavy and currently uses `createSupabaseServerClient()` | Move to public client, cache by `type + provider + cursor + limit`, and reuse between web and `/api/v1/news`. | A | `60-120s` |
| Filter options: public | Shared public data but only protected by process-local maps today | Move to shared public cache by normalized filter args and date window. | A | `300s` for base lists, `60-120s` for dynamic filtered variants |
| Filter options: live | Premium-only, not user-specific once auth passes | Authenticate first, then allow short auth-gated origin cache instead of only per-instance maps. | B | `30-120s` |
| Catalog collections and details | Public route headers exist, but origin still does raw DB work and some extra joins | Add shared origin caches for collection pages, detail pages, and related-launch lookups. | A | `300-900s` |
| Search | Already uses public client and short cache headers | Keep current behavior. Revisit only if measured cost or hit ratio is poor. | D | Leave as-is for now |
| FAA airspace and FAA airspace map | Public routes already have safe short CDN cache and use public data | Keep current behavior. Optional origin cache only if query load proves high. | D | Leave as-is initially |
| JEP without observer | Public route already distinguishes personalized vs non-personalized and caches only non-personalized | Keep current policy. Do not widen caching. | D | Leave as-is |
| JEP with observer | Personalized and rate-limited | Keep `no-store`. | D | Leave as-is |
| Premium trajectory | Premium-gated data behind `no-store` routes | Keep client response private. Add auth-gated origin cache for the resolved trajectory product if load warrants it. | B | `60-300s` after auth |
| Public reference loaders using server client | Many public loaders use `createSupabaseServerClient()` and inherit cookie dynamism | Standardize public loaders on public/site-read clients so shareable data is actually shareable. | A or C depending on endpoint | No TTL by itself; prerequisite for safe caching |
| Mobile guest bootstrap | Short-lived token is cached only in memory | Persist guest bootstrap state in secure storage until expiry to reduce cold-start bootstrap traffic. | Client-side | Expire exactly at token expiry |
| Mobile public query cache | Shared query client is memory-only and public feed snapshot is tiny | Add targeted persisted React Query storage for low-risk public datasets and scope-aware stale times. | Client-side | Public feed/detail longer than current `30s`; live stays short |

## What We Should Not Do

- Do not put the current `launch detail` response behind a public CDN cache. It contains `entitlements`.
- Do not make `observer`-based JEP responses cacheable.
- Do not reuse process-local `Map` caches as the primary protection for high-volume public endpoints.
- Do not use plain time-bucket invalidation as the main freshness boundary for public launch feeds or public launch detail cores.
- Do not add long TTLs to live feed or live detail payloads just to save database reads.
- Do not make premium users wait for public cache expiry before seeing live launch changes.
- Do not use raw high-fanout Postgres Changes subscriptions as the primary premium update fan-out path when authenticated broadcast or server-side restream is available.
- Do not keep viewer-specific cadence hints inside otherwise-public version responses if that prevents shared caching.

## Current Evidence Anchors

- Public feed payload path: `apps/web/lib/server/publicLaunchFeed.ts`, `apps/web/lib/server/v1/launchFeedApi.ts`, `apps/web/app/api/public/launches/route.ts`, `apps/web/app/api/v1/launches/route.ts`
- Public and live feed version paths: `apps/web/lib/server/v1/launchFeedApi.ts`, `apps/web/app/api/v1/launches/version/route.ts`, `apps/web/app/api/live/launches/version/route.ts`
- Launch detail API and page: `apps/web/app/api/v1/launches/[id]/route.ts`, `apps/web/lib/server/v1/mobileApi.ts`, `apps/web/app/launches/[id]/page.tsx`
- Launch detail version path: `apps/web/app/api/v1/launches/[id]/version/route.ts`, `apps/web/lib/server/launchDetailVersion.ts`
- Feed/detail client refresh behavior: `apps/web/components/LaunchFeed.tsx`, `apps/web/components/LaunchDetailAutoRefresh.tsx`, `apps/web/components/LaunchCard.tsx`
- News stream: `apps/web/lib/server/newsStream.ts`, `apps/web/app/api/news/stream/route.ts`, `apps/web/app/api/v1/news/route.ts`
- Filters: `apps/web/app/api/filters/route.ts`, `apps/web/app/api/v1/launches/filter-options/route.ts`
- Catalog and reference: `apps/web/lib/server/catalogCollection.ts`, `apps/web/lib/server/v1/mobileReference.ts`, `apps/web/app/api/public/catalog/route.ts`, `apps/web/app/api/v1/catalog/[entity]/route.ts`, `apps/web/app/api/v1/catalog/[entity]/[id]/route.ts`
- Stable baselines already using stronger caching patterns: `apps/web/lib/server/homeLaunchFeed.ts`, `apps/web/lib/server/arEligibility.ts`, `apps/web/lib/server/contracts.ts`

## Module TTL Guidance For Launch Detail

These TTLs are starting points, not permanent truth. Final values should follow production measurements.

- `entitlements`, `privacyPrefs`, auth-derived mode, admin override: no shared cache
- `launch core` from `launches_public_cache`: long-lived shared cache is acceptable only when invalidated by launch tags or version seeds; if tag invalidation is absent, temporary fallback TTL must stay `<=60s`
- `related news`, `related events`: `300-900s`
- `payload manifest`: `300-900s`
- `object inventory`: `300-900s`
- `vehicle timeline`, `rocket stats`, `booster stats`: `900-1800s`
- `launch detail enrichment`: `300-900s`
- `AR trajectory summary`: `300-600s`
- `FAA airspace` and `FAA airspace map`: keep current `60s` public edge policy; optional shared origin cache if needed
- default non-personalized `JEP`: keep current `60s` public edge policy
- weather modules:
  - `WS45 forecast`: `60-300s`
  - `NWS forecast`: `60-300s`
  - live range-weather snapshot: keep dynamic or `30-60s` auth-gated cache only after verifying it does not hurt launch-day freshness

## Rollout Order

### Phase 0: boundaries, metrics, refresh-state seeds, and key helpers

- Add a shared cache-key normalization layer for feed, version, news, filters, catalog, and detail modules.
- Add refresh-state records for:
  - `public feed`
  - `live feed`
  - `public detail:<launchId>`
  - `live detail:<launchId>`
- Update the write paths or refresh jobs that mutate `launches`, `launches_public_cache`, and payload-manifest-related tables so they also advance the appropriate refresh-state seed.
- Add request counters and cache hit/miss instrumentation for:
  - `/api/v1/launches`
  - `/api/v1/launches/version`
  - `/api/v1/launches/[id]`
  - `/api/v1/launches/[id]/version`
  - `/api/news/stream`
  - `/api/v1/news`
  - `/api/filters`
  - `/api/v1/launches/filter-options`
- Record whether each request hit:
  - CDN only
  - origin shared cache
  - origin live DB path
  - private overlay path

### Phase 1: public cache correction and tag alignment

- Replace any time-bucket-only public feed payload cache with tag/version-aligned invalidation
- Move public feed version to refresh-state-backed seed reads
- Add shared invalidation tags for public feed and public detail cores
- News stream public client conversion plus shared cache
- Public filter-options shared cache
- Public loader standardization to public client where safe

Exit criteria:

- Public scope no longer depends on per-instance `Map` protection for hot routes
- Public feed/version hit ratios are observable
- Public version routes no longer require viewer lookup when serving public cadence
- Public feed payloads do not remain stale across upstream NET/status changes simply because a time bucket has not rolled

### Phase 2: premium low-latency invalidation

- Add authenticated realtime broadcast topics for:
  - `live feed`
  - `live detail:<launchId>`
- Emit launch-change events from the server-side change path using database-triggered or job-triggered broadcast
- On web and mobile, subscribe when the user is premium and the relevant surface is active
- On event receipt:
  - invalidate the relevant React Query keys
  - refetch the private version or payload immediately
- Keep adaptive polling as fallback when realtime is unavailable or the app is backgrounded

Exit criteria:

- Active premium clients no longer depend on cache expiry to learn about live launch changes
- Premium event delivery is measurable and has reconnect/fallback behavior
- Premium data still never becomes publicly cacheable

### Phase 3: launch detail structural split

- Introduce a shared `public launch detail core` loader keyed by `launchId`
- Move stable subqueries into shared cached module loaders
- Keep entitlement and privacy overlays dynamic
- Reuse the same cached public detail modules for:
  - `/api/v1/launches/[id]`
  - the web launch detail page
  - any internal mobile detail assemblers

Exit criteria:

- Public detail route still returns the same contract
- Shared public detail modules are reused across page and API
- Whole-response caching is still avoided for personalized output

### Phase 4: premium-safe auth-gated caching

- Add auth-gated micro-cache or request coalescing for:
  - live feed version
  - live feed payload if metrics justify it
  - premium trajectory
  - live-only detail submodules that are not user-specific
- Keep client responses `private` or `no-store`

Exit criteria:

- No premium-gated data becomes publicly cacheable
- Auth happens before any shared origin cache read/write for premium-only routes

### Phase 5: catalog and broader reference route hardening

- Add shared origin caches for catalog collection, catalog detail, and related-launch lookups
- Review other public reference APIs that currently rely on header-only caching and dynamic server loaders
- Reuse the canonical-contracts and AR-eligibility patterns where applicable

### Phase 6: mobile client-side reductions

- Persist guest bootstrap state in secure storage until expiry
- Add scope-aware query stale times:
  - public feed and public detail longer than `30s`
  - live feed/detail remain short because realtime or hot polling will drive invalidation
- Add targeted persisted query caches for low-risk public data:
  - public feed first page
  - public detail core
  - catalog hubs and collections
  - news stream first page

Exit criteria:

- Cold-start mobile traffic drops for guest bootstrap and common public reads
- Persisted caches do not include user-private or observer-personalized payloads

## Invalidation Plan

- Public feed payloads and public feed version seeds must share the same invalidation boundary.
- Public detail core and public detail version seed must share the same invalidation boundary.
- Live feed/detail payload freshness should be driven by change signals and refresh-state seeds, not payload TTLs.
- If tag invalidation is available, emit tags from public-cache refresh jobs and invalidate:
  - `public-feed`
  - `public-feed-version`
  - `public-detail:<launchId>`
  - `public-detail-version:<launchId>`
- If tag invalidation is not ready, use matched short TTLs and do not let version seeds refresh materially faster than payload caches.
- For premium live freshness, emit authenticated broadcast topics such as:
  - `live-feed`
  - `live-detail:<launchId>`
- Avoid direct raw client fan-out from broad Postgres Changes subscriptions on RLS-heavy live tables. Prefer authenticated broadcast or server-side restream for scale.
- Cache-table-backed read models remain valid where the source is already denormalized and refreshed by jobs.

## Risk Notes

- The main functional risk is version/payload skew. This is why version and payload invalidation must move together.
- The main security risk is accidentally caching entitlement- or observer-sensitive data in a shared layer.
- The main product risk is over-caching live or launch-day modules and making Premium feel stale.
- The main premium-risk correction from this review is clear: time-bucketed feed payload caches can break countdown/status freshness even if the client-side countdown clock itself keeps ticking.
- The main infrastructure risk is thinking CDN headers alone solve the problem when origin misses and variant churn still hit the database hard.

## Acceptance Criteria

- Public scope version endpoints do not perform unnecessary auth or tier resolution work.
- Hot public routes use shared origin cache, not only edge headers.
- Premium and RLS-sensitive data never appear in a shared public cache.
- Active premium clients receive near-instant live invalidation without waiting for cache expiry when realtime is available.
- Premium fallback polling remains fast enough to preserve product expectations during hot windows.
- Version seed endpoints are backed by lightweight refresh-state records, not repeated broad source-table scans.
- Public loaders do not rely on `createSupabaseServerClient()` unless there is an explicit reason.
- Multi-instance deployments retain protection because hot-path caches are shared or job-backed, not process-local only.
- Live freshness remains product-correct during launch windows.

## Verification Set

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard` when mobile/shared query behavior changes
- `npm run type-check:ci`
- `npm run type-check:mobile` when mobile code changes
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile` when mobile code changes
- targeted route tests for feed/detail/version/news/filter-options once cache boundaries are refactored
- load-test samples for public feed/version/detail before and after Phase 1 and Phase 2
- premium realtime delivery tests:
  - websocket connect/reconnect
  - auth expiry and token refresh
  - background/foreground fallback to polling
  - duplicate-event collapse
  - out-of-order event handling by version seed comparison

## Recommended Implementation Sequence

1. Phase 0 instrumentation, cache-key normalization, and refresh-state seeds
2. Public feed/public detail tag alignment and correction of any time-bucket-only cache behavior
3. News stream and public filter-options
4. Premium realtime invalidation plus adaptive polling fallback
5. Public launch detail core split and submodule caches
6. Premium-safe micro-caches and request collapse
7. Catalog and broader reference route cleanup
8. Mobile persistence and stale-time realignment

## Ownership Notes

- Web/API work owns route cache headers, shared origin caches, and public-vs-private response boundaries.
- Shared package work owns query stale-time policy and any contract-safe cache-key helpers.
- Mobile work owns guest bootstrap persistence and persisted query storage choices.
- Supabase/backend work owns cache-table refresh jobs, refresh-state records, and broadcast trigger/hooks when needed.
