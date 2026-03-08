# AR Trajectory Family Replay Check Contract

Date: 2026-02-10  
Policy file: `docs/specs/ar-trajectory-family-replay-policy-v1.json`

## Purpose

Enforce representative per-family replay quality thresholds (not only overall/worst-case aggregate gates).

## Command

```bash
npm run trajectory:replay:family-check -- --report=.artifacts/ar-trajectory-replay-bench.json --output=.artifacts/ar-trajectory-family-replay-check.json --markdown=.artifacts/ar-trajectory-family-replay-check.md
```

## CI integration

- Workflow: `.github/workflows/ci.yml`
- Runs immediately after replay strict gate.
- Artifacts uploaded:
  - `.artifacts/ar-trajectory-family-replay-check.json`
  - `.artifacts/ar-trajectory-family-replay-check.md`

## Notes

- This closes the replay-validation half of `AR-P2-02`; device field validation remains required.
