# 2026-04-08 AR Trajectory Ingest Admission Registry

Last updated: 2026-04-08

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

## Purpose

This registry records whether a proposed AR trajectory ingest is allowed to move into implementation work.

Machine-readable companion:

- `docs/specs/ar-trajectory-ingest-admission-registry-v1.json`

Every new ingest or materially expanded source adapter must:

1. use `docs/templates/ar-trajectory-ingest-admission-review-template.md`
2. answer availability, joinability, and usable-coverage in writing
3. update this registry with a `pass`, `defer`, `reject`, or `spike` decision

If any of the three admission questions is `no`, the default outcome is `defer` or `reject`, not implementation.

## Decision Scale

- `pass`: source is allowed into implementation for the stated use only
- `defer`: source is real, but not ready for roadmap implementation yet
- `reject`: do not depend on this source for the stated use
- `spike`: limited investigation allowed, but not production ingest build-out

## Registry

| Source family | Intended use | Decision | Availability | Joinability | Usable coverage | Allowed scope | Review doc | Notes / next action |
|---|---|---|---|---|---|---|---|---|
| `LL2` launch identity and `rocket.configuration.id` | launch identity, launch windows, pad coordinates, `rocket_family` repair path | `pass` | `yes` | `yes` | `yes` | keep using for identity, pad, and vehicle-family linkage | — | Current repo already uses this source; Phase 2 work now backfills `rocket_family` from `ll2_rocket_configs.family`. |
| SpaceX official mission infographic assets | recovery authority, corroboration only | `pass` | `yes` | `yes` | `yes` | keep the existing SpaceX infographic adapter limited to infographic corroboration and landing hints | `docs/2026-04-08-ar-trajectory-ingest-admission-spacex-official-infographics.md` | Existing repo adapter already writes mission bundles and `mission_infographic` constraints. Do not promote this source into direct ascent-truth authority. |
| Blue Origin official mission pages | corroboration only | `defer` | `yes` | `partial` | `no` | continue URL discovery and timeline context only | `docs/2026-04-08-ar-trajectory-ingest-admission-blue-origin-mission-pages.md` | Existing mission-page discovery stays allowed, but `npm run audit:blue-origin:fields` now shows `45` launches scanned, `11` healthy official pages fetched, and `0` launches with numeric mission facts or authority bundles, so no trajectory-truth adapter should be built. |
| Rocket Lab mission and updates pages | direction authority, milestone authority, corroboration only | `defer` | `partial` | `partial` | `no` | source sample, join audit, and field audit only | `docs/2026-04-08-ar-trajectory-ingest-admission-rocket-lab-mission-pages.md` | Derived seeds exist, `npm run audit:rocket-lab:sources` keeps source-sample evidence current, `npm run audit:rocket-lab:joins` proves bounded joinability remains only partial, and `npm run audit:rocket-lab:fields` now shows matched-page value coverage is still insufficient. |
| FAA / NAVCEN hazard geometry | corroboration only, launch-window ops context | `pass` | `yes` | `yes` | `yes` | corroboration, hazard context, schedule support | — | Allowed only as corroboration and ops context. Not allowed as ascent-truth source. |
| public FAA live or geospatial surfaces as consumer ascent truth | live trajectory truth | `reject` | `no` | `no` | `no` | none | — | Do not build product logic on the assumption that public FAA surfaces expose launch-ready live ascent trajectories for our launches. |
| provider or agency visibility maps and interactive visibility assets | visibility authority | `defer` | `partial` | `partial` | `partial` | targeted audits only | — | Keep as opportunistic. Only promote to `pass` after per-source reviews show stable publication and useful future-launch coverage. |
| mission-specific special-event priors such as relights, venting, tracer-style events | event-specific branch or visibility enrichment | `defer` | `partial` | `partial` | `no` | none beyond research notes | — | Do not scaffold production ingest until coverage across real future launches becomes useful. |
| OCR-first infographic extraction without stronger source coverage | direction or milestone authority | `defer` | `partial` | `partial` | `partial` | only after official-doc path is healthy | — | The roadmap explicitly avoids OCR-first investment before parser operations and official-doc coverage are strong. |
| operator-provided or licensed partner live feeds | live mission state | `defer` | `unknown` | `unknown` | `unknown` | contract and integration design only | — | If this becomes available later, it must stay a separately labeled `partner_live` path rather than silently replacing prediction. |

## Current Required Follow-ups

- Add more provider-level reviews before any new mission-document adapter is started.
- Add review docs for any source family that moves from `defer` to `pass`.
- Keep this registry aligned with `docs/2026-04-08-ar-trajectory-v3-data-and-roadmap-plan.md`.

## Evidence Basis

- `docs/2026-04-08-ar-trajectory-v3-data-and-roadmap-plan.md`
- `docs/2026-04-07-ar-trajectory-current-system-spec.md`
- `docs/ar-trajectory-three-surface-best-in-class-validation-plan-2026-04-01.md`
- `docs/2026-04-07-jep-best-in-class-migration-plan.md`
