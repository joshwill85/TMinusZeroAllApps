# AR Trajectory System Specification

Current implementation snapshot as of April 7, 2026.

This document describes the AR trajectory system exactly as it exists in the repo and production data today. It does not describe the intended end state, old remediation plans, or future modeling ideas except where those ideas still leave visible traces in the current code or schema.

The goal of this document is completeness. It covers:

- the live backend pipeline that builds trajectory products
- the contract and publish-policy layer that decides what can be shown
- the web and mobile consumers that read those products
- the runtime logic that decides how AR guidance runs on device
- the telemetry and admin surfaces around the system
- the production data footprint that exists right now

## Scope

Platform matrix:

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

Product scope:

- Customer-facing: yes
- Admin/ops backplane: yes

Current surface boundary:

- Web launch detail includes AR trajectory summary state and CTA gating.
- Web AR route is the richest consumer and uses the full internal trajectory contract.
- Mobile launch detail includes AR trajectory summary state and CTA gating.
- Mobile AR screen fetches the public V2 trajectory payload and hands it to the native module bridge.
- Public and private API routes expose trajectory payloads.
- Admin inspection routes expose eligibility, product diagnostics, and source-contract diagnostics.
- Telemetry routes collect AR runtime evidence from web and native surfaces.
- A companion FAA airspace map surface exists alongside the trajectory system.

Primary implementation files by area:

- Shared contract and publish layer:
  - `packages/domain/src/trajectory/contract.ts`
  - `packages/domain/src/trajectory/publishPolicy.ts`
  - `packages/domain/src/trajectory/fieldAuthority.ts`
  - `packages/domain/src/trajectory/evidence.ts`
  - `packages/domain/src/trajectory/milestones.ts`
  - `packages/contracts/src/index.ts`
- Server loaders and eligibility:
  - `apps/web/lib/server/arEligibility.ts`
  - `apps/web/lib/server/arTrajectory.ts`
  - `apps/web/lib/server/faaAirspace.ts`
- Product generation and ingest jobs:
  - `supabase/functions/trajectory-orbit-ingest/index.ts`
  - `supabase/functions/trajectory-constraints-ingest/index.ts`
  - `supabase/functions/navcen-bnm-ingest/index.ts`
  - `supabase/functions/faa-trajectory-hazard-ingest/index.ts`
  - `supabase/functions/trajectory-templates-generate/index.ts`
  - `supabase/functions/trajectory-products-generate/index.ts`
- Web AR runtime:
  - `apps/web/components/ar/ArSession.tsx`
  - `apps/web/components/ar/CameraGuideButton.tsx`
  - `apps/web/lib/ar/clientProfile.ts`
  - `apps/web/lib/ar/runtimeSelector.ts`
  - `apps/web/lib/ar/runtimeStartupPolicy.ts`
  - `apps/web/lib/ar/runtimePolicyClient.ts`
  - `apps/web/lib/ar/performanceGovernor.ts`
  - `apps/web/lib/ar/alignmentFeedback.ts`
  - `apps/web/lib/ar/telemetryClient.ts`
  - `apps/web/lib/ar/sessionStatus.ts`
  - `apps/web/lib/ar/surfaceEvidence.ts`
- Web routes and pages:
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/web/app/launches/[id]/ar/page.tsx`
  - `apps/web/app/api/public/launches/[id]/trajectory/route.ts`
  - `apps/web/app/api/public/launches/[id]/trajectory/v2/route.ts`
  - `apps/web/app/api/v1/launches/[id]/trajectory/route.ts`
  - `apps/web/app/api/public/ar/runtime-policy/route.ts`
  - `apps/web/app/api/public/ar/telemetry/session/route.ts`
  - `apps/web/app/api/v1/ar/telemetry/session/route.ts`
  - `apps/web/app/api/public/launches/[id]/faa-airspace-map/route.ts`
  - `apps/web/app/api/admin/trajectory/eligible/route.ts`
  - `apps/web/app/api/admin/trajectory/inspect/[id]/route.ts`
  - `apps/web/app/api/admin/trajectory/contract/[id]/route.ts`
  - `apps/web/app/admin/ops/trajectory/page.tsx`
- Mobile consumers:
  - `apps/mobile/app/launches/[id].tsx`
  - `apps/mobile/app/launches/ar/[id].tsx`
  - `apps/mobile/modules/tmz-ar-trajectory/src/TmzArTrajectory.types.ts`
  - `apps/mobile/src/api/queries.ts`
  - `packages/api-client/src/index.ts`

## What The AR Trajectory System Currently Is

The current AR trajectory system is a precomputed launch-guidance pipeline. It is not a request-time physics solver that starts from raw hazards, raw orbit docs, and raw landing data every time a user opens AR.

The actual live architecture is:

1. source jobs ingest or derive directional evidence
2. evidence is materialized into `launch_trajectory_constraints`
3. the products job fuses that evidence into one row per launch in `launch_trajectory_products`
4. the shared domain contract layer decides what that row is allowed to claim
5. consumers receive either the full internal contract or the smaller public V2 payload
6. the web or native runtime overlays that payload in AR or in fallback guidance mode
7. telemetry from those sessions feeds runtime policy and validation tooling

The system has three different layers of "quality":

### 1. Generator quality label

This is stored in the materialized product JSON:

- `pad_only`
- `landing_constrained`
- `estimate_corridor`

These are generation labels, not user-facing copy.

### 2. Internal runtime quality state

This is derived when the full internal contract is built:

- `precision`
- `guided`
- `search`
- `pad_only`

Important mapping behavior:

- `landing_constrained` becomes `precision`
- `estimate_corridor` becomes `guided` if confidence is strong enough
- `estimate_corridor` becomes `search` if confidence is weaker
- `pad_only` stays `pad_only`

### 3. Public client quality state

This is what mobile and public API clients receive:

- `precision`
- `safe_corridor`
- `pad_only`

Important mapping behavior:

- the public contract deliberately collapses `guided` and `search` into `safe_corridor`
- public clients therefore get less nuance than the web AR runtime

The system is also publish-gated twice:

- once during generation, when the products job can downgrade a precision candidate before writing it
- again during contract build, when the shared domain publish policy can still force pad-only behavior at read time

## High-Level Architecture

The current end-to-end flow is:

```text
launches_public_cache
  + provider docs / mission URLs / cached source docs
  + LL2 landing data
  + NAVCEN hazards
  + FAA TFR matches
  + historical template priors
    ->
launch_trajectory_constraints
trajectory_source_documents
launch_external_resources
trajectory_templates_v1
    ->
trajectory-products-generate
    ->
launch_trajectory_products
trajectory_source_contracts
trajectory_product_lineage
    ->
shared domain contract + publish policy
    ->
web full contract / public V2 payload / launch-detail summary
    ->
web AR runtime / mobile native bridge / admin inspection
    ->
ar_camera_guide_sessions telemetry
    ->
runtime policy and validation utilities
```

The most important current-state fact is this:

- the product row in `launch_trajectory_products` is the live source of truth for serving
- raw constraints are a backend evidence layer, not the direct serving layer

## Current Production Snapshot

Live production snapshot below is from April 7, 2026. Counts can drift after that timestamp, but these values describe the currently running system on the day this document was written.

### Scheduler Cadence

The live job cadence is mixed between managed scheduler and `pg_cron`.

| Job | Current cadence | Mechanism |
| --- | --- | --- |
| `trajectory_orbit_ingest` | hourly at `:00` UTC | managed scheduler |
| `trajectory_constraints_ingest` | hourly at `:20` UTC | managed scheduler |
| `faa_trajectory_hazard_ingest` | hourly at `:33` UTC | managed scheduler |
| `trajectory_products_generate` | hourly at `:40` UTC | managed scheduler |
| `navcen_bnm_ingest` | hourly at `:33` UTC | `pg_cron` |
| `trajectory_templates_generate` | daily at `03:15` UTC | `pg_cron` |

Important current caveat:

- the admin summary route still advertises older 6-hour trajectory schedules, so the admin summary schedule labels are currently stale relative to the live scheduler configuration

### Current System Settings

Relevant live `system_settings` values:

| Setting | Live value |
| --- | --- |
| `trajectory_orbit_job_enabled` | `true` |
| `trajectory_orbit_horizon_days` | `14` |
| `trajectory_orbit_launch_limit` | `100` |
| `trajectory_constraints_job_enabled` | `true` |
| `trajectory_constraints_eligible_limit` | `24` |
| `trajectory_products_job_enabled` | `true` |
| `trajectory_products_eligible_limit` | `24` |
| `faa_trajectory_hazard_job_enabled` | `true` |
| `faa_trajectory_hazard_match_horizon_days` | `21` |
| `trajectory_templates_job_enabled` | `true` |

Important settings caveats:

- `trajectory_products_top3_ids` still uses an old name, but the live value currently stores `10` launch IDs rather than `3`
- `trajectory_templates_v1` currently contains only `3` template keys

### Launch Coverage

Future launches in `launches_public_cache`: `362`

Field coverage among future launches:

- `pad_latitude` and `pad_longitude`: `361 / 362`
- `ll2_launch_uuid`: `362 / 362`
- `vehicle`: `362 / 362`
- `mission_orbit`: `352 / 362`
- `rocket_family`: `0 / 362`

`net_precision` among future launches:

- `minute`: `82`
- `hour`: `3`
- `day`: `11`
- `month`: `266`

Important implication:

- the launch catalog is good enough to know what the upcoming launches are
- it is not good enough to support high-quality family/template segmentation because `rocket_family` is currently empty on future rows

### AR Eligibility Snapshot

The current eligibility system is hard-capped to `3` launches at a time. At the snapshot time, production had `3` currently eligible AR launches, which is exactly the configured maximum.

### Trajectory Product Coverage

Rows in `launch_trajectory_products`: `85`

Future launches with trajectory products: `15`

Quality label distribution:

- `estimate_corridor`: `72`
- `landing_constrained`: `2`
- `pad_only`: `11`

Confidence tier distribution:

- `A`: `4`
- `B`: `36`
- `C`: `29`
- `D`: `2`
- `null`: `14`

Freshness distribution:

- `fresh`: `43`
- `stale`: `8`
- `unknown`: `20`
- `null`: `14`

Lineage completeness:

- `true`: `69`
- `false`: `16`

Track count distribution:

- `0` tracks: `14`
- `1` track: `70`
- `2` tracks: `1`

Rows marked downgraded in `trackSummary.downgraded`: `2`

Most recent `generated_at`: `2026-04-07T23:33:07.273+00:00`

Important implication:

- the system is heavily corridor-based today
- true landing-constrained precision rows are rare

### Source Contract Coverage

Rows in `trajectory_source_contracts`: `19,649`

Status distribution:

- `pass`: `17,312`
- `fail`: `2,337`

Confidence tier distribution:

- `A`: `340`
- `B`: `12,110`
- `C`: `4,862`
- `D`: `2,337`

Freshness distribution:

- `fresh`: `14,486`
- `stale`: `276`
- `unknown`: `4,887`

`lineage_complete = false`: `2,337`

Important version caveat:

- persisted rows still show `source_contract_v2_3`
- the generator code writes `source_contract_v2_4` in embedded sufficiency metadata
- the schema default is still older

The version markers are currently inconsistent.

### Lineage Coverage

Rows in `trajectory_product_lineage`: `19,018`

This table is the per-generation evidence trace that lets admin tooling explain why a product looked the way it did and why a source contract passed or failed.

### Source Document Coverage

Rows in `trajectory_source_documents`: `12,050`

Content type mix:

- `text/html; charset=utf-8`: `9,659`
- `text/html; charset=UTF-8`: `2,239`
- `application/json; charset=utf-8`: `145`
- `text/html`: `4`
- `application/pdf`: `2`
- `application/octet-stream`: `1`

Most recent `fetched_at`: `2026-04-07T23:00:08.717+00:00`

Important implication:

- the orbit ingest path is overwhelmingly HTML-based in practice
- PDF support exists, but it is not the dominant live case

### Constraint Coverage

Rows in `launch_trajectory_constraints`: `2,197`

Constraint type mix:

- `hazard_area`: `1,775`
- `target_orbit`: `129`
- `mission_infographic`: `64`
- `bo_official_sources`: `51`
- `bo_mission_facts`: `45`
- `landing`: `37`
- `landing_hint`: `32`
- `bo_manifest_payloads`: `22`
- `bo_manifest_passengers`: `42`

Constraint source mix:

- `navcen_bnm`: `1,701`
- `faa_tfr`: `117`
- `blueorigin_multisource`: `160`
- `blueorigin_mission_page`: `23`
- `ll2`: `37`
- `presskit_auto`: `31`
- `spacex_content`: `32`
- `spacex_website`: `41`
- `spacex_derived`: `36`
- `launch_orbit_prior`: `19`

Rows with geometry: `1,775`

Most recent `fetched_at`: `2026-04-07T23:33:05.757+00:00`

Important implication:

- `launch_trajectory_constraints` is a shared evidence table, not a pure serving table
- the dominant live evidence type is hazard geometry, not direct numeric orbit or landing precision

### Related Supporting Tables

`launch_external_resources`:

- total rows: `32`
- all current rows are `source = spacex_content`
- all current rows are `content_type = mission_bundle`

`ll2_launch_landings`:

- total rows: `47`
- `booster`: `31`
- `spacecraft`: `16`

`ll2_landings`:

- total rows: `936`
- common types include `Parachute Landing`, `Horizontal Landing`, `Destructive Reentry`, `Vertical Landing`, `Autonomous Spaceport Drone Ship`, `Return to Launch Site`, and others

### Telemetry Snapshot

Rows in `ar_camera_guide_sessions`: `102`

Recent session profile distribution:

- `ios_webkit`: `43`
- `null`: `59`

Mode entered:

- `ar`: `48`
- `sky_compass`: `22`
- `null`: `32`

Pose mode:

- `sensor_fused`: `13`
- `null`: `89`

Vision backend:

- `worker_roi`: `10`
- `none`: `3`
- `null`: `89`

Fallback reasons:

- `no_heading`: `14`
- `camera_denied`: `11`
- `motion_denied`: `8`
- `null`: `69`

Trajectory quality state:

- `guided`: `12`
- `search`: `1`
- `null`: `89`

Important implication:

- runtime telemetry is still sparse
- the live evidence today is heavily web or iOS WebKit shaped
- the codebase already supports cross-surface telemetry interpretation, but current data does not yet provide strong native evidence coverage

### FAA Airspace Snapshot

Sampled `faa_launch_matches` status mix:

- `unmatched`: `814`
- `ambiguous`: `123`
- `matched`: `63`

Other FAA tables:

- `faa_tfr_records`: `1,398`
- `faa_tfr_shapes`: `689`

Important implication:

- FAA airspace support exists and is real, but matched launch coverage is still a minority of all FAA records

### Recent Job Runs

Recent live ingestion runs:

| Job | Latest observed run | Result |
| --- | --- | --- |
| `trajectory_products_generate` | `2026-04-07T23:40:05.401706+00:00` | success |
| `faa_trajectory_hazard_ingest` | `2026-04-07T23:33:05.420823+00:00` | success |
| `navcen_bnm_ingest` | `2026-04-07T23:33:00.729437+00:00` | success |
| `faa_launch_match` | `2026-04-07T23:27:00.780539+00:00` | success |
| `trajectory_constraints_ingest` | `2026-04-07T23:20:05.418729+00:00` | fail |
| `trajectory_orbit_ingest` | `2026-04-07T23:00:05.584537+00:00` | success |

## Core Data Model

The AR trajectory system spans several tables. They do not all serve the same purpose.

### `launch_trajectory_products`

Purpose:

- one materialized product row per launch
- this is the serving table used by the loader

Key characteristics:

- created in `0069_launch_trajectory_products.sql`
- extended in `0150_trajectory_source_contracts_lineage.sql`
- premium/admin readable through RLS
- stores `version`, `quality`, `generated_at`, and the full `product` JSON
- also stores source-contract summary fields such as `confidence_tier`, `source_sufficiency`, `freshness_state`, `lineage_complete`, and `ingestion_run_id`

Important current behavior:

- the serving layer does not rebuild trajectories from raw constraints on each request
- it reads this materialized row and builds a contract from it

### `launch_trajectory_constraints`

Purpose:

- shared evidence table
- stores orbit, landing, hazard, infographic, and provider-derived evidence

Key characteristics:

- keyed by `(launch_id, source, constraint_type, source_id)`
- stores `data`, optional `geometry`, `confidence`, fetch metadata, and lineage fields

Important current behavior:

- the products generator uses only part of this table directly for final geometry
- the table is broader than the current serving model needs

### `trajectory_source_documents`

Purpose:

- raw source document cache for orbit extraction

Key characteristics:

- stores historical versions by `(url, sha256)`
- stores `etag`, `last_modified`, `extracted_text`, `raw`, and `parse_version`
- used to avoid repeatedly re-fetching and re-parsing the same upstream docs

### `trajectory_source_contracts`

Purpose:

- per-generation publishability evaluation

Key characteristics:

- stores whether a product generation passed or failed the source contract
- stores missing fields, blocking reasons, sufficiency signals, freshness, lineage completeness, and confidence tier

### `trajectory_product_lineage`

Purpose:

- per-generation evidence trace

Key characteristics:

- links a generated product to the raw evidence rows and source docs that contributed to it
- used heavily by admin diagnostics

### Hazard storage tables

NAVCEN:

- `navcen_bnm_messages`
- `navcen_bnm_hazard_areas`

FAA:

- `faa_tfr_records`
- `faa_tfr_shapes`
- `faa_notam_details`
- `faa_launch_matches`

These are not the final AR serving tables. They are upstream evidence stores that later produce `hazard_area` constraints.

### LL2 landing tables

- `ll2_landings`
- `ll2_launch_landings`

These support the landing ingest and the `landing` constraints written into `launch_trajectory_constraints`.

### Telemetry table

`ar_camera_guide_sessions`

Purpose:

- captures runtime evidence from web and native AR sessions
- feeds runtime-policy summarization and validation tooling

### Settings storage

`system_settings`

Relevant AR-related keys store:

- job enablement and cadence parameters
- launch limits and lookback windows
- cached template JSON
- current product coverage launch IDs

## Eligibility And Lifecycle

AR availability is not determined by "does this launch exist" alone.

Eligibility is computed in `apps/web/lib/server/arEligibility.ts`.

Current constants:

- hard eligible launch limit: `3`
- lookahead query limit: `50`
- lookback window: `24` hours
- expiry buffer after launch completion: `3` hours
- cache revalidate window: `600` seconds

Eligibility rules:

1. launch must appear in `launches_public_cache`
2. `net` must be within the lookback window
3. pad latitude and longitude must both exist
4. launch must not be expired

Expiry behavior:

- expiry is `NET + max timeline offset + 3h`
- if the launch status is `hold` or `scrubbed`, timeline offsets are ignored and expiry falls back to `NET + 3h`

Important implication:

- AR availability is explicitly a narrow near-term product
- most future launches are outside AR eligibility even if they have general launch detail pages

## Source Ingest Pipeline

The current backend pipeline has six meaningful stages.

### 1. Orbit ingest

Main file:

- `supabase/functions/trajectory-orbit-ingest/index.ts`

What it reads:

- candidate launches from `launches_public_cache`
- mission info URLs
- launch info URLs
- provider-derived URLs
- current domain allowlists from settings

What it does:

- builds URL candidates
- scores them against truth and fallback domain allowlists
- fetches and caches source docs with conditional request semantics
- extracts text and numeric orbit signals
- writes `target_orbit` constraints

Current fallback order if docs do not yield usable direction:

1. public orbit numeric extraction
2. SupGP-derived orbit fallback
3. hazard-derived azimuth fallback
4. family/site heuristic fallback

Important implementation fact:

- even fallback-derived results still materialize as `target_orbit` constraints in the shared evidence table

### 2. LL2 landing ingest

Main file:

- `supabase/functions/trajectory-constraints-ingest/index.ts`

What it reads:

- near-term eligible launches
- LL2 booster and spacecraft landing data

What it does:

- refreshes local LL2 landing catalog rows
- writes `landing` constraints
- triggers follow-up product generation

### 3. NAVCEN hazard ingest

Main file:

- `supabase/functions/navcen-bnm-ingest/index.ts`

What it reads:

- GovDelivery RSS and linked NAVCEN bulletin/message pages

What it does:

- fetches NAVCEN hazard message HTML
- parses windows and geometry
- stores raw NAVCEN hazard rows
- matches hazard areas to launches
- writes `hazard_area` constraints
- opportunistically triggers product regeneration

### 4. FAA hazard ingest

Main file:

- `supabase/functions/faa-trajectory-hazard-ingest/index.ts`

Important current behavior:

- this job does not fetch FAA raw data directly
- it consumes prebuilt FAA records, shapes, and launch matches already stored elsewhere

What it does:

- window-checks FAA TFR data against launch NET
- writes `hazard_area` constraints
- triggers follow-up product regeneration

### 5. Templates generation

Main file:

- `supabase/functions/trajectory-templates-generate/index.ts`

What it reads:

- historical launches
- historical `target_orbit`, `hazard_area`, and `landing` constraints

How it groups history:

- `site`
- `rocketFamily`
- mission class

What it writes:

- one JSON blob into `system_settings.trajectory_templates_v1`

Important live limitation:

- because `rocket_family` is effectively empty on current future launches, template selection is much coarser than the system design expects

### 6. Products generation

Main file:

- `supabase/functions/trajectory-products-generate/index.ts`

This is the main materialization step. It turns all upstream evidence into the product row the serving layer actually uses.

## Product Generation Method

The products generator is the core of the backend AR system.

### Job configuration

Live defaults in code and settings currently resolve to:

- enabled: `true`
- eligible limit: `24`
- lookahead limit: `80`
- lookback hours: `24`
- expiry hours: `3`

Important naming caveat:

- the setting `trajectory_products_top3_ids` still carries an old name, even though the system no longer works in a strict "top 3 only" backend sense

### Inputs loaded per run

For each run the generator loads:

- eligible launches
- existing product rows
- trajectory constraints
- external provider timeline resources
- source-check freshness signals from recent ingestion runs
- template data

It also computes hazard freshness state so stale hazard geometry can be suppressed when newer scans show no current match.

### Signal classes

The generator explicitly reasons over five directional signal classes:

- `orbit`
- `hazard`
- `landing`
- `template`
- `heuristic`

Not all signals are equally authoritative. The generator tries to prefer corroborated, directional, non-derived evidence where possible.

### Envelope profiles

The generator uses family-shaped envelope profiles rather than one generic curve for all vehicles.

Current family groupings in code include profiles for:

- Starship / Super Heavy
- Falcon Heavy / New Glenn / SLS class
- Falcon / Atlas / Vulcan class
- small-lift vehicles
- generic fallback

These profiles influence:

- duration
- altitude rise
- downrange horizon
- uncertainty spread
- track covariance shaping

### Output product types

The generator can currently emit three product shapes.

#### `pad_only`

Characteristics:

- `quality = 0`
- `qualityLabel = pad_only`
- one T+0 sample at the pad only
- no ascent model
- `sigmaDeg = 20`
- covariance defaults to along-track `15`, cross-track `20`

Use case:

- no usable directional evidence

#### `landing_constrained`

Characteristics:

- `quality = 1`
- `qualityLabel = landing_constrained`
- uses landing location as a directional constraint, not as a literal endpoint
- builds a constrained ascent envelope from pad toward the resolved launch azimuth

Hard requirement:

- landing coordinates must exist
- landing direction must be corroborated by another directional signal

This is the only generator label that is treated as a true precision candidate.

#### `estimate_corridor`

Characteristics:

- `quality = 2`
- `qualityLabel = estimate_corridor`
- widened directional corridor
- can be backed by orbit, hazard, template, or heuristic evidence

Important implication:

- the numeric `quality` field is not a simple "2 is better than 1" precision scale
- `estimate_corridor` uses `quality = 2`, but it is not more precise than `landing_constrained`
- the field is a legacy product encoding, not a direct user-facing precision rank

### Track synthesis

After geometry is built, the generator splits samples into logical tracks:

- `core_up`
- `upper_stage_up`
- `booster_down`

The live product set today is mostly single-track:

- `70` rows with one track
- `1` row with two tracks

### Milestone synthesis

Milestones are resolved through the shared milestone layer.

Canonical milestone concepts include:

- `LIFTOFF`
- `MAXQ`
- `MECO`
- `STAGESEP`
- `SECO`
- `BOOSTBACK`
- `ENTRY`
- `LANDING_BURN`
- `LANDING`

Milestone source priority:

1. provider timeline
2. LL2 timeline
3. family template fallback

Template fallback currently includes:

- default `LIFTOFF`, `MAXQ`, `MECO`
- Falcon-specific `STAGESEP` and `SECO`

Milestones are merged if occurrences land within `10` seconds of each other, and then projected onto track windows when possible.

Important behaviors:

- milestone presence does not guarantee milestone projectability
- milestones can exist but still be marked as missing-track or non-projectable
- the compatibility events layer only exposes projectable `core_up` milestones

### Source contract evaluation

This is the generator's publishability gate.

It computes:

- `status`
- `confidenceTier`
- `sourceSufficiency`
- `missingFields`
- `blockingReasons`
- `freshnessState`
- `lineageComplete`

Important behaviors:

- freshness thresholds tighten near launch
- SpaceX precision cases get stricter completeness treatment
- minimum expected confidence differs by product type

Current minimum tiers:

- `landing_constrained`: at least `B`
- `estimate_corridor`: at least `C`
- `pad_only`: at least `D`

### Generator downgrade path

If a precision claim fails the source contract, the generator tries to degrade before writing:

1. rebuild as widened `estimate_corridor`
2. if that still does not hold, fall back to `pad_only`

This is the first downgrade pass in the system.

### Low-IO write behavior

Constraint-producing jobs use a low-IO conditional merge RPC so rows are only rewritten when material fields actually changed.

Important implication:

- the pipeline is explicitly optimized to reduce churn and unnecessary write amplification

### Follow-up trigger coalescing

Orbit, landing, and hazard ingest jobs can request a follow-up products generation run, but those follow-ups are coalesced behind a `90` second lock window.

Important implication:

- the system avoids stampeding the products generator when several evidence jobs finish close together

## Shared Contract And Publish Policy

The shared domain package is the authoritative contract builder. The web-local duplicate is not the source of truth for live serving.

### Full internal contract

Built by:

- `buildTrajectoryContract`

Used by:

- the web AR page and runtime

Important fields in the full contract:

- `qualityState`
- `guidanceSemantics`
- `recoverySemantics`
- `trackTopology`
- `sourceCoverage`
- `uncertaintyEnvelope`
- `sourceBlend`
- `confidenceReasons`
- `safeModeActive`
- `generatedAt`
- `confidenceTier`
- `sourceSufficiency`
- `freshnessState`
- `lineageComplete`
- `publishPolicy`
- `confidenceBadge`
- `confidenceBadgeLabel`
- `evidenceLabel`
- `authorityTier`
- `fieldProvenance`
- `runtimeHints`
- `tracks`
- `milestones`
- raw `product`

### Public V2 contract

Built by:

- `buildTrajectoryPublicV2Response`

Used by:

- mobile AR
- API clients
- premium `/api/v1` consumers

What it keeps:

- user-facing quality and guidance state
- track topology
- source coverage
- uncertainty envelope
- source blend
- confidence reasons
- safety/publish flags
- tracks
- milestones

What it omits relative to the full internal contract:

- `authorityTier`
- `fieldProvenance`
- `runtimeHints`
- `confidenceBadgeLabel`

Important implication:

- mobile and third-party clients do not get the same provenance depth that the web AR runtime gets

### Launch-detail summary contract

`ArTrajectorySummaryV1` is the shared preflight contract used on both web and mobile launch detail.

Fields:

- `eligible`
- `hasTrajectory`
- `availabilityReason`
- `qualityState`
- `confidenceBadge`
- `generatedAt`
- `publishPolicy`

`availabilityReason` values:

- `available`
- `not_eligible`
- `trajectory_missing`

### Publish policy

Publish policy is derived centrally and applied at contract-build time, even if the generator has already written a row.

Reasons the publish policy can trigger:

- `source_contract_missing`
- `source_contract_unknown`
- `source_contract_failed`
- `sources_stale`
- `lineage_incomplete`
- `missing_required_fields`
- `blocking_reasons_present`

If precision is not allowed:

- `allowPrecision = false`
- `enforcePadOnly = true`

When pad-only is enforced at read time:

- `samples` are cleared
- `events` are cleared
- `tracks` are cleared
- `milestones` are preserved
- `qualityLabel` is rewritten to `pad_only`
- assumptions are appended with a `Publish guard:` reason line
- `trackSummary` is marked downgraded

This is the second downgrade pass in the system.

### Quality-state derivation

Internal quality-state derivation:

- `landing_constrained` -> `precision`
- `estimate_corridor` with stronger confidence -> `guided`
- `estimate_corridor` with weaker confidence -> `search`
- otherwise -> `pad_only`

Public V2 quality-state derivation:

- `precision`
- `safe_corridor`
- `pad_only`

Important implication:

- the public contract intentionally hides the `guided` vs `search` distinction

### Guidance semantics

Derived values:

- `constraint_backed`
- `modeled`
- `pad_only`

This is how the system describes where the current guidance came from.

### Recovery semantics

Derived values:

- `exact_track`
- `coarse_sector`
- `text_only`
- `none`

This tells consumers how concrete the visible recovery guidance really is.

### Source coverage

The contract derives source coverage fields such as:

- orbit coverage class
- whether hazard evidence is present
- landing coverage class
- stage separation source
- SupGP mode
- whether ship assignment is present

This lets the runtime and UI explain what kind of evidence actually backs the current track.

### Authority tiers

The shared field-authority layer currently uses these base authority tiers:

| Authority tier | Base trust |
| --- | --- |
| `partner_feed` | `1.00` |
| `official_numeric` | `0.95` |
| `regulatory_constrained` | `0.84` |
| `supplemental_ephemeris` | `0.76` |
| `public_metadata` | `0.58` |
| `model_prior` | `0.34` |

Trust scores are then adjusted using:

- freshness
- lineage completeness
- safe mode
- field-specific confidence conditions

The full contract exposes field provenance for:

- azimuth
- altitude
- milestones
- uncertainty

Each field gets:

- authority tier
- trust score
- confidence label
- summary text
- precision-eligibility hint

### Runtime hints

The full internal contract derives runtime hints for the web runtime, including:

- default overlay mode
- track count
- milestone count
- whether wide search is preferred
- whether stage split exists
- whether upper-stage track exists
- whether booster track exists

Important implication:

- the web runtime is not just reading geometry
- it is reading behavior hints shaped by the publish and provenance layer

### Evidence and confidence badges

Evidence labeling is centralized in `packages/domain/src/trajectory/evidence.ts`.

The system derives:

- `confidenceBadge`: `high`, `medium`, `low`, `unknown`
- `confidenceBadgeLabel`
- `evidenceLabel`

These are based on:

- `confidence_tier`
- `source_sufficiency`
- `lineage_complete`
- `qualityLabel`

## Serving And API Surfaces

### AR summary on launch detail

Web launch detail does not fetch the full trajectory contract by default.

It uses `loadArTrajectorySummary`, which returns only:

- eligibility
- whether a product row exists
- availability reason
- public quality state
- confidence badge
- generated time
- publish-policy summary

Mobile launch detail mirrors this same summary pattern through the shared `LaunchDetailV1` contract.

Important implication:

- both web and mobile keep full trajectory fetches off the hot launch-detail path

The web launch-detail CTA bridge is `CameraGuideButton`.

Current behavior:

- prefetches the legacy public trajectory route as a warm-up step
- on fallback-first profiles such as iOS WebKit, requests motion permission preflight before entering the AR route

### Main server loader

The main loader is `apps/web/lib/server/arTrajectory.ts`.

Behavior:

1. checks AR eligibility
2. reads `launch_trajectory_products` using a fixed contract column list
3. if no row exists for an eligible launch, synthesizes a pad-only fallback row from `launches_public_cache`
4. builds either the full internal contract or the public V2 payload from the row

The synthetic pad-only fallback uses:

- a single T+0 pad sample
- `sigmaDeg = 20`
- covariance `15 / 20`

### Web page route

The web AR page at `/launches/[id]/ar`:

- requires premium access
- loads the launch from `launches_public_cache`
- canonicalizes pad coordinates from the LL2 pad catalog when possible
- rechecks eligibility
- loads the full internal `TrajectoryContract`
- passes it directly into `ArSession`

Important implication:

- the web AR page does not consume the public API route for its main payload

### Public and private API routes

There are three trajectory payload routes:

#### Legacy public warm-up route

`/api/public/launches/[id]/trajectory`

Returns only:

- `launchId`
- `version`
- `quality`
- `generatedAt`
- `product`

Important current behavior:

- still used by `CameraGuideButton` for warm-up
- not the main serving route for the web AR page
- served with `Cache-Control: no-store`

#### Public V2 route

`/api/public/launches/[id]/trajectory/v2`

Returns:

- the full public V2 payload

Important current behavior:

- the path sits under `/api/public`, but it still lives behind premium access
- it is public in routing shape, not in entitlement semantics
- served with `Cache-Control: no-store`

#### Premium private V1 route

`/api/v1/launches/[id]/trajectory`

Returns:

- the same public V2 payload

Important current behavior:

- requires auth and premium tier
- this is the path the mobile shared API client uses
- served with `Cache-Control: private, no-store`

### Shared client packages

Important shared contract boundaries:

- `LaunchDetailV1` embeds `arTrajectory` summary state
- `TrajectoryPublicV2ResponseV1` is the full client payload
- `ArTelemetrySessionEventV1` is the shared telemetry write contract
- entitlement contract exposes `canUseArTrajectory`

Mobile fetch path:

- `packages/api-client` exposes `getLaunchTrajectory`
- `packages/query` wraps it with query options and a `30` second stale time
- `apps/mobile/src/api/queries.ts` wires it into the mobile screen

## Web Runtime

The web runtime is the richest current AR consumer in the entire system.

### Client profiles

Detected profiles:

- `android_chrome`
- `android_samsung_internet`
- `ios_webkit`
- `android_fallback`
- `desktop_debug`
- `unknown`

Each profile has a policy with:

- `fallbackFirst`
- `preferWebXr`
- `motionPermissionPreflight`
- camera and motion hints
- profile summary text
- WebXR hint text

Important current policy differences:

- Android Chrome is WebXR-first when supported and healthy
- Samsung Internet is sensor-first unless telemetry later promotes it
- iOS WebKit is fallback-first and requests motion permission preflight
- desktop is debug-only, not a guaranteed immersive AR path

### Runtime policy overrides

The web runtime can fetch telemetry-derived runtime overrides from:

- `/api/public/ar/runtime-policy`

Current route behavior:

- reads the last `14` days of telemetry
- samples up to `800` sessions
- returns override recommendations
- caches publicly for `300` seconds

Important current behavior:

- `runtimePolicyClient` only hydrates this route for `android_chrome` and `android_samsung_internet`
- iOS and fallback profiles do not currently depend on runtime-policy fetches

### Runtime selection

`selectArRuntime` chooses:

- `poseMode`: `webxr` or `sensor_fused`
- `visionBackend`: `worker_roi`, `main_thread_roi`, or `none`
- `degradationTier`: `0` to `3`

Inputs:

- client profile
- XR support state
- XR active state
- XR launch state
- camera readiness
- camera error
- motion permission
- worker vision support
- main-thread vision support
- telemetry-recommended pose mode

Current selection behavior:

- active XR always wins
- Android Chrome and desktop debug default to WebXR preference
- telemetry can promote or demote profiles
- Samsung Internet remains sensor-first unless promoted
- iOS WebKit is always sensor-fused

Vision backend selection order:

1. `worker_roi`
2. `main_thread_roi`
3. `none`

Current degradation behavior:

- `main_thread_roi` starts at degradation tier `1`
- no vision starts at tier `2`
- camera error or motion denied forces tier `3`

### WebXR auto-start policy

Auto-start happens only when all of the following are true:

- profile is `android_chrome` or `android_samsung_internet`
- runtime policy has been hydrated
- selected pose mode is `webxr`
- XR support is `supported`
- XR is not already active
- XR launch state is not `blocked` or `starting`
- auto-start has not already been attempted

Important implication:

- the web runtime does not blindly start immersive AR on every capable device
- it requires both capability and current runtime policy state

### Performance governor

The web runtime continuously classifies performance into tiers `0` through `3`.

Classification thresholds:

- if `frameCount < 12` or average frame time is unknown: tier `0`
- tier `3` if `avgFrameMs >= 38` or severe frame ratio `>= 0.16` or slow frame ratio `>= 0.48`
- tier `2` if `avgFrameMs >= 28` or severe frame ratio `>= 0.08` or slow frame ratio `>= 0.32`
- tier `1` if `avgFrameMs >= 20` or slow frame ratio `>= 0.18`
- otherwise tier `0`

Current policy per tier:

| Tier | Reduced effects | Milestones | Lock prediction depth | Roll assist | DPR cap |
| --- | --- | --- | --- | --- | --- |
| `0` | no | full | `3` | yes | `2` |
| `1` | yes | full | `2` | yes | `2` |
| `2` | yes | major | `1` | no | `2` |
| `3` | yes | off | `0` | no | `1.35` |

Important implication:

- runtime degradation affects not just graphics, but also lock-on depth and milestone density

### Alignment feedback

The web runtime derives alignment feedback from residual samples and trajectory authority.

Outputs:

- sample counts and means
- yaw and pitch standard deviations
- residual magnitude
- stability state
- bias confidence
- recommended corridor mode
- precision readiness
- correction gain

Stability states:

- `inactive`
- `settling`
- `stable`
- `drifting`

Current trust model:

- high-trust precision requires strong authority, `qualityState = precision`, safe mode off, pad-only off, and degradation tier `<= 1`
- medium trust requires decent authority, non-pad-only quality, pad-only off, and safe mode off

Current stable residual criteria require:

- at least `5` samples
- average confidence `>= 0.78`
- standard deviations below profile-dependent thresholds
- residual means below profile-dependent thresholds

Current corridor adjustment behavior:

- no lock, pad-only, or safe mode forces `wide`
- drifting widens further
- settling widens if confidence/runtime quality is lower
- stable high-trust precision can tighten the corridor

Important implication:

- even with a "precision" contract, the web runtime can still widen behavior based on live alignment evidence

### Session status and fallback modes

`sessionStatus.ts` derives user-facing status views and telemetry entry state.

Current fallback reasons:

- `camera_denied`
- `motion_denied`
- `no_heading`
- `camera_error`

The runtime can explicitly land in:

- AR mode
- Sky Compass fallback mode

Current user-visible status cards include cases for:

- camera failure
- location missing
- sensor assist required
- trajectory below the horizon

### Web UI evidence and diagnostics

The web `ArSession` consumes the full contract and exposes far more than a simple line overlay.

It surfaces:

- quality state
- confidence badge and label
- evidence label
- guidance semantics
- source coverage
- authority tiers
- field provenance
- trust scores
- uncertainty evidence
- safe mode state
- publish-policy downgrade state
- debug traces and diagnostics snapshots

Important current strings in the user/debug experience include:

- "Guidance is widened automatically instead of claiming precision."
- "Use this as pointing guidance, not ground truth. Ascent can change after liftoff."

Important implication:

- the web runtime is explicitly built to explain uncertainty, not just to draw a predicted path

## Mobile And Native Bridge

The mobile flow is intentionally thinner than the web runtime.

### Launch detail summary

Mobile launch detail receives `arTrajectory` summary state inside `LaunchDetailV1`.

The `ArTrajectoryCard` branches on:

- entitlement state
- eligibility
- trajectory missing
- public quality state

The card is shown whenever:

- the user can use AR trajectory, or
- the launch is not eligible and the product wants to explain that state

### Full payload fetch

The mobile AR screen only fetches the full trajectory when all of these are true:

- device is native-capable
- user entitlement allows AR trajectory
- launch is eligible
- summary says a trajectory exists

This is a deliberate two-step design:

1. summary on launch detail
2. full V2 payload only when the user actually enters the AR flow

### Public V2 payload usage

The mobile AR screen receives only the public payload, not the full internal contract.

It uses fields such as:

- `qualityState`
- `guidanceSemantics`
- `trackTopology`
- `confidenceBadge`

Current mobile-specific mappings:

- `precision` -> highest render tier and `precision` overlay mode
- `safe_corridor` -> medium render tier and `guided` overlay mode
- `pad_only` -> low render tier and fallback behavior

### Native module bridge

The native module interface does not receive a structured JS object.

It receives:

- `trajectoryJson: string`
- `qualityState`

Important implication:

- mobile serializes the full V2 payload before passing it into the native bridge

### Mobile telemetry

Mobile telemetry is built from:

- native session updates
- the public trajectory payload

It is then posted through the shared API client to:

- `/api/v1/ar/telemetry/session`

Important implication:

- native telemetry writes go through the same shared telemetry schema as web
- the backend is already designed to compare evidence across web, iOS native, and Android native, even if the live dataset is still sparse

## Telemetry And Runtime Evidence

Telemetry is a first-class part of the AR trajectory system, not an optional analytics add-on.

### Shared telemetry contract

Shared schema:

- `ArTelemetrySessionEventV1`

Runtime family values:

- `web`
- `ios_native`
- `android_native`

The payload includes:

- session identity
- runtime family
- client profile and environment
- permission states
- pose mode
- vision backend
- degradation tier
- time-to-usable fields
- fallback reason
- lock-on and relocalization metrics
- trajectory quality and overlay mode

### Write routes

Routes:

- `/api/public/ar/telemetry/session`
- `/api/v1/ar/telemetry/session`

Current shared behaviors:

- payload validation against the shared contract
- time-window validation for session start/end
- AR eligibility check
- minute-level rate limit via `try_increment_api_rate`
- upsert into `ar_camera_guide_sessions`

Current rate limit:

- provider key `ar_telemetry_minute`
- `1200` per minute

### Runtime policy summarization

The runtime-policy route reads telemetry and emits profile overrides for the web runtime.

Important current behavior:

- it is web-runtime focused
- it summarizes recent experience rather than changing any stored product row

### Surface evidence utilities

`surfaceEvidence.ts` is the cross-surface evidence interpreter.

It evaluates whether a surface session:

- can claim precision
- is allowed to claim precision
- should be marked `pass`, `warn`, or `fail`

Current precision allowance logic:

- web requires `modeEntered = ar`, no fallback reason, heading ready, and a usable pose mode
- iOS native requires normal tracking, heading ready, ARKit world tracking, ready location fix, alignment ready, and acceptable world-alignment / geo-tracking state
- Android native requires normal tracking, heading ready, no fallback reason, and a supported pose mode

Important implication:

- the codebase is already prepared to treat precision as a claim that must be justified by runtime evidence, not just by the static product row

## FAA Airspace Companion Surface

The AR system also has a companion FAA airspace surface.

Server file:

- `apps/web/lib/server/faaAirspace.ts`

Public route:

- `/api/public/launches/[id]/faa-airspace-map`

What it returns:

- advisory metadata
- valid windows
- raw text URLs
- shape counts
- map polygons
- pad bounds

Important current behavior:

- this surface is adjacent to the AR system, but it is not the main trajectory contract
- it exposes public cacheable map data, unlike the no-store trajectory payload routes

## Admin And Ops Surfaces

The AR trajectory system has several admin-facing inspection tools.

### Eligible launches route

Route:

- `/api/admin/trajectory/eligible`

Purpose:

- show the currently eligible launches based on the live eligibility logic

### Product inspector route

Route:

- `/api/admin/trajectory/inspect/[id]`

Purpose:

- fetch launch row, product row, and constraints
- summarize stale or missing state
- show ops gaps
- audit pad drift against canonical LL2 pad coordinates

Important current caveat:

- this inspector is more restrictive than it looks
- it only admits launches inside the small eligibility-derived near-term set

### Source contract route

Route:

- `/api/admin/trajectory/contract/[id]`

Purpose:

- expose the latest source contract row
- flatten missing fields and blocking reasons
- expose source sufficiency diagnostics
- connect failures back to lineage rows and candidate sources

### Admin page

Page:

- `/admin/ops/trajectory`

Purpose:

- operational entry point for trajectory inspection and monitoring

### Manual sync route

Route:

- `/api/admin/sync`

Purpose:

- operator-triggered sync and follow-up controls

## Current Implementation Characteristics And Caveats

This section is about the current system as it is, not how it should ideally look.

### The serving layer is materialized, not reconstructed live

This is the biggest architectural truth of the current system.

- request-time serving reads `launch_trajectory_products`
- it does not rebuild from raw constraints for each request

### The shared domain package is the real contract source of truth

There is web-local compatibility logic, but the active server loader imports the shared domain contract builder.

### The public contract is intentionally less expressive than the web contract

Mobile and public clients do not receive:

- field-level provenance
- authority tiers
- runtime hints
- confidence badge labels

### `quality` is not a user-facing precision scale

Current generator outputs are:

- `pad_only` -> `quality = 0`
- `landing_constrained` -> `quality = 1`
- `estimate_corridor` -> `quality = 2`

This means the numeric field is not a clean "higher is more precise" ranking.

### `trackSummary.precisionClaim` is looser than the publish policy

The generator can mark `trackSummary.precisionClaim` true whenever `product.quality > 0` and confidence is not `D`.

That is broader than the strict publish notion of "precision claim", which is centered on `landing_constrained` and later publish-policy evaluation.

### `rocket_family` is effectively missing on future launch rows

This weakens:

- family-specific template matching
- envelope-profile routing
- historical clustering quality

### Template coverage is thin

The live template blob currently has only `3` keys:

- `cape|unknown|ISS_CREW`
- `unknown|unknown|SSO_POLAR`
- `vandenberg|unknown|ISS_CREW`

### The constraints table contains more than the serving model directly uses

`launch_trajectory_constraints` currently stores:

- serving-relevant orbit, landing, and hazard evidence
- additional provider and infographic metadata that are not all part of final geometry synthesis

### Scheduler labels are partially stale in admin summary

Live jobs now run on the newer hourly managed cadence, but admin summary output still advertises older schedule labels.

### Source-contract version labeling is inconsistent

Persisted contract version tags, embedded sufficiency version tags, and schema defaults are not all aligned.

### Telemetry is live but still sparse

The code is built for cross-surface runtime evidence, but the current telemetry footprint is still small and skewed toward web and iOS WebKit.

### Web is currently the richer AR consumer

Web gets:

- full contract
- field provenance
- authority trust
- runtime hints
- alignment-aware corridor behavior
- deeper diagnostics

Mobile currently gets:

- summary state on launch detail
- public V2 payload in AR
- serialized bridge handoff to native

### FAA airspace is a companion system, not the same thing as the trajectory contract

It shares evidence inputs and launch matching, but it is a separate serving surface with separate caching behavior.

## Bottom Line

The current AR trajectory system is a materialized, evidence-backed guidance pipeline with a strict publish layer on top.

What it does well today:

- ingests real upstream evidence from several sources
- stores lineage and publishability diagnostics
- materializes launch-specific trajectory products
- exposes a richer internal contract for web and a safer public contract for clients
- supports both web AR runtime logic and mobile native consumption
- records runtime evidence for later tuning and validation

What is most important to understand about the current system:

- the product row is the serving truth
- the contract layer can still downgrade that row at read time
- web and mobile do not consume the same contract depth
- the live system is mostly corridor guidance, not precision landing-constrained guidance
- telemetry and validation tooling exist, but the live evidence footprint is still relatively small

This is therefore already a full AR trajectory system, but it is a cautious one: precomputed, publish-guarded, provenance-aware, and intentionally willing to widen or downgrade rather than overclaim precision.
