# Three-Platform Acceptance Preflight

Generated: 2026-03-10T01:21:51.317Z

Out dir: `.artifacts/local-acceptance-dryrun/preflight`

| step | status | duration ms | note |
| --- | --- | ---: | --- |
| Mobile E2E acceptance | skipped | 0 | Run separately with `npm run mobile:e2e:acceptance` or the Mobile E2E workflow. |
| Toolchain doctor | passed | 106 |  |
| Three-platform boundary check | passed | 117 |  |
| Shared domain smoke | passed | 537 |  |
| Phase 3 web closeout guard | passed | 445 |  |
| Three-platform hot path guard | passed | 226 |  |
| Web regression smoke | passed | 422 |  |
| Billing regression smoke | passed | 321 |  |
| V1 contracts | passed | 399 |  |
| Mobile query guard | passed | 387 |  |
| Mobile security guard | passed | 235 |  |
| Mobile type-check | passed | 2355 |  |
| Mobile lint | passed | 1143 |  |
| Web lint | passed | 2414 |  |
| Smoke tests | passed | 737 |  |
| Web build | passed | 46790 |  |
| Web type-check after build | passed | 5291 |  |
| Three-platform baseline capture | passed | 1842 |  |
| Billing evidence export | passed | 381 |  |

## Artifact Paths

- Baseline: `.artifacts/local-acceptance-dryrun/preflight/baseline`
- Billing evidence: `.artifacts/local-acceptance-dryrun/preflight/billing/billing-evidence.json`
- Billing regression: `.artifacts/local-acceptance-dryrun/preflight/billing/billing-regression.json`

## Mobile E2E

- Mobile Detox was not executed here. Use `npm run mobile:e2e:acceptance` or the `Mobile E2E` workflow for simulator/emulator artifacts.
