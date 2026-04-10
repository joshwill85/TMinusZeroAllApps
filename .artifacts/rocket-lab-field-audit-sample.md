# Rocket Lab Field Audit

- generatedAt: 2026-04-09T03:20:26.017Z
- mode: fixture
- fixtureJsonPath: scripts/fixtures/rocket-lab/rocket-lab-field-audit-sample.json
- joinAuditJsonPath: —
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- launchesEligibleFromJoinAudit=2
- launchesAudited=2
- launchesFetchedSuccessfully=2
- launchesWithInclination=1
- launchesWithFlightAzimuth=0
- launchesWithAltitude=1
- launchesWithApogee=0
- launchesWithPerigee=0
- launchesWithOrbitClass=0
- launchesWithAnyNumericOrbitField=1
- launchesWithMilestoneSignals=2
- launchesWithRecoverySignals=0
- launchesWithNumericOrbitSignals=1
- launchesWithAuthorityFieldBundle=1

## Reasons

- Field audit evaluated 2/2 deterministic-or-probable Rocket Lab joins from the join audit.
- Numeric orbit-like values were present on 1/2 matched launches, orbit class on 0/2, milestone signals on 2/2, and recovery signals on 0/2.
- Only 1/2 matched launches carried both a numeric orbit-like field and milestone signals, so usable coverage remains "no".

## Launches

| Launch | Match | Inclination | Azimuth | Orbit class | Milestones | Recovery | Authority bundle |
|---|---|---:|---:|---|---:|---:|---|
| Eight Days A Week (StriX Launch 8) | deterministic | 97.3 | — | — | 1 | 0 | yes |
| LOXSAT 1 | probable | — | — | — | 4 | 0 | no |

