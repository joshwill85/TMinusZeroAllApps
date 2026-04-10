# 2026-04-09 Contracts Cache Refresh Runbook

## Scope

- Customer-facing: yes
- Web: included
- iOS: included indirectly through shared `/api/v1` reads
- Android: included indirectly through shared `/api/v1` reads
- Admin/internal impact: yes
- Shared API/backend impact: yes

## Goal

Operationalize the canonical contracts cache so:

1. customer reads do not synchronously rebuild stale cache data
2. successful source ingests refresh the cache best-effort
3. admin USASpending review promotions refresh the same cache
4. deploys and backfills have a deterministic warm path

## Current architecture

- Customer reads now serve the existing canonical contracts cache and only cold-build when the cache is missing or empty.
- The web app exposes a signed internal refresh endpoint at `/api/internal/revalidate/contracts`.
- The following write paths now attempt a best-effort refresh callback:
  - `artemis-contracts-ingest`
  - `blue-origin-contracts-ingest`
  - `program-contract-story-sync`
  - admin USASpending review promotion

Refresh failures do **not** fail customer reads and do **not** fail ingest completion.

## Required environment variables

### Web app

- `INTERNAL_REVALIDATE_CONTRACTS_TOKEN`
  - strong random shared secret
  - used by `/api/internal/revalidate/contracts`

### Supabase functions

- `TMZ_REVALIDATE_CONTRACTS_URL`
  - full HTTPS URL to the deployed internal route
  - example: `https://www.tminuszero.com/api/internal/revalidate/contracts`
- `TMZ_REVALIDATE_CONTRACTS_TOKEN`
  - same secret value as `INTERNAL_REVALIDATE_CONTRACTS_TOKEN`

## Deployment order

1. Deploy the web app code that includes:
   - `apps/web/lib/server/contracts.ts`
   - `apps/web/lib/server/contractsCacheRefresh.ts`
   - `apps/web/app/api/internal/revalidate/contracts/route.ts`
   - `apps/web/app/api/admin/usaspending/reviews/route.ts`
2. Set `INTERNAL_REVALIDATE_CONTRACTS_TOKEN` in the web environment.
3. Confirm the web deployment is live.
4. Set `TMZ_REVALIDATE_CONTRACTS_URL` and `TMZ_REVALIDATE_CONTRACTS_TOKEN` in the Supabase function environment.
5. Deploy the affected Supabase functions:
   - `artemis-contracts-ingest`
   - `blue-origin-contracts-ingest`
   - `program-contract-story-sync`
6. Warm the contracts cache once manually after deploy.
7. Trigger one representative write path:
   - one successful ingest run, or
   - one admin USASpending review promotion
8. Verify callback success in logs and/or ingestion run stats.

## Manual warm command

```bash
curl -X POST "$SITE_URL/api/internal/revalidate/contracts" \
  -H "Authorization: Bearer $INTERNAL_REVALIDATE_CONTRACTS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual","reason":"post-deploy-warm"}'
```

Expected response shape:

```json
{
  "ok": true,
  "source": "manual",
  "reason": "post-deploy-warm",
  "contractRows": 123,
  "revalidatedPaths": 456,
  "skippedDetailPaths": 0
}
```

## Verification checklist

### Web route

- `POST /api/internal/revalidate/contracts` returns `200`.
- Response includes `ok: true`.
- `contractRows` is greater than `0` in populated environments.

### Customer read behavior

- `/contracts` loads without a cold rebuild when cache rows already exist.
- `/api/public/contracts` returns expected paged payloads.
- `/api/v1/contracts/page` and `/api/v1/spacex/contracts/page` continue to return expected shapes.

### Admin write path

- `POST /api/admin/usaspending/reviews` with `action=promote` returns `ok: true`.
- Response includes `cacheRefresh.ok: true` after envs are configured.

### Ingest write paths

- `artemis-contracts-ingest`, `blue-origin-contracts-ingest`, and `program-contract-story-sync` stats show:
  - `contractsRevalidateRequested: true`
  - `contractsRevalidateSucceeded: true`
- They should no longer report `revalidate_not_configured` once envs are set.

## Failure modes

### `revalidate_not_configured`

Cause:
- missing one or more required env vars

Fix:
- set the web token
- set the Supabase callback URL and token
- redeploy the affected surfaces

### `revalidate_url_invalid`

Cause:
- malformed `TMZ_REVALIDATE_CONTRACTS_URL`

Fix:
- correct the URL
- redeploy the affected Supabase functions

### `revalidate_http_401`

Cause:
- token mismatch between web and Supabase environments

Fix:
- make both sides use the exact same secret
- redeploy

### `revalidate_http_500`

Cause:
- internal route threw while rebuilding or revalidating

Fix:
- inspect web logs for `internal contracts revalidate error`
- retry the manual warm command after the underlying issue is fixed

## Rollback

If the callback path misbehaves:

1. leave the safe read-path change in place
2. unset `TMZ_REVALIDATE_CONTRACTS_URL` and/or `TMZ_REVALIDATE_CONTRACTS_TOKEN`
3. redeploy the affected Supabase functions
4. continue using manual warm calls after deploy or backfill until the callback issue is fixed

This rollback preserves customer-read safety because stale cache reads remain served without synchronous stale rebuilds.

## Recommended next step

Automate one post-deploy cache warm step for production so the empty-cache cold start path is never exercised by customer traffic.
