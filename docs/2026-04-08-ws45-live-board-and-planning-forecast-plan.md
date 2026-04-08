# 2026-04-08 WS45 Live Board And Planning Forecast Plan

## Scope

- Customer-facing launch detail weather enrichment for Eastern Range launches.
- Admin/internal visibility for new ingest jobs and source health.
- Shared API/backend impact: yes.

Platform matrix:

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Surface type: customer-facing launch detail + admin monitoring

## Goal

Add three new advanced weather sources for Eastern Range launches:

1. Weather Safety Live Board
   - Current operational lightning phase status
   - Current wind status
   - Current range/pad weather safety status
2. 45 WS 24 Hour Planning Forecast
   - Day-of bridge product between official mission forecast and broader context
3. 45 WS Weekly Planning Forecast
   - Week-ahead Cape trend context before mission-specific forecasts are published

## Source Reality

- The live board is exposed as a client app backed by structured JSON endpoints on `nimboard.rad.spaceforce.mil`.
- The planning/aviation page is currently WAF-challenged from this environment.
- The existing launch support page is also WAF-challenged from this environment, even though the repo already has an ingest path for it.

Implementation must therefore:

- prefer structured JSON over DOM scraping where possible
- normalize source drift before UI consumption
- isolate WAF/page-shape risk to ingest jobs
- preserve the current customer-facing weather summary if new sources are missing or stale

## Data Model

### A. Live Board Snapshots

Add a new normalized snapshot table for live operational range status.

Proposed table:

- `public.ws45_live_weather_snapshots`

Core fields:

- `id uuid`
- `source text`
- `source_page_url text`
- `board_url text`
- `fetched_at timestamptz`
- `agency_count int`
- `ring_count int`
- `active_phase_1_count int`
- `active_phase_2_count int`
- `active_wind_count int`
- `active_severe_count int`
- `summary text`
- `agencies jsonb`
- `lightning_rings jsonb`
- `raw jsonb`

Notes:

- Keep the raw payload for replay and drift debugging.
- Keep typed counts and summary fields for queryability and UI.
- Do not attempt to tie a snapshot to only one launch row. Relevance is determined at read time for Eastern Range launches.

### B. Planning Forecast Products

Add a normalized product table for planning PDFs.

Proposed table:

- `public.ws45_planning_forecasts`

Core fields:

- `id uuid`
- `product_kind text`
- `source text`
- `source_page_url text`
- `source_label text`
- `pdf_url text`
- `pdf_etag text`
- `pdf_last_modified timestamptz`
- `pdf_sha256 text`
- `pdf_bytes int`
- `pdf_metadata jsonb`
- `fetched_at timestamptz`
- `issued_at timestamptz`
- `valid_start timestamptz`
- `valid_end timestamptz`
- `headline text`
- `summary text`
- `highlights text[]`
- `raw_text text`
- `raw jsonb`
- `parse_version text`
- `document_family text`
- `parse_status text`
- `parse_confidence int`
- `publish_eligible boolean`
- `quarantine_reasons text[]`

`product_kind` values:

- `planning_24h`
- `weekly_planning`

Notes:

- `planning_24h` is region-level, not mission-level. It should be selected for launch detail when the launch is Eastern Range and the launch NET is near the product validity window.
- `weekly_planning` should surface as Cape context, labeled `Cape weekly outlook`.

## Ingest Jobs

### A. Live Board Job

Add a new job:

- `ws45-live-weather-ingest`

Scheduler strategy:

- Managed scheduler interval: every 15 minutes
- Job-level due logic determines whether a network fetch is needed

Dynamic cadence policy for Eastern Range launches:

- within 24 hours: fetch at most every 2 hours
- within 12 hours: fetch at most every 1 hour
- within 4 hours: fetch at most every 30 minutes
- within 1 hour: fetch at most every 15 minutes

Rules:

- Determine cadence anchor from the nearest upcoming visible Eastern Range launch NET/window.
- If NET slides, cadence naturally adjusts because due logic re-evaluates on every tick.
- If no Eastern Range launch is within 24 hours, skip fetch and record a `not_due` reason in stats.

### B. Planning Product Job

Add a new job:

- `ws45-planning-forecast-ingest`

Scheduler strategy:

- Managed scheduler interval: every 30 minutes
- Job-level due logic determines whether the page fetch is needed

Due logic:

- `planning_24h`
  - base cadence: every 4 hours
  - expected release slots: every 4 hours local time
  - short retries after expected update slots if the newest stored label has not rolled forward
- `weekly_planning`
  - base cadence: daily
  - retry opportunistically when the planning page is already being fetched for the 24-hour product

Notes:

- One page fetch can refresh both product kinds.
- The page parser must classify the product card by label, not by hardcoded list position.

## Normalization Strategy

### Live Board

Normalize raw agency payloads into stable UI items:

- lightning phase items
- wind status items
- severe weather items
- temperature items

Derived fields:

- human summary
- severity tone
- start/end timestamps
- “not active” state

### Planning Forecasts

Normalize labels and PDF text into stable product records:

- parse product kind from label text
- parse local issue date/time from label when present
- infer validity window
- extract a short summary and limited highlight list from PDF text
- retain raw text and source label for replay when the PDF family changes

## Shared API / Contracts

Extend the launch detail weather module additively.

Proposed additions:

- `weather.operational` for live board status
- extend weather card source enum with:
  - `ws45_live`
  - `ws45_planning_24h`
  - `ws45_weekly`
- optional `detailLevel` or equivalent grouping to let UI separate advanced weather data from standard forecast cards

Rules:

- Do not break existing `weather.summary`, `weather.concerns`, or current `ws45` / `nws` cards.
- Only populate new advanced structures for Eastern Range launches when source freshness is acceptable.

## UI Plan

### Web launch page

Update the consolidated weather section to support:

- current operational status block from the live board
- advanced planning cards below the mission forecast/NWS panels
- explicit labels:
  - `Live range weather`
  - `45 WS 24-hour planning forecast`
  - `Cape weekly outlook`

### Shared web/mobile live tab

Update the tabbed weather experience to:

- render operational status separately from forecast cards
- render planning/weekly products in an advanced section
- keep the current high-level summary visible first

## Admin / Ops

Minimum admin changes:

- register the new jobs in admin summary/ops
- expose basic freshness/error state
- keep existing WS45 monitoring separate from the new jobs

Stretch:

- extend `/admin/ws45` with live board + planning product health

## Rollout Order

1. Add plan doc
2. Add schema for live board snapshots and planning forecasts
3. Add shared normalization helpers
4. Add live board ingest job and cadence gating
5. Add planning forecast ingest job and cadence gating
6. Extend contracts and launch detail read path
7. Update web launch weather section
8. Update shared web/mobile launch detail weather UI
9. Add admin job visibility
10. Run verification set

## Rollback Notes

- All schema changes should be additive.
- Existing WS45 mission forecast ingest stays untouched functionally.
- If new ingest jobs misbehave, disable them without removing the stored data or existing forecast surfaces.
- UI should degrade by omitting new advanced blocks when data is missing or stale.

## Known Risks / Open Questions

1. The planning page is WAF-challenged from this environment, so live verification may be limited.
2. Current WS45 launch support fetches are also WAF-challenged from this environment, which suggests environment-sensitive behavior that must be monitored in production.
3. The exact publish times for the 24-hour planning product should be inferred conservatively from the page label/update note, not assumed to be perfect.
4. We need to decide whether the main launch page and the shared tab view should use identical advanced-weather grouping or only aligned semantics.

## Verification Set

- `node -v && npm -v`
- `npm run doctor`
- relevant migration review
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Targeted source verification:

- confirm `nimboard` JSON fetch and normalization against current live payloads
- confirm planning page parser behavior against stored fixtures or captured page/PDF samples
- confirm launch detail payload remains backward compatible when new data is absent
