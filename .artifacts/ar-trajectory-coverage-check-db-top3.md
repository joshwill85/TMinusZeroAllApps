# AR Trajectory Coverage Check

- generatedAt: 2026-02-10T02:38:47.543Z
- policyVersion: ar_trajectory_coverage_policy_v1
- lookaheadLaunches: 3
- lookaheadDays: 50
- result: FAIL

## Checks

| Check | Value | Threshold | Status |
|---|---:|---:|---|
| coverage.min_launches | 3.000 | >= 4 | fail |
| coverage.truth_tier_orbit_rate | 0.000 | >= 0.35 | fail |
| coverage.derived_only_orbit_rate | 0.333 | <= 0.5 | pass |
| coverage.no_directional_constraint_rate | 0.667 | <= 0.4 | fail |
| coverage.missing_or_stale_product_rate | 0.000 | <= 0.35 | pass |

## Summary

- launchesEvaluated=3
- truthTierOrbitCoverageRate=0.0%
- derivedOnlyOrbitCoverageRate=33.3%
- noDirectionalConstraintRate=66.7%
- missingOrStaleProductRate=0.0%

## Launches

| Launch | NET | Product | Truth orbit | Derived-only orbit | Directional constraint | Missing/stale product |
|---|---|---:|---|---|---|---|
| Starlink Group 17-34 | 2026-02-11T14:07:00+00:00 | 0 | no | yes | yes | no |
| Unknown Payload | 2026-02-12T06:30:00+00:00 | 0 | no | no | no | no |
| USSF-87 | 2026-02-12T08:30:00+00:00 | 0 | no | no | no | no |

