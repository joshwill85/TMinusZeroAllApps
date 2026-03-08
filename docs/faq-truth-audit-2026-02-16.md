# FAQ Truth Audit (2026-02-16)

Generated at: 2026-02-16T14:57:46.754Z
Baseline verification date in registry: 2026-02-16

## Scope
- Canonical FAQ registry truth metadata.
- Surface coverage checks against required topics.
- Blocking checks for high-risk unverified/contradicted claims.

## Summary
- Total entries: **39**

### Verification Status
- verified: **39**

### Claim Classes
- code_behavior: **19**
- policy: **6**
- static_fact: **11**
- time_sensitive: **3**

### Risk Distribution
- high: **8**
- low: **15**
- medium: **16**

## Coverage Matrix
| Surface | Entries | Required topics | Missing topics |
|---|---:|---:|---|
| docs-faq | 10 | 7 | none |
| home | 6 | 4 | none |
| artemis-program | 3 | 3 | none |
| artemis-mission | 4 | 4 | none |
| artemis-workbench-artemis-i | 2 | 2 | none |
| artemis-workbench-artemis-iii | 2 | 2 | none |
| artemis-i-page | 3 | 3 | none |
| artemis-iii-page | 3 | 3 | none |
| starship-program | 3 | 3 | none |
| starship-flight | 3 | 3 | none |

## Findings
### Blocking: High-risk unverified/contradicted
- none

### Blocking: Surface coverage gaps
- none

### Integrity: Duplicate IDs
- none

### Integrity: Missing evidence references
- none

### Freshness: Stale time-sensitive entries (>45 days)
- none

## Enforcement Policy
- Block when any high-risk claim is marked unverified or contradicted.
- Block when required coverage topics are missing for a declared surface.
- Warn on stale time-sensitive entries and missing evidence references.

## Assumptions
- FAQ answers avoid hard launch-date promises and defer to live mission pages for changing timelines.
- Industry-standard FAQ quality is treated as a combination of factual traceability, surface coverage, and structured-data readiness.
