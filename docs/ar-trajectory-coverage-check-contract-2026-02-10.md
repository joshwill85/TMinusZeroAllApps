# AR Trajectory Coverage Check Contract

Date: 2026-02-10  
Policy file: `docs/specs/ar-trajectory-coverage-policy-v1.json`

## Purpose

Provide a repeatable field-report command for next-launch trajectory coverage quality (truth-tier orbit usage, derived-only rate, directional-constraint gaps, and product freshness gaps).

## Command

1. Coverage check (requires Supabase admin env):
```bash
npm run trajectory:coverage:check -- --output=.artifacts/ar-trajectory-coverage-check.json --markdown=.artifacts/ar-trajectory-coverage-check.md
```

2. Non-blocking mode:
```bash
npm run trajectory:coverage:check -- --warn-only --output=.artifacts/ar-trajectory-coverage-check.json --markdown=.artifacts/ar-trajectory-coverage-check.md
```

3. CI/local-no-db compatibility mode:
```bash
npm run trajectory:coverage:check -- --skip-db --output=.artifacts/ar-trajectory-coverage-check.json --markdown=.artifacts/ar-trajectory-coverage-check.md
```

## Evaluated metrics

- `launchesEvaluated`
- `truthTierOrbitCoverageRate`
- `derivedOnlyOrbitCoverageRate`
- `noDirectionalConstraintRate`
- `missingOrStaleProductRate`

## Notes

- This command is intended to close field-run evidence for `AR-P2-01` coverage expansion.
- Thresholds should be re-tuned as source coverage improves.
