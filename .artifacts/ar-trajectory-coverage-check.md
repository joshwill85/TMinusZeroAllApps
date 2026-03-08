# AR Trajectory Coverage Check

- generatedAt: 2026-03-05T21:07:27.613Z
- policyVersion: ar_trajectory_coverage_policy_v1
- lookaheadLaunches: 8
- lookaheadDays: 50
- result: FAIL

## Checks

| Check | Value | Threshold | Status |
|---|---:|---:|---|
| coverage.min_launches | 8.000 | >= 4 | pass |
| coverage.truth_tier_orbit_rate | 0.125 | >= 0.35 | fail |
| coverage.derived_only_orbit_rate | 0.625 | <= 0.5 | fail |
| coverage.no_directional_constraint_rate | 0.250 | <= 0.4 | pass |
| coverage.missing_or_stale_product_rate | 0.750 | <= 0.35 | fail |
| coverage.pad_only_product_rate | 0.000 | <= 0 | pass |

## Summary

- launchesEvaluated=8
- truthTierOrbitCoverageRate=12.5%
- derivedOnlyOrbitCoverageRate=62.5%
- noDirectionalConstraintRate=25.0%
- missingOrStaleProductRate=75.0%
- padOnlyProductRate=0.0%

## Launches

| Launch | NET | Product | Truth orbit | Derived-only orbit | Directional constraint | Pad-only product | Missing/stale product |
|---|---|---:|---|---|---|---|---|
| Insight At Speed Is A Friend Indeed (BlackSky Gen-3 4) | 2026-03-05T23:53:00+00:00 | 2 | yes | no | yes | no | yes |
| Starlink Group 17-18 | 2026-03-07T10:58:00+00:00 | 2 | no | yes | yes | no | yes |
| Stairway to Seven | 2026-03-10T00:50:00+00:00 | 2 | no | no | no | no | no |
| EchoStar 25 | 2026-03-10T03:14:00+00:00 | 2 | no | no | no | no | no |
| Starlink Group 17-31 | 2026-03-11T10:58:00+00:00 | 2 | no | yes | yes | no | yes |
| Starlink Group 10-48 | 2026-03-12T10:00:00+00:00 | 2 | no | yes | yes | no | yes |
| Starlink Group 17-24 | 2026-03-15T02:37:00+00:00 | 2 | no | yes | yes | no | yes |
| Starlink Group 10-46 | 2026-03-15T11:11:00+00:00 | 2 | no | yes | yes | no | yes |

