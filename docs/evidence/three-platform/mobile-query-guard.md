# Mobile Query Guard

Generated: 2026-03-09T01:50:34.658Z

## viewer bootstrap

- Total requests: 2
- viewer session bootstrap dedupes to one request
- viewer entitlements bootstrap dedupes to one request

| request | count |
| --- | ---: |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

## feed bootstrap

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

## search fan-out and cache

- Total requests: 1
- normalized duplicate search queries reuse one /api/v1/search request

| request | count |
| --- | ---: |
| `GET /api/v1/search?q=starlink` | 1 |

## account bootstrap

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

## saved bootstrap

- Total requests: 4
- saved bootstrap uses one preset request
- saved bootstrap uses one watchlist request

| request | count |
| --- | ---: |
| `GET /api/v1/me/filter-presets` | 1 |
| `GET /api/v1/me/watchlists` | 1 |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |

## preferences bootstrap

- Total requests: 3
- preferences bootstrap keeps notification preferences app-scoped and reusable

| request | count |
| --- | ---: |
| `GET /api/v1/me/notification-preferences` | 1 |
| `GET /api/v1/viewer/entitlements` | 1 |
| `GET /api/v1/viewer/session` | 1 |
