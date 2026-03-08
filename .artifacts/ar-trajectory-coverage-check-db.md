# AR Trajectory Coverage Check

- generatedAt: 2026-02-10T02:37:59.311Z
- policyVersion: ar_trajectory_coverage_policy_v1
- lookaheadLaunches: 8
- lookaheadDays: 50
- result: FAIL

## Checks

| Check | Value | Threshold | Status |
|---|---:|---:|---|
| coverage.min_launches | 8.000 | >= 4 | pass |
| coverage.truth_tier_orbit_rate | 0.000 | >= 0.35 | fail |
| coverage.derived_only_orbit_rate | 0.500 | <= 0.5 | pass |
| coverage.no_directional_constraint_rate | 0.500 | <= 0.4 | fail |
| coverage.missing_or_stale_product_rate | 0.625 | <= 0.35 | fail |

## Summary

- launchesEvaluated=8
- truthTierOrbitCoverageRate=0.0%
- derivedOnlyOrbitCoverageRate=50.0%
- noDirectionalConstraintRate=50.0%
- missingOrStaleProductRate=62.5%

## Launches

| Launch | NET | Product | Truth orbit | Derived-only orbit | Directional constraint | Missing/stale product |
|---|---|---:|---|---|---|---|
| Starlink Group 17-34 | 2026-02-11T14:07:00+00:00 | 0 | no | yes | yes | no |
| Unknown Payload | 2026-02-12T06:30:00+00:00 | 0 | no | no | no | no |
| USSF-87 | 2026-02-12T08:30:00+00:00 | 0 | no | no | no | no |
| Elektro-L No.5 | 2026-02-12T08:52:15+00:00 | — | no | no | no | yes |
| Crew-12 | 2026-02-12T10:38:00+00:00 | 0 | no | yes | yes | yes |
| Amazon Leo (LE-01) | 2026-02-12T16:45:00+00:00 | — | no | no | no | yes |
| Starlink Group 6-103 | 2026-02-14T05:00:00+00:00 | 2 | no | yes | yes | yes |
| Starlink Group 17-13 | 2026-02-14T22:00:00+00:00 | — | no | yes | yes | yes |

