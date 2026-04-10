# Rocket Lab Join Audit

- generatedAt: 2026-04-09T03:11:04.856Z
- mode: fixture
- fixtureJsonPath: scripts/fixtures/rocket-lab/rocket-lab-join-audit-sample.json
- sourceAuditJsonPath: —
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- launchesScanned=4
- candidatePagesScanned=4
- launchesWithDeterministicMatch=2
- launchesWithProbableMatch=0
- launchesWithAmbiguousMatch=1
- launchesWithoutMatch=1
- launchesWithMatchedTrajectorySignals=2
- launchesWithMatchedOrbitSignals=2
- launchesWithMatchedMilestoneSignals=0
- launchesWithMatchedRecoverySignals=0
- launchesWithMatchedNumericOrbitSignals=0

## Reasons

- Candidate availability is yes: 4 Rocket Lab mission/update pages were available for join scoring against 4 bounded inventory launches.
- Joinability is partial: 2/4 launches matched deterministically, 0/4 matched probably, 1/4 remained ambiguous, and 1/4 had no qualifying match.
- Usable coverage stays "no" because this audit only proves candidate-page joins; it does not prove that enough matched launches expose direction, milestone, recovery, or visibility values at rollout-grade coverage.
- Among launches with fetched matched pages, 2 showed trajectory-like language, 2 showed orbit signals, 0 showed milestone signals, 0 showed recovery signals, and 0 showed numeric orbit-like language.

## Launch Matches

| Launch | Match status | Score | Match URL | Alias | Signals |
|---|---|---:|---|---|---|
| A Sky Full of SARs | deterministic | 120 | https://rocketlabcorp.com/missions/launches/a-sky-full-of-sars | a sky full of sars | orbit=3, milestone=0, recovery=0, numeric=0 |
| Daughter Of The Stars (LEO-PNT Pathfinder A) | deterministic | 120 | https://rocketlabcorp.com/missions/launches/daughter-of-the-stars | daughter of the stars | orbit=1, milestone=0, recovery=0, numeric=0 |
| VICTUS HAZE Puma | ambiguous | 76 | https://rocketlabcorp.com/missions/launches/victus-haze | victus haze puma | orbit=0, milestone=0, recovery=0, numeric=0 |
| StriX Launch 9 | none | 0 | — | — | — |

