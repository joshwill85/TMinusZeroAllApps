# Rocket Lab Source Audit

- generatedAt: 2026-04-08T23:45:59.684Z
- mode: fixture
- fixtureJsonPath: scripts/fixtures/rocket-lab/rocket-lab-source-audit-sample.json
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- seedPagesAvailable=2/2
- candidatePages=2
- candidatePdfs=2
- sampledPagesAvailable=2/2
- launchSpecificSlugs=2
- pagesWithTrajectorySignals=2
- pagesWithOrbitSignals=1
- pagesWithMilestoneSignals=1
- pagesWithRecoverySignals=1
- pagesWithNumericOrbitSignals=1

## Reasons

- Availability is yes: 2/2 seed pages loaded and exposed 2 same-host page candidates plus 2 same-host PDF candidates.
- Joinability is partial because the sampled docs expose stable first-party slugs, but there is still no deterministic proof that those docs map cleanly onto T-Minus Zero launch identity for the current launch inventory.
- Usable coverage stays "no" because this source-sample audit does not yet prove direction, milestone, recovery, or visibility values across real T-Minus Zero launches.
- Trajectory-related language appeared on 2/2 sampled pages, with orbit signals on 1, milestone signals on 1, recovery signals on 1, and numeric orbit-like language on 1.

## Seed Pages

| URL | Status | Page candidates | PDF candidates | Error |
|---|---:|---:|---:|---|
| https://rocketlabcorp.com/missions/ | 200 | 1 | 1 | — |
| https://rocketlabcorp.com/updates/ | 200 | 1 | 1 | — |

## Sampled Pages

| URL | Status | Slug | Orbit | Milestone | Recovery | Numeric orbit | Keywords |
|---|---:|---|---:|---:|---:|---:|---|
| https://rocketlabcorp.com/missions/the-moon-god-awakens/ | 200 | the-moon-god-awakens | 2 | 2 | 0 | 1 | orbit, low earth orbit, stage separation, payload deployment |
| https://rocketlabcorp.com/updates/electron-recovery-update/ | 200 | electron-recovery-update | 0 | 0 | 3 | 0 | recovery, splashdown, parachute |

## Candidate Pages

- https://rocketlabcorp.com/missions/the-moon-god-awakens
- https://rocketlabcorp.com/updates/electron-recovery-update

## Candidate PDFs

- https://rocketlabcorp.com/assets/Uploads/The-Moon-God-Awakens-Press-Kit.pdf
- https://rocketlabcorp.com/assets/Uploads/Electron-Recovery-Update.pdf

