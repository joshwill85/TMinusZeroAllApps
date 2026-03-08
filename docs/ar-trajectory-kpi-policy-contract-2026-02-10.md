# AR Trajectory KPI Policy Contract

Date: 2026-02-10  
Policy file: `docs/specs/ar-trajectory-kpi-policy-v1.json`
Exceptions file: `docs/specs/ar-trajectory-kpi-exceptions-v1.json`

## Purpose

Define versioned release-readiness thresholds for AR trajectory performance and generate release-over-release benchmark evidence artifacts.

## Current policy scope (`v1`)

- Replay quality gate thresholds (overall + worst-case error/drift/slope).
- Comparative regression limits (current replay report vs baseline replay report).
- Telemetry KPI thresholds (lock usability/stability, <=5s lock rate, frame-budget rates, fallback rate, precision coverage).

## Baseline artifact

- Baseline replay report: `scripts/fixtures/ar-trajectory-replay-baseline-v1.json`
- Source fixture: `scripts/fixtures/ar-trajectory-replay-fixture.json`

## Commands

1. Generate replay report:
```bash
npm run trajectory:replay-bench -- --output=.artifacts/ar-trajectory-replay-bench.json
```

2. Evaluate KPI policy (CI-safe, replay/comparative only):
```bash
npm run trajectory:kpi:check -- --skip-db --exceptions=docs/specs/ar-trajectory-kpi-exceptions-v1.json --report=.artifacts/ar-trajectory-replay-bench.json --output=.artifacts/ar-trajectory-kpi-eval.json --compare-output=.artifacts/ar-trajectory-benchmark-compare.json --compare-markdown=.artifacts/ar-trajectory-benchmark-compare.md
```

3. Evaluate family replay policy (representative case thresholds):
```bash
npm run trajectory:replay:family-check -- --report=.artifacts/ar-trajectory-replay-bench.json --output=.artifacts/ar-trajectory-family-replay-check.json --markdown=.artifacts/ar-trajectory-family-replay-check.md
```

4. Evaluate KPI policy with telemetry checks (local/admin env):
```bash
npm run trajectory:kpi:check -- --exceptions=docs/specs/ar-trajectory-kpi-exceptions-v1.json --report=.artifacts/ar-trajectory-replay-bench.json
```

5. Optional non-blocking telemetry run:
```bash
npm run trajectory:kpi:check -- --exceptions=docs/specs/ar-trajectory-kpi-exceptions-v1.json --report=.artifacts/ar-trajectory-replay-bench.json --warn-only
```

6. Build trend-history artifact (release-over-release):
```bash
npm run trajectory:kpi:history -- --kpi=.artifacts/ar-trajectory-kpi-eval.json --compare=.artifacts/ar-trajectory-benchmark-compare.json --history-in=scripts/fixtures/ar-trajectory-kpi-history-v1.json --history-out=.artifacts/ar-trajectory-kpi-history.json --markdown=.artifacts/ar-trajectory-kpi-history.md --run-id=local-manual --source=local
```

## CI integration

- Workflow: `.github/workflows/ci.yml`
- Adds:
  - KPI/comparative check step (`--skip-db`)
  - Family replay policy check step
  - KPI trend-history artifact step
  - Uploaded artifacts:
    - `.artifacts/ar-trajectory-kpi-eval.json`
    - `.artifacts/ar-trajectory-benchmark-compare.json`
    - `.artifacts/ar-trajectory-benchmark-compare.md`
    - `.artifacts/ar-trajectory-family-replay-check.json`
    - `.artifacts/ar-trajectory-family-replay-check.md`
    - `.artifacts/ar-trajectory-kpi-history.json`
    - `.artifacts/ar-trajectory-kpi-history.md`

## Notes

- `--skip-db` is intended for CI environments that do not expose service-role Supabase credentials.
- Telemetry thresholds in `v1` are intentionally conservative and should be recalibrated once more field sessions are collected.
- Exception rows are explicit, expiring waivers for specific check IDs; expired/invalid rows fail the KPI check.
