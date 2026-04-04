# Anti-Ingestion Hardening Plan

Last updated: 2026-04-04

Platform matrix:
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Raise the cost of building on top of T-Minus Zero data without hurting:
- public SEO HTML
- ordinary human browsing on the site
- current mobile app contracts

This slice is deterrence and containment, not “impossible to scrape.”

## Locked Decisions

- Keep public HTML crawlable and indexable.
- Treat JSON API routes as first-party delivery surfaces, not open integration surfaces.
- Keep mobile auth/session Supabase usage in place.
- Stop relying on anon/browser Supabase data access as a supported product-data path.
- Roll out mobile guest-token enforcement compatibly so existing binaries are not hard-broken on day one.

## Implementation Scope

### Phase 1
- Add first-party browser proof via a short-lived signed `tmz_public_view` cookie issued on public HTML responses.
- Add a signed mobile guest bootstrap token flow at `POST /api/v1/client/bootstrap`.
- Add middleware guards for:
  - `/api/public/*`
  - selected anonymous `/api/v1/*` public-data families
- Add API hardening headers:
  - `X-Robots-Tag: noindex, nofollow` on `/api/*`
  - `/api/` remains disallowed in `robots.txt`

### Phase 2
- Split Supabase auth client usage from server-owned product-data client usage.
- Move server-side “public” data helpers onto a server-owned client so we can revoke the external grants they depended on.
- Revoke the highest-value external Supabase integration surfaces first:
  - public search table + search RPC
  - public token-validation RPCs
  - selected public views/RPCs used for contracts and satellite-owner SEO payloads

### Phase 3
- Audit remaining anon-readable cache tables and shift the remaining SSR/public helpers off anon server clients before revoking those grants.

## Rollout Order

1. Land middleware proof issuance and API denial paths in a compatibility-safe form.
2. Ship mobile guest bootstrap support and token headers.
3. Keep legacy native-app anonymous reads allowed temporarily via conservative request heuristics.
4. Revoke the first set of direct Supabase integration surfaces after server-owned fallbacks are live.
5. Tighten `/api/v1` guest enforcement after mobile adoption is confirmed.

## Rollback Notes

- Middleware protection can be relaxed by switching guest enforcement back to heuristic-only behavior while keeping the bootstrap route live.
- Supabase grant revocations are isolated in additive migrations so the access surface can be restored in a follow-up migration if needed.
- Browser auth/account flows continue using Supabase anon auth paths, so auth rollback is not coupled to product-data rollback.

## Verification Set

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run test:web-regression`
- `npm run test:seo`

## Residual Risks After This Slice

- Public cache tables that still need anon-access audit remain a direct Supabase surface until the Phase 3 table-by-table migration is complete.
- Legacy mobile guest traffic is preserved through temporary heuristics, which raises friction for abuse but does not yet make unsigned replay impossible.
- Verified SEO bots remain allowed on HTML surfaces by design, so visible public content is still ultimately scrapeable through HTML.
