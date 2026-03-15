# Three-Platform Hot Path Guard

Generated: 2026-03-10T01:00:44.650Z

| check | status | detail |
| --- | --- | --- |
| middleware-no-in-memory-rate-limit | ok | apps/web/middleware.ts should not own correctness-critical rate limiting. |
| legacy-search-no-refresh-on-read | ok | siteSearch warm path must stay deprecated and search must not trigger freshness sync. |
| legacy-search-warm-is-no-op | ok | legacy /api/search warm path is retained only as a backward-compatible entrypoint. |
| legacy-subscription-no-reconcile-on-read | ok | legacy /api/me/subscription must not trigger Stripe reconciliation on read. |
| billing-summary-no-reconcile-on-read | ok | shared billing summary reads must not reconcile Stripe synchronously. |
| durable-rate-limit-applied-at-routes | ok | public and tokenized routes should use the durable DB-backed rate-limit helper. |
