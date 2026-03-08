# Artemis QA Scan Report

Generated at: 2026-02-19T03:17:53.356Z  
Environment target: prod-readonly  
Window: last 30 day(s)  
Status: **PASS**

## Summary
- Total findings: **2**
- P0: **0**
- P1: **0**
- P2: **2**
- Exact-key duplicate findings: **0**
- Semantic duplicate findings: **1**
- UI projection duplicate findings: **1**

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
| P2 | db | artemis_timeline_events | semantic_content_duplicate | Found 2 semantic duplicate timeline event group(s) among non-superseded rows. | Ensure timeline supersession links are applied before publishing event feed rows. |
| P2 | server | /artemis?view=timeline | ui_projection_duplicate | Timeline projection collapsed 3 duplicate row(s) before render. | Keep projection dedupe and address repeated timeline refresh records in upstream event ingestion. |

## Notes
- UI checks use strict identity keys that mirror dashboard projection dedupe behavior; pair with manual screenshot review for visual validation.
