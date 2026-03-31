# AR Trajectory Truth-First Overhaul Plan

Date: 2026-03-26

## Platform Matrix

- Web: included.
- iOS: included.
- Android: not included.
- Admin/internal impact: yes.
- Shared API/backend impact: yes.
- Customer-facing: yes.

## Scope

- Fix SupGP discovery so launch-specific CelesTrak `FILE=` datasets are actually ingested.
- Make shared trajectory products surface truthful guidance, recovery, and source-coverage semantics.
- Upgrade the web AR runtime to use multi-track rendering and remove prelaunch milestones at T0.
- Upgrade the iOS runtime to stop full scene rebuilds on live clock ticks, require a usable full-accuracy fix, and restore orientation safely.

## Execution Order

1. Shared data and ETL:
   - Add `celestrak-supgp-sync`.
   - Route SupGP ownership to the dedicated sync/ingest jobs.
   - Expose `recoverySemantics` and `sourceCoverage`.
2. Product/generator:
   - Preserve stage-aware topology and mission classification truth.
3. Web runtime:
   - Multi-track overlay rendering.
   - Semantics-driven confidence/quality labels.
   - Collapsible prelaunch cues removed at T0.
4. iOS runtime:
   - Incremental RealityKit updates.
   - Full-accuracy location gate.
   - Safe orientation unlock and honest telemetry defaults.

## Verification Set

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:smoke`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Notes

- Exactness discovery stays out of the blocking implementation path.
- CelesTrak `launch_file` data can improve upper-stage modeling, but it does not by itself justify exact ascent or booster-descent claims.
