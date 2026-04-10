# Blue Origin Trajectory Admission Report

- generatedAt: 2026-04-08T23:45:59.630Z
- sourceAuditGeneratedAt: 2026-04-08T12:00:00.000Z
- auditJsonPath: scripts/fixtures/blue-origin/blue-origin-audit-sample.json
- decision: defer
- availability: yes
- joinability: partial
- usableCoverage: no

## Summary

- launchesScanned=3
- officialSourceCoverage=2/3 (66.7%)
- healthyOfficialSourceCoverage=1/3 (33.3%)
- missionSummaryCoverage=1/3 (33.3%)
- failureReasonCoverage=0/3 (0.0%)
- brokenOfficialSources=1/3
- officialSourceErrors=0/3

## Reasons

- Official source pages are present for 2/3 audited launches (66.7%).
- Joinability is only partial because official source pages are missing or unhealthy for part of the audited launch set (1/3 healthy launches).
- Usable coverage stays "no" for trajectory-truth admission because the current audit only proves source-page and mission-summary presence; it does not prove direction, milestone, recovery, or visibility fields at useful coverage.
- Official source health is not clean yet: 1 launches show broken links and 0 launches show fetch/check errors.

## Top Anomalies

| Anomaly | Count |
|---|---:|
| official_source_pages_include_broken_links | 1 |
| official_sources_present_but_no_clickable_urls | 1 |

