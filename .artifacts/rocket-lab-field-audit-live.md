# Rocket Lab Field Audit

- generatedAt: 2026-04-09T03:20:42.650Z
- mode: live
- fixtureJsonPath: —
- joinAuditJsonPath: .artifacts/rocket-lab-join-audit-live.json
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- launchesEligibleFromJoinAudit=13
- launchesAudited=13
- launchesFetchedSuccessfully=13
- launchesWithInclination=1
- launchesWithFlightAzimuth=0
- launchesWithAltitude=2
- launchesWithApogee=0
- launchesWithPerigee=0
- launchesWithOrbitClass=8
- launchesWithAnyNumericOrbitField=2
- launchesWithMilestoneSignals=4
- launchesWithRecoverySignals=0
- launchesWithNumericOrbitSignals=5
- launchesWithAuthorityFieldBundle=0

## Reasons

- Field audit evaluated 13/13 deterministic-or-probable Rocket Lab joins from the join audit.
- Numeric orbit-like values were present on 2/13 matched launches, orbit class on 8/13, milestone signals on 4/13, and recovery signals on 0/13.
- Only 0/13 matched launches carried both a numeric orbit-like field and milestone signals, so usable coverage remains "no".

## Launches

| Launch | Match | Inclination | Azimuth | Orbit class | Milestones | Recovery | Authority bundle |
|---|---|---:|---:|---|---:|---:|---|
| Eight Days A Week (StriX Launch 8) | deterministic | 50.2 | — | LEO | 0 | 0 | no |
| Daughter Of The Stars (LEO-PNT Pathfinder A) | deterministic | — | — | LEO | 0 | 0 | no |
| Kakushin Rising (JAXA Rideshare) | deterministic | — | — | — | 0 | 0 | no |
| LOXSAT 1 | probable | — | — | LEO | 4 | 0 | no |
| Aspera | deterministic | — | — | — | 0 | 0 | no |
| iQPS Launch 7 | probable | — | — | LEO | 0 | 0 | no |
| iQPS Launch 8 | probable | — | — | LEO | 0 | 0 | no |
| iQPS Launch 9 | probable | — | — | LEO | 0 | 0 | no |
| iQPS Launch 10 | probable | — | — | LEO | 0 | 0 | no |
| iQPS Launch 11 | probable | — | — | LEO | 0 | 0 | no |
| HASTE \| Leidos-3 | probable | — | — | — | 1 | 0 | no |
| HASTE \| Leidos-4 | probable | — | — | — | 1 | 0 | no |
| HASTE \| Leidos-5 | probable | — | — | — | 1 | 0 | no |

