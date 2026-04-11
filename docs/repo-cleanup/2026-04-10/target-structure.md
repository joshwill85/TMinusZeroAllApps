# Target Structure Proposal

Date: `2026-04-10`

## Design Goal

Preserve the repo's real strengths:
- one web app
- one mobile app
- a real shared package layer
- Supabase at the repo root

Do not force churn just for aesthetics.

## Recommended Target Shape

```text
apps/
  web/                  # deployable Next.js app only
  mobile/               # deployable Expo / React Native app only

packages/
  api-client/
  contracts/
  design-tokens/
  domain/
  launch-animations/
  launch-detail-ui/
  navigation/
  query/
  ws45/                 # proposed home for current shared/ws45* modules

supabase/
  migrations/
  functions/
  templates/
  snippets/
  seed.sql
  README.md             # proposed future inventory / operator notes

tooling/
  scripts/
    guards/
    audits/
    backfills/
    ops/
    fixtures/

docs/
  architecture/
  runbooks/
  adr/
  repo-cleanup/
  archive/
    2026/
```

## What Should Stay As-Is

- `apps/web`
- `apps/mobile`
- `packages/*` as the shared layer
- `supabase/` at repo root
- root npm workspace model
- Turborepo

## What Should Change

### 1. Eliminate `shared/`

Current:
- `shared/ws45LiveBoard.ts`
- `shared/ws45Parser.ts`
- `shared/ws45PlanningParser.ts`

Target:
- move into a package, not a root escape hatch
- recommended home: `packages/ws45/`

Why:
- these files are shared runtime logic
- they are imported by both `apps/web` and `supabase/functions`
- they belong in the package graph, not beside it

### 2. Move root operational residue out of the root

Current root is carrying:
- patch logs
- rollout guides
- session reports
- temp scripts

Target:
- root stays minimal
- historical docs go to `docs/archive/2026/`
- live runbooks go to `docs/runbooks/`
- one-off script tools move under `tooling/scripts/`

### 3. Reclassify `scripts/`

Current:
- one large flat directory mixing guards, audits, backfills, loaders, ops tools, and temp helpers

Target:
- `tooling/scripts/guards`
- `tooling/scripts/audits`
- `tooling/scripts/backfills`
- `tooling/scripts/ops`
- `tooling/scripts/fixtures`

Important:
- this is a medium-risk change because many scripts import app internals
- structure should be normalized only after low-risk junk/docs cleanup

### 4. Split docs into active vs historical

Current:
- `docs/` root mixes active architecture, dated plans, audits, evidence, checklists, and historical one-offs

Target:
- `docs/architecture/`
- `docs/runbooks/`
- `docs/adr/`
- `docs/archive/2026/`

Rules:
- active source-of-truth docs stay out of archive
- historical decision logs, one-off rollout plans, and superseded audits move to archive
- evidence artifacts should not live in both `.artifacts/` and `docs/evidence/`

## Boundary Rules To Codify

- `apps/*` may depend on `packages/*`
- `packages/*` must not depend on `apps/*`
- runtime shared logic must live in `packages/*`, not `shared/`
- `scripts/` must not import UI modules directly
- root-level files should be allowlisted, not ad hoc
- generated artifacts belong in ignored output directories, not tracked source trees

## Proposed Mapping From Current To Target

| Current path | Proposed home | Why |
| --- | --- | --- |
| `shared/ws45LiveBoard.ts` | `packages/ws45/src/liveBoard.ts` | shared runtime logic |
| `shared/ws45Parser.ts` | `packages/ws45/src/parser.ts` | shared runtime logic |
| `shared/ws45PlanningParser.ts` | `packages/ws45/src/planningParser.ts` | shared runtime logic |
| `scripts/fixtures/*` | `tooling/scripts/fixtures/*` | fixtures belong with tooling |
| `scripts/*guard*` | `tooling/scripts/guards/*` | easier to reason about CI checks |
| `scripts/*audit*` | `tooling/scripts/audits/*` | reduce flat-script sprawl |
| `scripts/*backfill*` | `tooling/scripts/backfills/*` | separate repo maintenance from validation |
| root session/guide docs | `docs/archive/2026/` | historical only |
| active rollout/runbooks | `docs/runbooks/` or `docs/architecture/` | make source-of-truth obvious |

## What Not To Do

- do not introduce Nx
- do not introduce a new package manager
- do not rename `apps/web` or `apps/mobile`
- do not move `supabase/` out of the root
- do not create a generic root `/archive` for source code
- do not collapse web and mobile UI trees just to look “more DRY”

## Structural Simplifications Worth Doing

Worth doing:
- remove root junk
- move `shared/ws45*` into `packages/`
- archive stale root docs
- split `docs/` into active vs archived
- classify scripts by purpose
- keep root minimal and intentional

Not worth doing in the first pass:
- broad package renames
- big-bang directory renormalization
- aggressive UI code sharing across web/mobile
- migration rewrites hidden inside repo cleanup

