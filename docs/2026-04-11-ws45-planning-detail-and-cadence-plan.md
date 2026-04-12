# 2026-04-11 WS45 Planning Detail And Cadence Plan

## Scope

- Upgrade the two WS45 planning products already ingested from the planning/aviation page:
  - `planning_24h`
  - `weekly_planning`
- Persist structured period/day data instead of only `headline`, `summary`, and `highlights`.
- Render those products as rich weather panels/cards on:
  - web launch detail
  - web/mobile shared live tab payload
  - native launch detail
- Correct WS45 cadence drift so:
  - the planning-page ingest keeps polling around the `24 Hour Forecast updated every 4 hours` source behavior
  - the mission-specific WS45 ingest is no longer left on the current every-8-hours schedule, which misses the source’s stated `0700L` and `1400L` update windows

Platform matrix:

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Surface type: customer-facing launch detail weather

## Problem

The current planning ingest is successfully downloading both planning PDFs, but the parser collapses them into a thin extract:

- `headline`
- `summary`
- `highlights`

That means the UI only receives shallow copy even though the PDFs contain structured forecast tables with:

- 24-hour forecast periods
- sky condition
- precipitation probability
- lightning probability
- surface winds
- temperature ranges
- severe weather potential
- daily / AM-PM weekly entries
- remarks and source metadata

Separately, WS45 mission forecast cadence drifted from higher-frequency polling to a managed scheduler interval of 8 hours, which is inconsistent with the mission-product update windows cited on the source page.

## Findings

1. The latest planning rows are present and selectable, but the richer table data is only trapped inside `raw_text`.
2. The current planning parser is string-summary-only and cannot emit structured periods/days.
3. The web/mobile weather payload models planning cards as generic weather cards with no planning-specific detail payload.
4. The web launch detail planning panel is intentionally summary-only.
5. The managed scheduler currently sets:
   - `ws45_planning_forecast_ingest` to a 30-minute poll with in-function due logic
   - `ws45_forecasts_ingest` to an every-8-hours cadence

## Implementation

### Phase 1: Additive storage and scheduler alignment

1. Add an additive `structured_payload jsonb` column to `ws45_planning_forecasts`.
2. Update managed scheduler config so `ws45_forecasts_ingest` is no longer on the every-8-hours interval.
3. Keep the planning ingest on frequent polling, but tighten due logic to source windows instead of generic fallback behavior.

### Phase 2: Structured planning parser

1. Extend planning extraction to capture layout-aware lines from PDF text coordinates.
2. Parse `planning_24h` into six forecast periods with:
   - period label
   - day label
   - sky condition
   - precipitation probability
   - lightning probability
   - surface wind
   - temperature min/max or range label
   - severe weather potential
3. Parse `weekly_planning` into per-day entries with:
   - date label
   - day label
   - AM/PM sky condition
   - AM/PM precipitation probability
   - AM/PM lightning probability
   - AM/PM winds
   - min/max temperature
   - severe weather potential
4. Preserve additive compatibility by continuing to populate `headline`, `summary`, and `highlights`.

### Phase 3: Surface the richer data

1. Add optional planning-detail payloads to the shared weather card contract.
2. Update web launch detail planning panels to render structured period/day rows instead of summary-only blocks.
3. Update shared web/mobile live tabs to render planning-detail sections when present.
4. Keep existing generic card behavior as the fallback when a row has no structured payload.

## Rollout / Compatibility

- The change is additive.
- Existing rows without `structured_payload` continue to render with current summary behavior.
- New parses use a bumped planning `parse_version`.
- The migration should trigger no breaking contract change for existing clients because planning detail is optional.

## Risks

- Weekly planning PDF structure may vary slightly across source revisions; the parser should degrade to summary mode instead of failing the row.
- Cadence changes increase WS45 mission-ingest frequency again; they should remain bounded to the source update windows rather than minute-level polling.
- Some older planning rows may need reingest or reparsing before they show rich detail.

## Verification

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Targeted runtime verification:

- confirm the latest `planning_24h` row persists all six forecast periods with wind/temp/precip/lightning fields
- confirm the latest `weekly_planning` row persists per-day AM/PM details
- confirm web launch detail renders rich planning panels for the current Florida launch
- confirm mobile weather cards can render planning-detail payloads without regressing generic weather cards
- confirm WS45 mission ingest cadence is restored from the current every-8-hours drift
