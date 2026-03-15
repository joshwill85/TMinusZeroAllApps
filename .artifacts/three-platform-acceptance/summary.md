# Three-Platform Acceptance Preflight

Generated: 2026-03-09T03:04:33.908Z

Out dir: `.artifacts/three-platform-acceptance`

| step | status | duration ms | note |
| --- | --- | ---: | --- |
| Mobile E2E acceptance | skipped | 0 | Run separately with `npm run mobile:e2e:acceptance` or the Mobile E2E workflow. |
| Toolchain doctor | passed | 92 |  |
| Three-platform boundary check | passed | 107 |  |
| Shared domain smoke | passed | 502 |  |
| Phase 3 web closeout guard | passed | 451 |  |
| Web regression smoke | passed | 307 |  |
| Billing regression smoke | passed | 265 |  |
| V1 contracts | passed | 348 |  |
| Mobile query guard | passed | 411 |  |
| Mobile type-check | passed | 3229 |  |
| Mobile lint | passed | 1681 |  |
| Web lint | passed | 9207 |  |
| Smoke tests | passed | 1051 |  |
| Web build | passed | 67212 |  |
| Web type-check after build | passed | 11931 |  |
| Three-platform baseline capture | passed | 1835 |  |
| Billing evidence export | passed | 203 |  |

## Artifact Paths

- Baseline: `.artifacts/three-platform-acceptance/baseline`
- Billing evidence: `.artifacts/three-platform-acceptance/billing/billing-evidence.json`
- Billing regression: `.artifacts/three-platform-acceptance/billing/billing-regression.json`

## Mobile E2E

- Mobile Detox was not executed here. Use `npm run mobile:e2e:acceptance` or the `Mobile E2E` workflow for simulator/emulator artifacts.
