# Command Matrix

Date: `2026-04-10`

This matrix reflects the commands that are actually present in `package.json`, workspace `package.json` files, and GitHub Actions.

## Root Commands

| Task | Command | Scope | Notes |
| --- | --- | --- | --- |
| Toolchain doctor | `npm run doctor` | repo | enforced in CI and expected before validation |
| Boundary check | `npm run check:three-platform:boundaries` | packages + mobile + browser Supabase guard | fast architectural guard |
| Web dev | `npm run dev` | `@tminuszero/web` | root wrapper |
| Mobile dev | `npm run dev:mobile` | `@tminuszero/mobile` | root wrapper |
| Web build | `npm run build` | `@tminuszero/web` via turbo | CI-gating |
| Web lint | `npm run lint` | `@tminuszero/web` via turbo | CI-gating |
| Workspace lint | `npm run lint:workspaces` | all turbo tasks | broader than merge gate |
| Web type-check | `npm run type-check:ci` | `@tminuszero/web` via turbo | CI-gating |
| Mobile type-check | `npm run type-check:mobile` | mobile only | CI-gating |
| Combined quick check | `npm run check` | web-focused | lint + type-check + public-cache guard |
| Format | `npm run format` | repo | Prettier over whole repo |

## Test / Guard Commands

| Task | Command | Scope | Gate status |
| --- | --- | --- | --- |
| Contracts smoke | `npm run test:v1-contracts` | shared API contract layer | CI-gating |
| Mobile query guard | `npm run test:mobile-query-guard` | mobile/shared query layer | CI-gating |
| Mobile security guard | `npm run test:mobile-security-guard` | mobile auth/security | CI-gating |
| Shared domain smoke | `npm run test:shared-domain` | packages/domain and consumers | CI-gating |
| Web closeout guard | `npm run test:phase3-web-guard` | web migration guard | CI-gating |
| Web regression smoke | `npm run test:web-regression` | web | CI-gating |
| Billing regression smoke | `npm run test:billing-regression` | billing | CI-gating |
| General smoke | `npm run test:smoke` | mixed repo logic | CI-gating |
| Public cache guard | `npm run test:public-cache` | web cache behavior | local/repo check |
| Review findings guard | `npm run test:review-findings-guard` | review hygiene | local |
| Admin surface guard | `npm run test:admin-surface-guard` | admin surface boundaries | local |
| Hot-path guard | `npm run test:three-platform:hot-path` | read-path behavior | local / acceptance support |
| Rate-limit smoke | `npm run test:rate-limit-smoke` | rate limiting | local |

## Mobile Commands

| Task | Command | Scope | Notes |
| --- | --- | --- | --- |
| iOS run | `npm run ios` | mobile | Expo run |
| Android run | `npm run android` | mobile | Expo run |
| Prebuild | `npm run mobile:prebuild` | mobile | Expo prebuild wrapper |
| Detox build iOS | `npm run mobile:e2e:build:ios` | mobile | CI uses this |
| Detox test iOS | `npm run mobile:e2e:test:ios` | mobile | local / CI |
| Detox test iOS with artifacts | `npm run mobile:e2e:test:ios:artifacts` | mobile | CI uses this |
| Detox build Android | `npm run mobile:e2e:build:android` | mobile | local / CI |
| Detox acceptance Android | `npm run mobile:e2e:acceptance:android` | mobile | CI uses this |
| Detox acceptance iOS | `npm run mobile:e2e:acceptance:ios` | mobile | CI uses this |

## Acceptance / Release Validation Commands

| Task | Command | Scope | Notes |
| --- | --- | --- | --- |
| Acceptance preflight | `npm run acceptance:preflight` | repo-owned checks | dedicated CI workflow |
| Local acceptance | `npm run acceptance:local` | broader local smoke | used for baseline and local proof |
| Baseline capture | `npm run baseline:three-platform` | baseline evidence | CI artifact producer |
| Local seed | `npm run seed:three-platform:local` | local acceptance setup | support command |
| Prod readiness | `npm run check:prod` | ops/readiness | not CI-gating |

## Data / Audit / Backfill Commands

The repo has a large audit-and-backfill surface under `scripts/`. These are real commands, but they are not general merge gates.

Representative commands:
- `npm run audit:artemis-sources`
- `npm run audit:data-attribution`
- `npm run audit:faq`
- `npm run audit:blue-origin`
- `npm run backfill:usaspending:hubs`
- `npm run trajectory:coverage`
- `npm run trajectory:replay-bench`
- `npm run trajectory:kpi:check`
- `npm run analyze:io-top10`

Observation:
- `scripts/` is operationally important, but the entrypoint surface is larger than the routinely used command surface.

## Commands Not Formalized As Root Scripts

- Supabase CLI commands are documented in docs, but not standardized as root npm scripts.
- There is no single root codegen/types command for Supabase in `package.json`.
- Deno is used directly in `jep-black-marble-batch.yml`, not through a root wrapper script.

## Merge-Gating Reality

If the goal is “what actually gates merges,” the effective minimal list is:

1. `npm run doctor`
2. `npm ci`
3. `npm run check:three-platform:boundaries`
4. `npm run lint`
5. `npm run lint --workspace @tminuszero/mobile`
6. `npm run build`
7. `npm run type-check:ci`
8. `npm run type-check:mobile`
9. `npm run test:v1-contracts`
10. `npm run test:mobile-query-guard`
11. `npm run test:mobile-security-guard`
12. `npm run test:shared-domain`
13. `npm run test:phase3-web-guard`
14. `npm run test:web-regression`
15. `npm run test:billing-regression`
16. `npm run test:smoke`

