# AR Trajectory Comparative Benchmark

- Current: `.artifacts/ar-trajectory-replay-bench.json`
- Baseline: `scripts/fixtures/ar-trajectory-replay-baseline-v1.json`

## Overall

| Metric | Baseline | Current | Delta |
|---|---:|---:|---:|
| p95 deg | 2.376 | 2.376 | 0.000 |
| |drift| deg | 0.966 | 0.966 | 0.000 |
| |slope| deg/min | 0.796 | 0.796 | 0.000 |

## Worst Case

| Metric | Baseline | Current | Delta |
|---|---:|---:|---:|
| worst p95 deg | 3.968 | 3.968 | 0.000 |
| worst |drift| deg | 3.271 | 3.271 | 0.000 |

## Skipped Cases

- baseline=0
- current=0
- delta=0

## Per Case Deltas

| Case | Baseline p95 | Current p95 | Delta p95 | Baseline |drift| | Current |drift| | Delta |drift| |
|---|---:|---:|---:|---:|---:|---:|
| falcon9-cape-low-drift | 0.388 | 0.388 | 0.000 | 0.097 | 0.097 | 0.000 |
| falcon9-vandenberg-growing-drift | 3.968 | 3.968 | 0.000 | 3.271 | 3.271 | 0.000 |
| starship-boca-moderate-drift | 2.532 | 2.532 | 0.000 | 1.446 | 1.446 | 0.000 |
| newglenn-cape-eastbound | 1.592 | 1.592 | 0.000 | 0.982 | 0.982 | 0.000 |
| electron-mahia-steady | 1.496 | 1.496 | 0.000 | 0.675 | 0.675 | 0.000 |
| vulcan-cape-clean | 0.699 | 0.699 | 0.000 | 0.435 | 0.435 | 0.000 |
| ariane6-kourou-nominal | 1.349 | 1.349 | 0.000 | 0.759 | 0.759 | 0.000 |

