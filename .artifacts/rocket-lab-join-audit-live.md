# Rocket Lab Join Audit

- generatedAt: 2026-04-09T03:11:05.590Z
- mode: live
- fixtureJsonPath: —
- sourceAuditJsonPath: —
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- launchesScanned=26
- candidatePagesScanned=114
- launchesWithDeterministicMatch=4
- launchesWithProbableMatch=9
- launchesWithAmbiguousMatch=1
- launchesWithoutMatch=12
- launchesWithMatchedTrajectorySignals=13
- launchesWithMatchedOrbitSignals=13
- launchesWithMatchedMilestoneSignals=4
- launchesWithMatchedRecoverySignals=0
- launchesWithMatchedNumericOrbitSignals=5

## Reasons

- Candidate availability is yes: 114 Rocket Lab mission/update pages were available for join scoring against 26 bounded inventory launches.
- Joinability is partial: 4/26 launches matched deterministically, 9/26 matched probably, 1/26 remained ambiguous, and 12/26 had no qualifying match.
- Usable coverage stays "no" because this audit only proves candidate-page joins; it does not prove that enough matched launches expose direction, milestone, recovery, or visibility values at rollout-grade coverage.
- Among launches with fetched matched pages, 13 showed trajectory-like language, 13 showed orbit signals, 4 showed milestone signals, 0 showed recovery signals, and 5 showed numeric orbit-like language.

## Launch Matches

| Launch | Match status | Score | Match URL | Alias | Signals |
|---|---|---:|---|---|---|
| Eight Days A Week (StriX Launch 8) | deterministic | 120 | https://rocketlabcorp.com/missions/launches/eight-days-a-week | eight days a week | orbit=3, milestone=0, recovery=0, numeric=1 |
| Daughter Of The Stars (LEO-PNT Pathfinder A) | deterministic | 120 | https://rocketlabcorp.com/missions/launches/daughter-of-the-stars | daughter of the stars | orbit=3, milestone=0, recovery=0, numeric=1 |
| Kakushin Rising (JAXA Rideshare) | deterministic | 120 | https://rocketlabcorp.com/missions/launches/kakushin-rising | kakushin rising | orbit=1, milestone=0, recovery=0, numeric=0 |
| StriX Launch 9 | none | 0 | — | — | — |
| LOXSAT 1 | probable | 76 | https://rocketlabcorp.com/missions/launches/loxsat | loxsat 1 | orbit=3, milestone=4, recovery=0, numeric=0 |
| VICTUS HAZE Puma | ambiguous | 76 | https://rocketlabcorp.com/missions/launches/victus-haze | victus haze puma | — |
| StriX Launch 10 | none | 0 | — | — | — |
| Aspera | deterministic | 120 | https://rocketlabcorp.com/missions/launches/aspera | aspera | orbit=1, milestone=0, recovery=0, numeric=0 |
| StriX Launch 11 | none | 0 | — | — | — |
| StriX Launch 12 | none | 0 | — | — | — |
| StriX Launch 13 | none | 0 | — | — | — |
| Maiden Flight | none | 0 | — | — | — |
| BlackSky Gen-3 6 | none | 0 | — | — | — |
| BlackSky Gen-3 7 | none | 0 | — | — | — |
| BlackSky Gen-3 8 | none | 0 | — | — | — |
| BlackSky Gen-3 9 | none | 0 | — | — | — |
| iQPS Launch 7 | probable | 76 | https://rocketlabcorp.com/missions/launches/iqps | iqps launch 7 | orbit=3, milestone=0, recovery=0, numeric=0 |
| iQPS Launch 8 | probable | 76 | https://rocketlabcorp.com/missions/launches/iqps | iqps launch 8 | orbit=3, milestone=0, recovery=0, numeric=0 |
| iQPS Launch 9 | probable | 76 | https://rocketlabcorp.com/missions/launches/iqps | iqps launch 9 | orbit=3, milestone=0, recovery=0, numeric=0 |
| iQPS Launch 10 | probable | 76 | https://rocketlabcorp.com/missions/launches/iqps | iqps launch 10 | orbit=3, milestone=0, recovery=0, numeric=0 |
| iQPS Launch 11 | probable | 76 | https://rocketlabcorp.com/missions/launches/iqps | iqps launch 11 | orbit=3, milestone=0, recovery=0, numeric=0 |
| HASTE \| Leidos-3 | probable | 76 | https://rocketlabcorp.com/missions/launches/haste | haste leidos-3 | orbit=3, milestone=1, recovery=0, numeric=1 |
| HASTE \| Leidos-4 | probable | 76 | https://rocketlabcorp.com/missions/launches/haste | haste leidos-4 | orbit=3, milestone=1, recovery=0, numeric=1 |
| HASTE \| Leidos-5 | probable | 76 | https://rocketlabcorp.com/missions/launches/haste | haste leidos-5 | orbit=3, milestone=1, recovery=0, numeric=1 |
| BlackSky Gen-3 5 | none | 0 | — | — | — |
| 6x HawkEye 360 | none | 0 | — | — | — |

