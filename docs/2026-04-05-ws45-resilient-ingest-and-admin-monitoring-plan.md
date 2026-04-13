# 2026-04-05 WS45 Resilient Ingest And Admin Monitoring Plan

Last updated: 2026-04-05

## Platform Matrix

- Web: included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing: indirect only through launch weather exposure

## Summary

This plan hardens 45th Weather Squadron ingestion so format drift degrades into `quarantined + alerted + replayable` instead of silently disappearing from Florida launch details.

The best fit for this repo and source is:

- deterministic parsing first, not vendor Document AI first
- one shared parser core across Edge and Node runtimes
- layout-aware normalization and field-level fallback strategies
- schema validation and publish gating before launch-detail exposure
- automatic replay/backfill instead of manual field editing
- a dedicated web admin monitor at `/admin/ws45`

This is intentionally narrower than a full generic document-processing platform. WS45 is a recurring, mostly machine-generated source. The right first-class solution is a resilient deterministic pipeline with observability, not a broad OCR-heavy stack.

## Current State And Evidence

- Canonical forecast storage lives in [0033_ws45_launch_forecasts.sql](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/0033_ws45_launch_forecasts.sql).
- Parsing logic is duplicated in:
  - [index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ws45-forecast-ingest/index.ts)
  - [ws45ForecastIngest.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/ws45ForecastIngest.ts)
- Monitoring currently emits only one WS45-specific alert key in [monitoring-check](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/monitoring-check/index.ts#L519).
- Admin already has generic ops alert plumbing in:
  - [ops_alerts migration](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/0010_jobs_ops_alerts.sql#L6)
  - [admin summary route](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/api/admin/summary/route.ts#L832)
  - [ops page](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/admin/ops/page.tsx#L450)
- Admin nav currently has no dedicated WS45 destination in [AdminNav.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/admin/_components/AdminNav.tsx#L7).
- Launch-detail readers currently trust matched rows directly and do not have a publish gate:
  - [web launch detail](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/launches/[id]/page.tsx#L657)
  - [mobile API weather fetch](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/v1/mobileApi.ts#L1035)

Historical evidence from the stored WS45 corpus supports this plan:

- 28 total stored forecasts from 2026-01-09 through 2026-04-01.
- March 2026 is the structural break:
  - 13 ingests total
  - 12 with missing valid windows
  - 13 unmatched
- Failures cluster around date-format drift and split-heading drift, including Artemis II and Starlink 10-58.

## Locked Decisions

- Do not build a manual review or field-editing workflow as the normal operating model.
- Do build quarantine, replay, and alerting so bad parses never silently publish.
- Keep `ws45_launch_forecasts` as the canonical per-PDF row.
- Add parse-attempt history in a child table instead of overloading the main row with every diagnostic detail.
- Move parser interpretation into one shared pure-TS module that both the Edge function and the web/server runner can import.
- Use deterministic, layout-aware parsing first.
- Defer AWS Textract, Google Document AI, or Azure Document Intelligence to a shadow evaluation phase only if deterministic hardening still proves insufficient.
- Add a dedicated admin page at `/admin/ws45`, not just more generic Ops cards.

## Target Architecture

The pipeline becomes:

1. `discover`
   - fetch WS45 source page
   - enumerate candidate PDFs
2. `fetch`
   - fetch PDF bytes and fetch metadata
   - retain HTML/PDF failure details for observability
3. `extract`
   - extract native PDF text and available layout hints
   - detect likely `digital` vs `scanned`
4. `normalize`
   - normalize whitespace
   - normalize dashes and apostrophes
   - repair split headings and known broken word boundaries
   - create heading and section candidates
5. `classify`
   - assign `document_mode`
   - assign `document_family`
   - assign `known_family` vs `unknown_family`
6. `interpret`
   - extract required fields with field-specific strategy chains
7. `validate`
   - required-field presence
   - date/time sanity
   - valid-window sanity
   - scenario sanity
8. `score`
   - field confidence
   - document confidence
   - publish eligibility
9. `match`
   - launch association only after validation succeeds
10. `publish`
   - expose only publish-eligible matched rows
11. `observe`
   - emit drift, completeness, and coverage alerts
12. `replay`
   - automatically reparse quarantined or version-stale rows

## Implementation Ownership

### Shared Parser Core

Create a shared parser core under `packages/domain` so the same pure logic is reused by Edge and Node.

Proposed files:

- `packages/domain/src/ws45/parser.ts`
- `packages/domain/src/ws45/normalize.ts`
- `packages/domain/src/ws45/classify.ts`
- `packages/domain/src/ws45/validate.ts`
- `packages/domain/src/ws45/types.ts`

Constraints:

- pure TS only
- no `next/*`
- no Node-only APIs
- no browser-only APIs
- deterministic input/output so it can be used in scripts and tests

Runtime wrappers remain in:

- [supabase/functions/ws45-forecast-ingest/index.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/ws45-forecast-ingest/index.ts)
- [apps/web/lib/server/ws45ForecastIngest.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/ws45ForecastIngest.ts)

### Canonical Storage

Keep [ws45_launch_forecasts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/migrations/0033_ws45_launch_forecasts.sql#L4) as the canonical row per PDF and add summary quality state to it.

Additive columns proposed for `public.ws45_launch_forecasts`:

- `document_mode text not null default 'unknown' check (document_mode in ('digital','scanned','unknown'))`
- `document_family text`
- `classification_confidence int check (classification_confidence between 0 and 100)`
- `parse_status text not null default 'failed' check (parse_status in ('parsed','partial','failed'))`
- `parse_confidence int check (parse_confidence between 0 and 100)`
- `publish_eligible boolean not null default false`
- `quarantine_reasons text[] not null default '{}'`
- `required_fields_missing text[] not null default '{}'`
- `normalization_flags text[] not null default '{}'`
- `latest_parse_run_id uuid`

Notes:

- `publish_eligible` is the new exposure gate.
- `match_status` remains separate from parse quality.
- `manual` stays in `match_status` for backward compatibility, but the implementation should avoid introducing new manual-match flows.

### Parse Attempt History

Add a new table `public.ws45_forecast_parse_runs` as the source of truth for parser diagnostics and replay evidence.

Proposed columns:

- `id uuid primary key default gen_random_uuid()`
- `forecast_id uuid not null references public.ws45_launch_forecasts(id) on delete cascade`
- `parser_version text not null`
- `runtime text not null check (runtime in ('edge','node','script'))`
- `attempt_reason text not null check (attempt_reason in ('ingest','reparse','admin_replay','backfill'))`
- `document_mode text not null check (document_mode in ('digital','scanned','unknown'))`
- `document_family text`
- `parse_status text not null check (parse_status in ('parsed','partial','failed'))`
- `parse_confidence int check (parse_confidence between 0 and 100)`
- `publish_eligible boolean not null default false`
- `missing_required_fields text[] not null default '{}'`
- `validation_failures text[] not null default '{}'`
- `normalization_flags text[] not null default '{}'`
- `field_confidence jsonb`
- `field_evidence jsonb`
- `strategy_trace jsonb`
- `stats jsonb`
- `created_at timestamptz not null default now()`

Recommended indexes:

- `(forecast_id, created_at desc)`
- `(parser_version, created_at desc)`
- `(publish_eligible, created_at desc)`
- `(document_family, created_at desc)`

Purpose:

- compare parser versions
- explain why a row was quarantined
- drive admin drilldown
- support replay and trend analysis

## Parser Strategy Spec

### Intermediate Representation

Do not parse business fields directly from raw flattened text. Normalize into a WS45-focused IR with:

- `pages`
- `rawText`
- `lines`
- `headingCandidates`
- `sections`
- `documentMetadata`
- `sourceSpans`
- `layoutHints`

This is intentionally smaller than a generic document AI schema, but enough to decouple interpretation from raw PDF extraction.

### Classification

Classification is a required stage, not an afterthought.

Initial family set:

- `legacy_spaced_full_month_year`
- `hyphenated_abbrev_month_2digit_year`
- `split_heading_variant`
- `unknown_family`

Initial mode set:

- `digital`
- `scanned`
- `unknown`

### Required Fields

A row is not publish-eligible without:

- `product_name`
- `forecast_kind` unless the doc is explicitly classified as FAQ
- `mission_name`
- `issued_at`
- `valid_start`
- `valid_end`
- a successful or acceptable launch association

### Field Strategy Chains

Each field uses ordered strategies, for example:

- `issued_at`
  - anchor-based parse from `Issued:`
  - normalized text regex around `Issued`
  - family-specific fallback
- `valid_window`
  - anchor-based parse from `Valid:`
  - family-specific window parse
  - section-based fallback
- `forecast_discussion`
  - section heading extraction
  - split-heading normalization fallback
- `launch_day` and `delay_24h`
  - section slicing by semantic headings
  - anchored field reads inside each section

Every accepted field should retain evidence in the parse-run record:

- source text
- section
- page if known
- strategy used
- confidence

### Validation Gates

Validation happens before launch matching and before exposure.

Validation rules:

- `issued_at`, `valid_start`, and `valid_end` must parse as valid timestamps
- `valid_end` must be greater than `valid_start`
- valid window duration must be plausible for WS45 windows
- POV fields must be `0-100`
- `forecast_kind='faq'` must never be matched to a launch
- family-specific sanity checks may reject impossible shapes

If validation fails:

- row is stored
- parse run is stored
- `publish_eligible=false`
- row is quarantined
- alerts are emitted

## Publish And Reader Gating

Update WS45 readers so they only expose `publish_eligible=true` rows.

Files to update:

- [web launch detail](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/launches/[id]/page.tsx#L657)
- [mobile API weather fetch](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/v1/mobileApi.ts#L1035)

Reader selection rules:

- `matched_launch_id = launchId`
- `publish_eligible = true`
- `forecast_kind is null or != 'faq'`
- newest valid `issued_at`
- fallback to latest still-valid previously publish-eligible row if the newest fetched row is quarantined

This prevents a bad fresh parse from displacing a good still-valid forecast.

## Replay And Recovery

Replay replaces the need for manual remediation.

Add replay scopes:

- `parser_version_lt_current`
- `publish_eligible_false`
- `missing_required_fields`
- `unmatched_upcoming`
- `forecast_id`

Operational rules:

- parser-version bumps automatically enqueue replay for quarantined rows and upcoming Florida launch rows
- admin can trigger targeted replay from `/admin/ws45`
- replay must be idempotent
- replay must write a new parse-run row before mutating canonical summary fields

Preferred entry points:

- keep manual ingest trigger in [admin sync route](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/api/admin/sync/route.ts#L112)
- add dedicated replay endpoint rather than overloading generic sync

Proposed admin endpoints:

- `GET /api/admin/ws45/summary`
- `POST /api/admin/ws45/reparse`
- `POST /api/admin/ws45/monitor`

## Alert Catalog

Keep `ops_alerts` as the shared alert table, but expand WS45 coverage.

New WS45 alert keys:

- `ws45_source_fetch_failed`
  - severity: `critical`
  - trigger: ingest cannot fetch source page or PDF due to WAF, HTTP, or parseable-empty response
- `ws45_source_empty`
  - severity: `warning`
  - trigger: source page fetch succeeded but no launch forecast PDFs were discovered
- `ws45_shape_unknown_detected`
  - severity: `warning`
  - trigger: any new document classifies as `unknown_family`
- `ws45_parse_missing_issued`
  - severity: `warning`
  - trigger: one or more recent non-FAQ docs have `issued_at is null`
- `ws45_parse_missing_valid_window`
  - severity: `critical`
  - trigger: one or more recent non-FAQ docs have null `valid_start` or `valid_end`
- `ws45_parse_required_fields_missing`
  - severity: `warning`
  - trigger: any recent doc fails publish gating due to required fields
- `ws45_match_unmatched_upcoming`
  - severity: `warning`
  - trigger: publish-eligible upcoming doc remains unmatched
- `ws45_match_ambiguous_upcoming`
  - severity: `warning`
  - trigger: publish-eligible upcoming doc remains ambiguous
- `ws45_florida_launch_coverage_gap`
  - severity: `critical`
  - trigger: eligible upcoming Florida launch lacks any publish-eligible WS45 forecast while a recent WS45 doc exists
- `ws45_success_rate_degraded`
  - severity: `warning`
  - trigger: rolling parse success drops below threshold

Threshold defaults:

- 24h parse completeness target: `>= 99%`
- 7d parse completeness target: `>= 99%`
- 24h publish eligibility target: `>= 98%`
- upcoming Florida launch coverage target: `>= 99%`
- unknown-family target: `0`

Update [jobs.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/admin/_lib/jobs.ts#L3) so new WS45 alert keys map back to `ws45_forecasts_ingest`.

## Dedicated Admin Surface

Add a dedicated admin page:

- `apps/web/app/admin/ws45/page.tsx`

Add nav entry:

- [AdminNav.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/admin/_components/AdminNav.tsx#L7)

Add server helpers and routes:

- `apps/web/app/api/admin/ws45/summary/route.ts`
- `apps/web/app/api/admin/ws45/reparse/route.ts`
- `apps/web/app/api/admin/ws45/monitor/route.ts`
- `apps/web/app/admin/ws45/_lib/*`

Page sections:

### 1. Health Header

- latest ingest time
- last successful parse-run time
- open WS45 alerts
- quarantined current docs
- upcoming Florida launch coverage count

### 2. Coverage Table

One row per upcoming Florida launch showing:

- launch name
- launch NET/window
- pad
- current WS45 coverage status
- matched forecast label
- issued time
- valid window
- parse version
- alert badges if uncovered or quarantined

### 3. Recent Documents Table

One row per recent WS45 PDF showing:

- source label
- fetched time
- parser version
- document family
- parse status
- publish eligibility
- match status
- quarantine reasons
- PDF link

### 4. Drift And Trends

- parse completeness over 24h / 7d / 30d
- publish eligibility trend
- family distribution trend
- unknown-family detections
- replay recovery counts by parser version

### 5. Alerts Panel

- unresolved WS45 alerts only
- link each alert to affected docs and launches
- allow `Run monitor` and `Replay affected` actions

### 6. Document Drilldown

For a selected forecast:

- canonical parsed fields
- required-field failures
- strategy trace
- evidence snippets
- parser-version history

This page is monitor/recover oriented, not a manual data-entry UI.

## Corpus And Test Plan

Add a committed WS45 corpus under repo control.

Proposed locations:

- `scripts/fixtures/ws45/`
- `scripts/ws45-corpus-smoke.mts`
- `scripts/ws45-monitoring-guard.mts`

Corpus coverage:

- all currently stored historical PDFs or normalized raw captures
- January/February healthy examples
- all March 2026 failures
- Artemis II split-heading examples
- Starlink 10-58 hyphenated-date example
- at least one FAQ document

Each corpus case should assert:

- classification result
- required fields
- publish eligibility
- match status expectation
- quarantine expectation when applicable

Add new package/root scripts:

- `npm run test:ws45-corpus`
- `npm run test:ws45-monitoring`

## Phased Rollout

### Phase 0: Corpus And Shared Core

- export live WS45 history into the corpus
- build shared parser types and normalization/classification layers
- move both runtimes onto the shared parser core

Acceptance:

- both ingest entry points use the same parser module
- corpus covers all known failing families

### Phase 1: Validation And Canonical Publish Gate

- add `parse_status`, `publish_eligible`, classification, and quarantine summary fields
- add `ws45_forecast_parse_runs`
- enforce publish gating before matching/exposure

Acceptance:

- bad parses store diagnostics but do not publish
- launch readers filter on `publish_eligible=true`

### Phase 2: Replay And Recovery

- implement parser-version replay and targeted admin replay
- replay quarantined and version-stale rows automatically

Acceptance:

- parser upgrades recover historical failures without manual editing
- replay is idempotent and traceable

### Phase 3: Monitoring Expansion

- add new WS45 alert keys
- extend monitoring-check to calculate WS45 completeness, coverage, and drift
- update jobs-to-alert mapping

Acceptance:

- alerting covers missing windows, unknown shapes, and Florida coverage gaps

### Phase 4: Dedicated Admin Surface

- add `/admin/ws45`
- add summary, drilldown, replay actions, and coverage table

Acceptance:

- one admin page answers whether WS45 is fresh, parsed, matched, and exposed for upcoming Florida launches

### Phase 5: Optional Shadow Evaluation

- only if deterministic hardening still proves too fragile
- run AWS/Google/Azure document extraction in shadow mode against the WS45 corpus
- compare field-level accuracy and operational cost before any adoption

Acceptance:

- only proceed if it materially improves accuracy and lowers operational burden

## File Touch Map

Expected code areas:

- `packages/domain/src/ws45/*`
- `supabase/functions/ws45-forecast-ingest/index.ts`
- `apps/web/lib/server/ws45ForecastIngest.ts`
- `supabase/functions/monitoring-check/index.ts`
- `apps/web/app/admin/_components/AdminNav.tsx`
- `apps/web/app/admin/_lib/jobs.ts`
- `apps/web/app/admin/ws45/*`
- `apps/web/app/api/admin/ws45/*`
- `apps/web/app/launches/[id]/page.tsx`
- `apps/web/lib/server/v1/mobileApi.ts`
- `supabase/migrations/*`
- `scripts/fixtures/ws45/*`
- `scripts/ws45-corpus-smoke.mts`
- `scripts/ws45-monitoring-guard.mts`

## Verification Set

For implementation slices that touch shared backend plus web/admin:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run lint`

Add new WS45 verification:

- `npm run test:ws45-corpus`
- `npm run test:ws45-monitoring`

If launch weather exposure changes:

- validate both [web launch detail](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/launches/[id]/page.tsx#L657) and [mobile API weather shaping](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/v1/mobileApi.ts#L1035)

## Rollback Notes

- Parser-core unification is safe to roll back independently from alerting and admin UI.
- New diagnostic columns and parse-run history are additive.
- Publish gating can be temporarily relaxed only if absolutely necessary, but that should be treated as an incident mitigation, not normal behavior.
- `/admin/ws45` is admin-only and isolated from customer routing.

## Out Of Scope

- manual forecast editing
- manual forecast-to-launch attachment as the primary recovery path
- iOS or Android admin UI
- replacing deterministic parsing with vendor Document AI in the initial hardening slice
