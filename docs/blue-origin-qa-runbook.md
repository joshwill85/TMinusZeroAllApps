# Blue Origin QA Runbook

## Purpose
This runbook defines a manual operator-driven QA process for Blue Origin data quality. It is intentionally not an automated cron/job gate.

## Policy
- QA is executed by an operator for every Blue Origin ingest/edit/remove change.
- Data is hidden until verified (`Hide until verified`).
- Existing audit scripts are diagnostics only, not autonomous gatekeepers.

## Required Toolchain
- Node `24.14.1`
- npm `11.11.0`
- Run in pinned Docker image when local shell differs.

## QA Scope (Every Pass)
1. Flight Inventory and Classification
- Enumerate all NS flights from `launches_public_cache` and Blue Origin APIs.
- Classify each flight as `manned`, `unmanned`, or `unknown` using multi-source evidence.
- Resolve conflicts before shipping changes.

2. Manifest Traveler QA (Manned Flights)
- Verify traveler count > 0 for every manned flight.
- Verify traveler manifests match launch detail traveler list.
- Verify each traveler has:
  - Internal profile page (`/blue-origin/travelers/[slug]`)
  - Photo URL
  - External source/profile URL

3. Payload QA
- Ensure payload counts are consistent between mission summary, manifest, and launch detail.
- Prevent mannequin/test-device rows from being counted as human travelers.

4. Official Source URL QA
- Verify every displayed official/source URL is reachable.
- Remove URLs that fail reachability checks.
- Ensure at least one verified mission source is shown when available.

## Diagnostics to Run (Operator Triggered)
- `npm run audit:blue-origin -- --checkUrls`
- `npm run test:blue-origin-dossier`
- Targeted checks:
  - `npm run audit:blue-origin -- --flightCode ns-16 --checkUrls`
  - `npm run audit:blue-origin -- --flightCode ns-7 --checkUrls`

## Acceptance Criteria
- No manned NS flight displayed as unmanned.
- No traveler-photo or traveler-profile regressions on manned flights.
- No broken official/source links displayed.
- No manifest traveler/payload contradictions for any NS flight.

## Sign-off Format
Each QA pass should produce:
- Summary of flights checked.
- List of discrepancies found and fixes applied.
- Final pass/fail against acceptance criteria.
