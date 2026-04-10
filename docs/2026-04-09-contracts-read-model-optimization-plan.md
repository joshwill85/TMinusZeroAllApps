# 2026-04-09 Contracts Read-Model Optimization Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Goal

Eliminate the remaining expensive full-list contract read paths by moving customer list and search surfaces onto additive paged APIs backed by a dedicated contracts read model, while preserving compatibility for existing full-array consumers and the true full-snapshot consumers that power search and sitemap generation.

## Non-goals

- Do not make breaking changes to existing `/api/v1` or public contract response shapes.
- Do not silently change `SpaceX` mission overview or contracts routes from full-array payloads to preview-only payloads.
- Do not force sitemap generation, search indexing, or other true snapshot consumers onto request-time pagination.
- Do not widen this effort into admin, ops, ingest orchestration, or unrelated program detail work.

## Current repo-backed gaps

### Canonical contracts

1. `fetchCanonicalContractsIndex()` still rebuilds the full cross-program contracts corpus in memory from `SpaceX`, `Blue Origin`, and `Artemis` source helpers.
2. `apps/web/app/api/public/contracts/route.ts` exposes `limit` and `offset` to callers but still loads the full canonical index, filters in memory, and slices in memory.
3. `apps/web/lib/server/v1/mobileContracts.ts` still loads the full canonical index before applying scope and query filtering for mobile/shared clients.
4. `apps/web/app/contracts/page.tsx` still renders from the full canonical snapshot rather than a true paged query path.

### SpaceX contracts

1. `apps/web/app/api/public/spacex/contracts/route.ts` still returns the compatibility full-array contracts payload from `fetchSpaceXContracts(mission)`.
2. `apps/web/lib/server/v1/mobileSpaceX.ts` still exposes the full-array contracts payload and the mission overview schema still expects `contracts: SpaceXContract[]`.
3. Full-array compatibility remains acceptable for now, but it should stop being the primary path for list UIs and generic contract discovery.

### Snapshot-only consumers

1. `apps/web/lib/server/siteSearchSync.ts` and `apps/web/lib/server/sitemapData.ts` still need a full contracts snapshot.
2. Those consumers should move to a database-backed full snapshot source, but they should not be forced onto request-time pagination semantics.

## Locked implementation decisions

1. Keep the existing full-array public and `/api/v1` contract payloads intact in the first pass.
2. Add new paged contracts contracts and routes instead of mutating old response semantics in place.
3. Introduce a dedicated canonical contracts read model in the database rather than continuing to assemble the full contracts corpus in request-time Node code.
4. Keep search semantics aligned with the current `buildCanonicalContractSearchText()` rules so the customer-visible matching behavior does not drift.
5. Keep sitemap and site-search generation on a true full-snapshot path, but source that snapshot from the database read model instead of rebuilding it in memory on every TTL refresh.
6. Treat `SpaceX` full-array mission/contracts payloads as compatibility surfaces until all customer list/search surfaces have additive paged alternatives.

## Delivery phases

### Phase 0: lock compatibility boundaries

1. Preserve these existing compatibility surfaces unchanged:
   - `apps/web/app/api/public/spacex/contracts/route.ts`
   - `apps/web/lib/server/v1/mobileSpaceX.ts` contracts payload
   - `apps/web/lib/server/v1/mobileSpaceX.ts` mission overview contract shape
   - `apps/web/lib/server/v1/mobileContracts.ts` full canonical contracts payload
2. Explicitly separate compatibility payloads from new list/search payloads so optimization work does not accidentally become a breaking API change.

### Phase 1: additive shared contracts

1. Add a paged canonical contracts schema in `packages/contracts/src/index.ts` with:
   - `generatedAt`
   - `scope`
   - `query`
   - `total`
   - `offset`
   - `limit`
   - `hasMore`
   - `totals`
   - `items`
2. Add a paged `SpaceX` contracts schema in `packages/contracts/src/index.ts` with:
   - `generatedAt`
   - `mission`
   - `total`
   - `offset`
   - `limit`
   - `hasMore`
   - `items`
3. Keep existing full-array schemas untouched and additive.

### Phase 2: database read model

1. Add a new canonical contracts read-model table or materialized cache relation in `supabase/migrations/*`.
2. Denormalize the fields needed for current list/search/detail entry points:
   - stable `uid`
   - `scope`
   - `storyStatus`
   - title/description/search text
   - contract identifiers and mission metadata
   - agency/customer/recipient
   - amount/awardedOn/status/updatedAt
   - canonical/program paths
   - story counts
   - source links
3. Add indexes for:
   - scope plus sort order
   - updated/date ordering
   - exact contract id lookup
   - search text lookups appropriate to the chosen search strategy
4. Add a refresh function and a clear refresh trigger strategy:
   - ingest-time refresh after SpaceX, Blue Origin, and Artemis contract updates
   - safe manual backfill path
   - partial refresh support where practical

### Phase 3: server helpers and routes

1. Add true paged server helpers in `apps/web/lib/server/contracts.ts` backed by the read model instead of `fetchCanonicalContractsIndex()`.
2. Add true paged `SpaceX` contracts helpers in `apps/web/lib/server/spacexProgram.ts`.
3. Move `apps/web/app/api/public/contracts/route.ts` to the read-model-backed paged helper.
4. Add additive paged `/api/v1` loaders for canonical contracts and `SpaceX` contracts.
5. Keep the legacy full-array loaders and routes alive as compatibility paths until all intended clients migrate.

### Phase 4: client adoption

1. Move `apps/web/app/contracts/page.tsx` to the additive paged canonical contracts route/helper.
2. Move mobile/shared list/search consumers to the paged canonical contracts route/helper where the UI only needs a slice of results.
3. Move any `SpaceX` list/search surfaces that only render a subset of contracts onto the additive paged `SpaceX` contracts route/helper.
4. Leave true snapshot consumers on the snapshot helper backed by the read model.

### Phase 5: snapshot consolidation and cleanup

1. Rebuild `fetchCanonicalContractsIndex()` as a database-backed snapshot helper rather than a request-time assembler.
2. Update `apps/web/lib/server/siteSearchSync.ts` and `apps/web/lib/server/sitemapData.ts` to use the snapshot helper sourced from the read model.
3. Only consider deprecating legacy full-array public or `/api/v1` routes after downstream client usage is verified and replacements exist.

## Primary files

### Shared contracts

- `packages/contracts/src/index.ts`

### Web/server helpers

- `apps/web/lib/server/contracts.ts`
- `apps/web/lib/server/spacexProgram.ts`
- `apps/web/lib/server/v1/mobileContracts.ts`
- `apps/web/lib/server/v1/mobileSpaceX.ts`

### Public routes and customer surfaces

- `apps/web/app/api/public/contracts/route.ts`
- `apps/web/app/api/public/spacex/contracts/route.ts`
- `apps/web/app/contracts/page.tsx`

### Snapshot consumers

- `apps/web/lib/server/siteSearchSync.ts`
- `apps/web/lib/server/sitemapData.ts`

### Backend

- `supabase/migrations/*`
- `supabase/functions/*` for any refresh orchestration needed after ingest

## Rollout order

1. Land additive shared contracts for paged list/search payloads.
2. Land the canonical contracts read model and refresh functions.
3. Switch public/web paged list surfaces onto the read model.
4. Switch mobile/shared list/search consumers onto the additive paged APIs.
5. Move full snapshot helpers to the database-backed snapshot path.
6. Re-measure `pg_stat_statements` and remove only the redundant request-time assemblers.

Operational rollout details for the refresh callback and cache warm path live in [2026-04-09-contracts-cache-refresh-runbook.md](/Users/petpawlooza/TMinusZero%20AllApps/docs/2026-04-09-contracts-cache-refresh-runbook.md).

## Rollback notes

1. New paged contracts/routes remain additive and can be abandoned without breaking current clients.
2. Legacy full-array routes stay live during rollout and provide the fallback path.
3. The read-model refresh should be isolated from source ingest so a refresh failure does not block source data ingestion.
4. Snapshot consumers should keep their current fallback behavior until the new read model is proven stable.

## Verification

Run under the pinned toolchain only.

1. `node -v && npm -v`
2. `npm run doctor`
3. `npm run check:three-platform:boundaries`
4. `npm run test:v1-contracts`
5. `npm run test:mobile-query-guard`
6. `npm run type-check:ci`
7. `npm run type-check:mobile` if mobile client code changes
8. `npm run lint`
9. `npm run lint --workspace @tminuszero/mobile` if mobile client code changes
10. `deno check` for any modified Supabase functions

## Known issues and design risks

1. Existing contracts schemas intentionally encode full-array payloads in several places, so changing those payloads in place would be a breaking change disguised as a performance fix.
2. Search semantics currently live in TypeScript via `buildCanonicalContractSearchText()`. If the read model moves search into SQL, the generated search text and matching behavior must stay aligned or customers will see search drift.
3. The canonical contracts snapshot still feeds sitemap and site-search generation. A naive “page everything” rewrite would regress those flows.
4. Mixed deploy state is likely during rollout. Server helpers need the same kind of safe fallback behavior already used for the phase-1 `ingestion_runs` RPC changes.
5. Read-model freshness matters. If refreshes only happen on a timer, contract pages and search will look stale after ingest; if refreshes happen synchronously on every write, ingest latency may regress.
6. The current request-time snapshot builder dedupes and sorts in one place. The read model must preserve those same uniqueness and ordering rules or canonical contract URLs and counts may drift.
