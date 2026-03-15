# Phase 3 Web Closeout Guard

Generated: 2026-03-09T01:36:50.195Z

- Mobile-critical files scanned: 28
- Total apps/web source files scanned: 669
- Remaining raw `fetch('/api/...')` call sites in apps/web: 37

## Surface Expectations

| file | status | missing tokens |
| --- | --- | --- |
| `apps/web/components/LaunchFeed.tsx` | ok | — |
| `apps/web/app/account/page.tsx` | ok | — |
| `apps/web/app/account/saved/page.tsx` | ok | — |
| `apps/web/app/me/preferences/page.tsx` | ok | — |
| `apps/web/app/auth/callback/AuthCallbackClient.tsx` | ok | — |
| `apps/web/components/UpgradePageContent.tsx` | ok | — |

## Remaining Raw /api Fetches

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
| `apps/web/components/RocketVolatilitySection.tsx` | 1 |
| `apps/web/components/TipJarRecurringPanel.tsx` | 1 |
| `apps/web/lib/ar/runtimePolicyClient.ts` | 1 |

## Violations

- none
