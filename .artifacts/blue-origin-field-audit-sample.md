# Blue Origin Field Audit

- generatedAt: 2026-04-09T03:29:18.494Z
- mode: fixture
- fixtureJsonPath: scripts/fixtures/blue-origin/blue-origin-field-audit-sample.json
- auditJsonPath: tmp/blue-origin-audit.json
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- launchesScanned=3
- launchesWithOfficialSourcePages=2
- launchesWithHealthyOfficialSources=2
- launchesAudited=2
- launchesFetchedSuccessfully=2
- launchesWithProfileSignals=1
- launchesWithTimelineSignals=1
- launchesWithRecoverySignals=1
- launchesWithVisibilitySignals=0
- launchesWithNumericMissionFacts=1
- launchesWithAnyNumericOrbitField=1
- launchesWithAuthorityFieldBundle=1

## Reasons

- Field audit evaluated 2/3 Blue Origin launches with official source pages from the existing audit snapshot.
- Mission-profile signals were present on 1/2 audited launches, timeline signals on 1/2, recovery signals on 1/2, and numeric mission facts on 1/2.
- Only 1/2 audited launches carried both a numeric mission fact or orbit-like value and mission-profile or timeline structure, so usable coverage remains "no".

## Launches

| Launch | Source | Profile | Timeline | Recovery | Numeric facts | Orbit class | Authority bundle |
|---|---|---:|---:|---:|---:|---|---|
| NS-29 | Blue Origin Completes 29th New Shepard Mission | 1 | 3 | 3 | 1 | — | yes |
| Blue Moon Pathfinder | Blue Origin \| Blue Moon | 0 | 0 | 0 | 0 | — | no |
| Commercial Payload | — | 0 | 0 | 0 | 0 | — | no |

