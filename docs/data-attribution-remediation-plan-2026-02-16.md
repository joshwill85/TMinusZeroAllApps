# Data Attribution Remediation Plan (2026-02-16)

Generated at: 2026-02-16T14:11:53.575Z

## Objectives
- Remove attribution gaps for active feature-specific data sources.
- Ensure legal/disclosure copy tracks real ingestion and display behavior.
- Preserve explicit distinctions between active and dormant integrations.
- Keep `unknown` / `unclear` requirement follow-up non-blocking and tracked internally.

## Prioritized Actions
| Priority | Source | Gap | Action | Current claim surfaces |
|---|---|---|---|---|
| P1 | SpaceX launch website content API | unclear | Keep linked source labeling in-product and track SpaceX rights clarification in the internal risk register (non-blocking). | app/legal/data/page.tsx<br/>app/launches/[id]/page.tsx |

## Implementation Checklist
- [x] Centralize source registry and claim inventory in code.
- [x] Generate machine-readable audit artifacts (JSON + CSV).
- [x] Update legal data page with active feature-specific sources.
- [x] Align FAQ/footer copy with primary-source wording (avoid LL2-only overstatement).
- [x] Keep detailed requirement notes and unknown/unclear handling in internal docs/artifacts (not public legal copy).
- [ ] Maintain the internal risk register for sources marked `unknown` / `unclear`.

## Internal Risk Register
| Source key | Requirement | Compliance | Follow-up action | Owner | Next review | Disposition |
|---|---|---|---|---|---|---|
| spacex_website_content | unknown | unclear | Keep linked source labeling in-product and track SpaceX rights clarification in the internal risk register (non-blocking). | internal-compliance-owner | next audit cycle | non_blocking_follow_up |

## Non-Blocking Enforcement Policy
- Unknown/unclear items are tracked for follow-up and do not block releases by default.
- Any blocking gate must be introduced via an explicit, separate policy decision.

## Roll-Forward Guardrail
- Run `npm run audit:data-attribution` on any PR that changes ingestion sources or attribution copy.
