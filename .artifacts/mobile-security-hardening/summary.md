# Three-Platform Acceptance Preflight

Generated: 2026-03-09T21:02:00.881Z

Out dir: `.artifacts/mobile-security-hardening`

| step | status | duration ms | note |
| --- | --- | ---: | --- |
| Mobile E2E acceptance | skipped | 0 | Run separately with `npm run mobile:e2e:acceptance` or the Mobile E2E workflow. |
| Toolchain doctor | passed | 127 |  |
| Three-platform boundary check | passed | 101 |  |
| Shared domain smoke | passed | 527 |  |
| Phase 3 web closeout guard | passed | 524 |  |
| Web regression smoke | passed | 317 |  |
| Billing regression smoke | passed | 262 |  |
| V1 contracts | passed | 353 |  |
| Mobile query guard | passed | 383 |  |
| Mobile security guard | passed | 175 |  |
| Mobile type-check | passed | 2879 |  |
| Mobile lint | passed | 1489 |  |
| Web lint | passed | 8737 |  |
| Smoke tests | passed | 923 |  |
| Web build | passed | 73521 |  |
| Web type-check after build | passed | 28328 |  |
| Three-platform baseline capture | passed | 2357 |  |
| Billing evidence export | passed | 265 |  |

## Artifact Paths

- Baseline: `.artifacts/mobile-security-hardening/baseline`
- Billing evidence: `.artifacts/mobile-security-hardening/billing/billing-evidence.json`
- Billing regression: `.artifacts/mobile-security-hardening/billing/billing-regression.json`

## Mobile E2E

- Mobile Detox was not executed here. Use `npm run mobile:e2e:acceptance` or the `Mobile E2E` workflow for simulator/emulator artifacts.
