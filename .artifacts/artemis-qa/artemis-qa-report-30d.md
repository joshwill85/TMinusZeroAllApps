# Artemis QA Scan Report

Generated at: 2026-02-19T03:22:22.466Z  
Environment target: prod-readonly  
Window: last 30 day(s)  
Status: **PASS**

## Summary
- Total findings: **0**
- P0: **0**
- P1: **0**
- P2: **0**
- Exact-key duplicate findings: **0**
- Semantic duplicate findings: **0**
- UI projection duplicate findings: **0**

## Scanned Row Counts
```json
{
  "artemis_content_items": 222,
  "artemis_budget_lines": 186,
  "artemis_procurement_awards": 318,
  "artemis_timeline_events": 62,
  "artemis_source_documents": 1403,
  "ui_intel_items": 222,
  "ui_budget_rows": 186,
  "ui_procurement_rows": 318,
  "ui_timeline_rows": 59
}
```

## Ranked Findings
| Severity | Layer | Surface | Category | Summary | Recommendation |
|---|---|---|---|---|---|
| n/a | n/a | n/a | n/a | No duplicate findings detected. | n/a |

## Notes
- UI checks use strict identity keys that mirror dashboard projection dedupe behavior; pair with manual screenshot review for visual validation.
