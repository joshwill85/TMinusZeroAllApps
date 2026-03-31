# AR Trajectory Coverage Check

- generatedAt: 2026-03-26T19:51:17.525Z
- policyVersion: ar_trajectory_coverage_policy_v1
- lookaheadLaunches: 8
- lookaheadDays: 50
- result: FAIL

## Checks

| Check | Value | Threshold | Status |
|---|---:|---:|---|
| coverage.min_launches | 8.000 | >= 4 | pass |
| coverage.truth_tier_orbit_rate | 0.000 | >= 0.35 | fail |
| coverage.derived_only_orbit_rate | 0.625 | <= 0.5 | fail |
| coverage.no_directional_constraint_rate | 0.375 | <= 0.4 | pass |
| coverage.missing_or_stale_product_rate | 0.000 | <= 0.35 | pass |
| coverage.pad_only_product_rate | 0.000 | <= 0 | pass |

## Summary

- launchesEvaluated=8
- truthTierOrbitCoverageRate=0.0%
- derivedOnlyOrbitCoverageRate=62.5%
- noDirectionalConstraintRate=37.5%
- missingOrStaleProductRate=0.0%
- padOnlyProductRate=0.0%

## Launches

| Launch | NET | Product | Directional source | Primary gap | Truth orbit | Derived-only orbit | Directional constraint | Pad-only product | Missing/stale product |
|---|---|---:|---|---|---|---|---|---|---|
| Starlink Group 17-17 | 2026-03-26T23:03:00+00:00 | 2 | Constraint-backed | Orbit is derived-only | no | yes | yes | no | no |
| Unknown Payload | 2026-03-27T04:10:00+00:00 | 2 | Template prior | No external directional constraint | no | no | no | no | no |
| Daughter Of The Stars (LEO-PNT Pathfinder A) | 2026-03-28T09:14:00+00:00 | 2 | Constraint-backed | Orbit is derived-only | no | yes | yes | no | no |
| Onward and Upward | 2026-03-28T20:00:00+00:00 | 2 | Constraint-backed | Orbit is derived-only | no | yes | yes | no | no |
| Amazon Leo (LA-05) | 2026-03-29T07:53:00+00:00 | 2 | Hazard area | Orbit is derived-only | no | yes | yes | no | no |
| Starlink Group 10-44 | 2026-03-29T21:15:00+00:00 | 2 | Hazard area | Orbit is derived-only | no | yes | yes | no | no |
| Transporter 16 (Dedicated SSO Rideshare) | 2026-03-30T10:20:00+00:00 | 2 | Template prior | No external directional constraint | no | no | no | no | no |
| Qingzhou Spacecraft Demo Flight | 2026-03-31T00:00:00+00:00 | 2 | Template prior | No external directional constraint | no | no | no | no | no |

