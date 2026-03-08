# AR Trajectory Family Replay Check

- generatedAt: 2026-03-05T20:59:34.541Z
- policyVersion: ar_trajectory_family_replay_policy_v1
- policyPath: `docs/specs/ar-trajectory-family-replay-policy-v1.json`
- replayReportPath: `.artifacts/ar-trajectory-replay-bench.json`
- result: PASS

| Check | Value | Threshold | Status |
|---|---:|---:|---|
| replay.skipped_cases | 0.000 | <= 0 | pass |
| case.falcon9-cape-low-drift.present | yes | yes | pass |
| case.falcon9-cape-low-drift.samples | 11.000 | >= 10 | pass |
| case.falcon9-cape-low-drift.p95 | 0.388 | <= 1.25 | pass |
| case.falcon9-cape-low-drift.abs_drift | 0.097 | <= 0.5 | pass |
| case.falcon9-vandenberg-growing-drift.present | yes | yes | pass |
| case.falcon9-vandenberg-growing-drift.samples | 11.000 | >= 10 | pass |
| case.falcon9-vandenberg-growing-drift.p95 | 3.968 | <= 4.25 | pass |
| case.falcon9-vandenberg-growing-drift.abs_drift | 3.271 | <= 3.4 | pass |
| case.starship-boca-moderate-drift.present | yes | yes | pass |
| case.starship-boca-moderate-drift.samples | 11.000 | >= 10 | pass |
| case.starship-boca-moderate-drift.p95 | 2.532 | <= 2.8 | pass |
| case.starship-boca-moderate-drift.abs_drift | 1.446 | <= 1.8 | pass |
| case.newglenn-cape-eastbound.present | yes | yes | pass |
| case.newglenn-cape-eastbound.samples | 11.000 | >= 10 | pass |
| case.newglenn-cape-eastbound.p95 | 1.592 | <= 2 | pass |
| case.newglenn-cape-eastbound.abs_drift | 0.982 | <= 1.2 | pass |
| case.electron-mahia-steady.present | yes | yes | pass |
| case.electron-mahia-steady.samples | 11.000 | >= 10 | pass |
| case.electron-mahia-steady.p95 | 1.496 | <= 1.8 | pass |
| case.electron-mahia-steady.abs_drift | 0.675 | <= 1 | pass |
| case.vulcan-cape-clean.present | yes | yes | pass |
| case.vulcan-cape-clean.samples | 11.000 | >= 10 | pass |
| case.vulcan-cape-clean.p95 | 0.699 | <= 1 | pass |
| case.vulcan-cape-clean.abs_drift | 0.435 | <= 0.8 | pass |
| case.ariane6-kourou-nominal.present | yes | yes | pass |
| case.ariane6-kourou-nominal.samples | 11.000 | >= 10 | pass |
| case.ariane6-kourou-nominal.p95 | 1.349 | <= 1.7 | pass |
| case.ariane6-kourou-nominal.abs_drift | 0.759 | <= 1 | pass |

