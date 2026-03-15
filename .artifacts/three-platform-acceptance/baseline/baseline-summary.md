# Three-Platform Baseline Evidence

Generated: 2026-03-09T03:04:33.690Z

## Request Counts and Cache Reuse

### viewer bootstrap

- Total requests: 2
- viewer session bootstrap dedupes to one request
- viewer entitlements bootstrap dedupes to one request

| request | count |
| --- | ---: |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

### feed bootstrap

- Total requests: 5
- feed bootstrap uses one launches request
- feed saved-state bootstrap reuses preset and watchlist cache on repeat reads

| request | count |
| --- | ---: |
| `GET /api/v1/launches?limit=20&region=all` | 1 |
| `GET /api/v1/me/filter-presets` | 1 |
| `GET /api/v1/me/watchlists` | 1 |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

### search fan-out and cache

- Total requests: 1
- normalized duplicate search queries reuse one /api/v1/search request

| request | count |
| --- | ---: |
| `GET /api/v1/search?q=starlink` | 1 |

### account bootstrap

- Total requests: 6
- account bootstrap reuses profile, marketing email, notification preferences, and launch-day filter caches

| request | count |
| --- | ---: |
| `GET /api/filters?mode=live&region=all` | 1 |
| `GET /api/v1/me/marketing-email` | 1 |
| `GET /api/v1/me/notification-preferences` | 1 |
| `GET /api/v1/me/profile` | 1 |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

### saved bootstrap

- Total requests: 4
- saved bootstrap uses one preset request
- saved bootstrap uses one watchlist request

| request | count |
| --- | ---: |
| `GET /api/v1/me/filter-presets` | 1 |
| `GET /api/v1/me/watchlists` | 1 |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

### preferences bootstrap

- Total requests: 3
- preferences bootstrap keeps notification preferences app-scoped and reusable

| request | count |
| --- | ---: |
| `GET /api/v1/me/notification-preferences` | 1 |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

## Raw /api Fetch Guard

- Remaining raw `fetch('/api/...')` call sites in apps/web: 37
- Mobile-critical violations: 0

| file | count |
| --- | ---: |
| `apps/web/app/admin/ops/page.tsx` | 5 |
| `apps/web/app/admin/coupons/page.tsx` | 3 |
| `apps/web/app/admin/ops/trajectory/page.tsx` | 3 |
| `apps/web/app/admin/users/page.tsx` | 2 |
| `apps/web/app/blue-origin/_components/BlueOriginProcurementLedger.tsx` | 2 |
| `apps/web/app/spacex/_components/SpaceXUsaspendingAwardsPanel.tsx` | 2 |
| `apps/web/components/TipJarFooter.tsx` | 2 |
| `apps/web/components/TipJarModal.tsx` | 2 |
| `apps/web/lib/ar/telemetryClient.ts` | 2 |
| `apps/web/app/admin/billing/page.tsx` | 1 |
| `apps/web/app/admin/feedback/page.tsx` | 1 |
| `apps/web/app/admin/usaspending/page.tsx` | 1 |
| `apps/web/app/blue-origin/_components/BlueOriginSignalLog.tsx` | 1 |
| `apps/web/components/ar/CameraGuideButton.tsx` | 1 |
| `apps/web/components/artemis/dashboard/ViewBudget.tsx` | 1 |
| `apps/web/components/embed/EmbeddedNextLaunchCard.tsx` | 1 |
| `apps/web/components/FeedbackWidget.tsx` | 1 |
| `apps/web/components/JepScoreClient.tsx` | 1 |
| `apps/web/components/LaunchCalendar.tsx` | 1 |
| `apps/web/components/news/CommLinkStream.tsx` | 1 |

## TTFB

- Requests per route: 5
- Warmup requests per route: 2

| route | p50 ms | p95 ms | mean ms |
| --- | ---: | ---: | ---: |
| `/api/v1/launches?limit=20&region=all` | 2.141 | 2.416 | 2.098 |
| `/api/v1/search?q=starlink&limit=8` | 1.799 | 1.947 | 1.718 |

## CI Task Graph

- Workspaces scanned: 8
- Turbo dependency edges: 3

| task | workspace count |
| --- | ---: |
| `lint` | 2 |
| `type-check` | 2 |
| `type-check:ci` | 1 |
| `build` | 1 |

## Remaining Gaps

- Feed render and scroll performance still require a browser/device harness or manual trace capture; this script records request/cache evidence only.
- Auth-return and upgrade intent are guarded statically through source-shape checks, not end-to-end browser execution.
