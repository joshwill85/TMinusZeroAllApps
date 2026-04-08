# 2026-04-07 JEP Best-In-Class Migration Plan

Last updated: 2026-04-08

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: customer-facing JEP upgrade with web-only admin and automated calibration tooling

## Executive Verdict

The external source stack in the reviewed JEP requirements document is viable, but the document assumes a more advanced baseline than the live repo actually has.

The live public-serving stack is still running a `jep_v5` four-factor multiplicative watchability model:

- illumination
- darkness
- line of sight
- weather

It does not yet have these capabilities in public production:

- the weighted geometric mean and hard gating structure assumed by the spec
- moon/background-light inputs
- terrain/building horizon masks
- mission-specific plume priors in production
- official visibility-map ingestion
- calibrated public probability release

The right migration is therefore not "add a few missing data sources." The right migration is:

1. keep the reviewed source choices
2. add a real feature-store and provenance layer
3. introduce a shadow-scored `jep_v6` model additively
4. cut over only after score diffs, data coverage, and calibration gates are met

## 2026-04-08 Product Decision

Public `jep_v6` v1 remains an observer-aware, US-first `watchability` model, but it no longer treats fine local obstruction as part of the release-critical path.

Public v1 keeps:

- sample-based sunlit plume geometry
- observer-specific broad visibility geometry
- Earth-curvature and distance sanity gating
- trajectory elevation and line-of-sight gating
- weather/cloud obstruction
- moon and anthropogenic background-light effects
- launch-family and vehicle-prior tuning

Public v1 explicitly defers:

- local terrain masks
- local building masks
- Copernicus DEM ingestion as a release blocker
- Overture buildings ingestion as a release blocker
- GHS-OBAT backfill as a release blocker

This means the public product assumes a clean local viewing lane once the plume is broadly visible from the observer location. Broad observer geometry still blocks impossible cases such as `California` observers for `Florida` launches. Fine skyline-level obstruction does not.

The short-form decision record for this re-scope lives in `docs/2026-04-08-jep-v1-scope-decision.md`.

## Required Source Admission Gate

Every new JEP data source, ingest, or factor family must pass this gate before it is allowed onto the implementation path.

Required questions:

1. Is the data current, available, and consistently provided?
2. If so, can it be joined to our launch identity with stable keys or deterministic matching?
3. If so, in samples of our future launch inventory, do we actually have the values we need and can use?

Enforcement rule:

- if the answer is `no` at any step, do not build the ingest into the active implementation plan
- move it to `Optional / Deferred` or remove it entirely
- keep the corresponding score family neutral rather than pretending we have usable data
- passing the gate is necessary, but not sufficient; public-v1 product scope and rollout priority still decide whether a passing source is on the active build path

This gate applies to:

- new upstream APIs
- new file-based ETL
- new factor families in `jep_v6`
- mission-specific overrides such as official visibility maps or special event priors

## What The Reviewed Document Gets Right

- `JPL Horizons` is a strong primary source for observer-specific moon geometry.
- `USNO` is a practical fallback and QA source for sun/moon timing.
- `NASA Black Marble` monthly/yearly products are a good fit for stable anthropogenic background-light baselines.
- `Copernicus DEM` plus `Overture Buildings` is the right future combination for a fine local-horizon system, but that system is no longer part of the public v1 critical path.
- `LL2` should remain the launch identity and schedule feed, not the source of plume physics.
- vehicle plume behavior should come from a local curated prior table keyed to official provider docs
- upper-atmosphere/noctilucent context should remain advisory-only in v1
- official visibility maps should remain optional and penalty-only

## Corrections Required To Make It Executable In This Repo

### 1. The current scorer shape does not match the spec

The reviewed document assumes the repo already has a gated weighted geometric mean with more factor slots. It does not.

Current reality in the repo:

- `apps/web/lib/jep/serverShared.ts` computes a four-factor multiplicative score
- `supabase/functions/jep-score-refresh/index.ts` precomputes that same model
- `launch_jep_scores` persists output rows, not a generalized feature-store snapshot

Required correction:

- build `jep_v6` as a new scoring family behind shadow mode
- do not rewrite `jep_v5` in place

### 2. Trajectory coverage is the first hard bottleneck

The local current-state spec shows only `15` future launches with trajectory products out of `362` future launches. No data enhancement plan becomes "best in class" if the scorer still cannot run for most future launches.

Required correction:

- phase the rollout by launch families with usable trajectory products first
- make trajectory coverage and freshness an explicit readiness gate for `jep_v6`
- do not pretend moon/background work solves coverage where trajectory is still missing

### 3. Fine local-obstruction precision is no longer a v1 blocker

`apps/web/lib/server/jepObserver.ts` currently snaps observers to `0.1` degrees. That is still too coarse for some future high-fidelity geospatial work, but local skyline precision is no longer required for public v1.

What remains in scope for public v1:

- exact observer-aware broad geometry checks
- trajectory elevation and distance gating
- cached moon/background features with a finer derived feature cell where useful

What is now deferred:

- local building obstruction within `3-5 km`
- terrain ridgeline masking
- personalized skyline-level horizon contrast

Required correction:

- keep the current `launch_jep_scores` observer hash for backward compatibility
- continue using exact observer coordinates for transient geometry compute
- introduce a finer derived-feature cell key for `jep_v6` cached moon/background features where needed
- do not make public v1 rollout depend on fine local-obstruction bucketing

### 4. The existing `jep_profiles` table is not the target data model

The repo already has `public.jep_profiles`, but it is:

- empty
- JSON-shaped
- keyed by `vehicle_slug` and `mission_type`

That is not strong enough for the reviewed spec, which needs:

- `LL2 rocket.configuration.id` joins
- official doc provenance
- dated active ranges
- analyst confidence
- event timing priors

Required correction:

- keep `jep_profiles` untouched for compatibility
- add a structured `jep_vehicle_priors` family instead of overloading the existing table

### 5. Mobile currently underuses observer-aware JEP

`apps/mobile/src/components/launch/JepPanel.tsx` currently calls `useLaunchJepQuery(launchId, {})` without observer coordinates. A best-in-class personalized JEP stack is much less valuable if mobile stays on pad fallback most of the time.

Required correction:

- keep pad fallback for no-permission flows
- add mobile observer-aware JEP requests once location permission or a stored home location exists
- keep `/api/v1` additive so web and mobile stay aligned

### 6. The reviewed document assumes some existing factors that the repo does not have

The reviewed document says "probability of launching on time" and other non-missing factors are already present. In the live repo they are not part of the public JEP score today.

Required correction:

- do not silently scope-creep launch-go probability into the v1 data-enhancement track
- keep v1 focused on physically meaningful visibility improvements
- treat launch-go probability as a later, separate modeling track if we decide to ship it at all

### 7. The current illumination math is directionally right, but still simplified

The live repo already does the most important thing correctly: illumination and LOS are computed over trajectory samples, not from a single assumed rocket altitude.

Current reality in the repo:

- `apps/web/lib/jep/serverShared.ts` computes observer solar depression once at launch time
- it converts that to a shadow-height threshold
- it then checks each trajectory sample altitude against that threshold
- LOS is then computed only for the samples that are already sunlit

Required correction:

- keep the trajectory-sample approach; do not regress to a fixed-altitude heuristic
- upgrade `jep_v6` to evaluate solar geometry against sample time or event time, not only NET
- keep the current shadow-height approximation only as a fallback or interim model, not the final best-in-class implementation

## External Viability Checks Completed On 2026-04-07

- `JPL Horizons` docs show a live `Horizons API` at `https://ssd.jpl.nasa.gov/api/horizons.api`, support `EPHEM_TYPE='OBSERVER'`, `SITE_COORD`, `STEP_SIZE`, `TLIST`, and `CSV_FORMAT=YES`, and list API version `1.3 (2025 June)`.
- `USNO` API docs show the public Astronomical Applications API v`4.0.1`, including "Complete Sun and Moon Data for One Day" and a standard `/api/<data_service>?<parameters>` URL shape.
- `NASA Earthdata` lists `VNP46A2` as active with temporal extent `2012-01-19 to Present`; LAADS token docs explicitly require Earthdata download tokens for scripted downloads and note token expiry.
- the LAADS `VNP46A4` archive is live and exposed through the `archive/allData/5200/VNP46A4/` path, confirming the yearly fallback is real and scriptable.
- `Copernicus Data Space` documents both `COPERNICUS_30` and `COPERNICUS_90`, states they have worldwide coverage, and documents OAuth2 and S3 access patterns.
- `Overture` docs state the catalog is released monthly, distributed as `GeoParquet`, available on S3 and Azure, and the buildings theme includes both `building` and `building_part`.
- `GHS-OBAT` is live in the JRC catalog, explicitly open-access with no-auth download, but is a `2020` attribute layer and therefore suitable only as a backfill or enrichment source rather than the current building source of truth.
- `LL2` remains free at low volume, documents `mode=detailed`, `rocket__configuration__id`, and list filters needed for launch-family joins.
- `Blue Origin NG-1` and `NASA Wallops Mission Status Center` still demonstrate the existence of official public launch visibility maps or interactive visibility assets, which supports an opportunistic ingestion design.

Inference from those sources:

- the source stack is externally viable
- the main risk is not source availability
- the main risk is local architecture, feature caching, and rollout discipline
- every source still needs to pass the required source-admission gate before it becomes implementation work

## Source Dependency Matrix

Classification rule:

- `Go` means the source already clears the required source-admission gate for public-v1 implementation
- `Go With Account` means it clears the gate once account setup is complete
- `Optional / Deferred` means it is externally real but does not yet clear the gate for active build-out
- `Do Not Depend On` means it fails the gate for public-v1 dependency purposes

### Go

- `LL2` for launch identity, launch windows, pad coordinates, and `rocket.configuration.id` joins
- `JPL Horizons` for observer-specific moon geometry and ephemerides
- `USNO` for sun/moon fallback and QA
- official provider documentation and public mission references for curated vehicle-prior authoring
- current weather stack already in repo for observer/path cloud and obstruction inputs

### Go With Account

- `NASA Black Marble` monthly and yearly products via Earthdata and LAADS tokenized download

### Optional / Deferred

- official visibility maps published by providers or agencies
- `Copernicus DEM` for a future local terrain-masking track
- `Overture Buildings` and `building_part` for a future local building-masking track
- `GHS-OBAT` as missing-height backfill only
- mission-specific special event priors such as relights, venting, or tracer-like releases unless a source proves current, joinable, and present at useful future-launch coverage
- `VNP46A2` daily Black Marble product after the monthly/yearly path is stable
- automated media and image evidence collection for later calibration
- upper-atmosphere or noctilucent context as advisory enrichment only

### Do Not Depend On

- `LL2 timeline` as a required plume-timing source
- `LL2 probability` as a required model input
- `LL2 weather_concerns` as a required model input
- manual analyst import as a required steady-state operating model
- official visibility maps as a guaranteed launch-by-launch feed
- upper-atmosphere or space-weather products as a core v1 scoring dependency
- local terrain/building obstruction as a core public-v1 scoring dependency
- any public `probability` release before automated evidence volume exists

## Current Source Admission Decisions

| Source or factor family | Q1: current, available, consistent | Q2: joinable to our launch identity | Q3: usable values in future-launch samples | Outcome | Notes |
| --- | --- | --- | --- | --- | --- |
| `LL2` launch identity fields | Yes | Yes | Yes | Pass now | Use for pad, windows, `rocket.configuration.id`, and soft orbit family |
| `LL2 timeline`, `probability`, `weather_concerns` | No | Partly | No | Reject as core dependency | Sparse or absent in the US future-launch sample |
| `JPL Horizons` moon ephemerides | Yes | Yes | Yes | Pass now | Primary moon source for observer-specific geometry |
| `USNO` sun/moon QA | Yes | Yes | Yes | Pass now | Fallback and QA source, not the primary ephemeris engine |
| current weather stack | Yes | Yes | Yes | Pass now | Already integrated and aligned with observer-aware scoring |
| `NASA Black Marble` monthly/yearly | Yes with account | Yes | Yes | Pass with account | Good fit for stable background-light baselines |
| curated vehicle priors from official provider docs | Yes for supported US families | Yes | Yes | Pass now | Curated authoring keyed to `LL2 rocket.configuration.id`, not a generic auto-ingest feed |
| official visibility maps | No | Yes when present | No | Defer optional-only | Real but inconsistent and sparse across future launches |
| mission-specific special-event priors | No | Sometimes | No | Defer and keep neutral | Interesting, but not consistently provided in usable future-launch coverage |
| `Copernicus DEM` | Yes | Yes | Yes | Pass but deferred by scope | Technically viable, but not part of the public-v1 critical path |
| `Overture Buildings` | Yes | Yes | Yes | Pass but deferred by scope | Technically viable, but intentionally deferred with local obstruction |
| `GHS-OBAT` | Partly | Yes | Partly | Defer backfill-only | Open and usable as enrichment, but too stale to anchor production truth |

## LL2 Dependency Audit For US Launches

Live audit run on `2026-04-07` against `LL2 2.3.0` detailed future launches filtered to current US launch locations.

US launch locations returned by LL2:

- Kennedy Space Center, FL
- Cape Canaveral SFS, FL
- Vandenberg SFB, CA
- SpaceX Starbase, TX
- plus lower-volume US ranges such as Wallops, Spaceport America, and Pacific Spaceport Complex

Observed field coverage in the first `100` future US launches:

- `pad.latitude`: `100 / 100`
- `pad.longitude`: `100 / 100`
- `window_start`: `100 / 100`
- `window_end`: `100 / 100`
- `last_updated`: `100 / 100`
- `rocket.configuration.id`: `100 / 100`
- `rocket.configuration.full_name`: `100 / 100`
- `mission.orbit.name`: `97 / 100`
- `timeline`: `5 / 100`
- `info_urls`: `8 / 100`
- `vid_urls`: `5 / 100`
- `probability`: `0 / 100`
- `weather_concerns`: `0 / 100`

Observed state mix in that same sample:

- Florida: `55`
- California: `36`
- Texas: `2`
- other US ranges: `7`

Operational conclusion:

- LL2 is strong enough to anchor the v1 US launch identity layer: launch window, pad coordinates, vehicle config join, and orbit family.
- LL2 is not strong enough to be a core source for plume timing details, visibility maps, launch-go probability, or weather narrative fields.
- `timeline`, `probability`, and `weather_concerns` should therefore be treated as opportunistic metadata only, not required model inputs.
- `rocket.configuration.id` is the critical join key for structured vehicle priors and is present at the coverage level we need for a US-first rollout.
- `mission.orbit` is good enough to use as a soft family feature, but not good enough to be the only mission classifier.
- mission-specific special-event data does not currently clear the required source-admission gate for public-v1 build-out, because it is not consistently provided across the future US launch inventory.

Repo alignment check:

- `supabase/functions/_shared/ll2Ingest.ts` already maps the fields we need for this US-first plan, including `ll2_rocket_config_id`, `mission_orbit`, `launch_info_urls`, `launch_vid_urls`, `probability`, `weather_concerns`, and `timeline`.
- `docs/data-map.md` already treats `ll2_rocket_config_id` as the intended relational join path.
- the repo architecture therefore supports the right LL2 usage pattern already; the main change is which fields we trust versus ignore.

## Real-World Acceptance Rules Before Implementation Commitment

Because we do not expect a meaningful labeled outcome set before the next few months, `jep_v6` must be judged first as a physically grounded watchability system, not as a released probability system.

Required behavioral rules:

- if the plume corridor never becomes sunlit above the Earth shadow, the score must stay low even if weather and darkness are favorable
- if the observer never gets a broadly visible plume corridor because of Earth-curvature, distance, or trajectory geometry, the score must stay low even if weather and darkness are favorable
- worsening cloud obstruction, brighter moonlight, brighter anthropogenic background, or worse broad geometry must never increase the score
- full moon and bright city glow should reduce visibility potential, but should not hard-zero an otherwise strong twilight geometry case
- missing trajectory products must reduce eligibility or confidence; the model must not invent a detailed plume geometry from weak metadata
- official visibility maps may reduce over-optimistic outputs when present, but may not override impossible geometry or become a required dependency
- the public product should stay in `watchability` mode until we have real automated evidence volume; probability mode should not be a launch blocker for the physical upgrade
- public v1 intentionally assumes a clean local viewing lane once the plume is broadly visible from the observer location

Required scenario tests:

- strong negative control: midday launch with no sunlit high-altitude plume should score near the floor
- strong positive control: clear twilight launch with favorable sunlit plume geometry, good broad observer geometry, and good weather should score near the top band
- moon/background penalty case: the same geometry under full moon and heavy urban glow should score materially lower, but not collapse to zero
- impossible-observer case: a `California` observer for a `Florida` launch should score near the floor because no broadly visible corridor exists
- state realism case: similar solar geometry should not produce identical scores for Florida, Texas, and California if trajectory family, coastal horizon, and background-light conditions differ

Human-sanity review rule:

- for every rollout family we should be able to explain the score in plain English without using internal factor names alone; if the explanation does not sound credible to a knowledgeable launch watcher, the model is not ready

## US-First Rollout Constraint

The first public-quality target should be US launches only, centered on the families and ranges that matter most here:

- Florida: Cape Canaveral SFS and Kennedy Space Center
- California: Vandenberg SFB
- Texas: Starbase, treated as its own special family rather than assumed equivalent to Falcon flights

Implications:

- Florida and California should be the first fully supported states because cadence is highest and LL2 identity coverage is strongest.
- Texas should still be included in v1 planning, but with explicit family-specific priors and stricter trajectory-readiness rules because `Starship` visibility behavior is materially different from Falcon-class launches.
- do not broaden to non-US launches until the US-first scenario tests and shadow comparisons look sane.

## Target Architecture

### Source ingestion tier

Use scheduled ETL and object storage for raw heavy assets. Do not fetch large remote assets inside the request path or inside the hot scoring loop.

Recommended raw-source buckets and registries:

- `jep_source_versions`
- `jep_source_fetch_runs`
- object-storage prefixes for `horizons/`, `black-marble/`, `visibility-maps/`
- optional deferred prefixes for `cop-dem/` and `overture/` if the local-obstruction track is resumed later

### Derived feature tier

Persist launch/observer features separately from final scores.

Recommended new derived tables:

- `jep_moon_ephemerides`
- `jep_background_light_cells`
- `jep_vehicle_priors`
- `jep_visibility_maps`
- `jep_visibility_map_zones`
- `jep_feature_snapshots`

Deferred local-obstruction tables:

- `jep_horizon_masks`

Deferred only if the source-admission gate is later satisfied:

- `jep_special_event_priors`

### Scoring tier

Keep `launch_jep_scores` as the public-serving output table for now, but make `jep_v6` read from `jep_feature_snapshots` rather than recomputing every feature ad hoc.

Required scoring properties:

- hard gating for physically impossible cases
- weighted geometric mean for the active factor family
- explicit model versioning
- additive provenance and confidence payload
- shadow mode before cutover

### API and surface tier

- keep `/api/v1/launches/[id]/jep` additive
- web, iOS, and Android should all consume the same payload family
- admin QA for visibility maps and priors remains web-only

### Calibration tier

- keep public JEP in `watchability` mode through the first data-enhanced rollout
- only move public probability to ready after labeled outcomes and reliability metrics are in place

## Phased Implementation Plan

### Phase 0: Lock the executable target and coverage gates

Duration: `2-3 days`

Owners:

- backend
- data engineering
- modeling

Deliverables:

- freeze the `jep_v6` model contract in docs
- define the first launch-family rollout set based on real trajectory availability
- define the observer-resolution strategy for derived geospatial features
- record the source-admission decision for every proposed new ingest or factor family
- add explicit settings for `jep_v6_shadow_enabled`, `jep_v6_public_enabled`, and source-refresh toggles

Acceptance criteria:

- there is a written `jep_v6` factor map and gate definition
- trajectory coverage thresholds are written down and tied to rollout eligibility
- we have chosen the observer feature-cell strategy for cached v6 features and documented why broad geometry does not require a local skyline system in public v1
- every planned new ingest has an explicit `pass/defer/reject` decision against the required source-admission gate

Rollback boundary:

- docs and settings only

### Phase 1: Build the data foundation and provenance layer

Duration: `4-7 days`

Owners:

- backend
- data engineering

Deliverables:

- additive Supabase migrations for raw-source registries and derived feature tables
- storage layout for raw HDF5, launch metadata, and visibility assets
- `jep_source_versions` and `jep_feature_snapshots` model
- ETL job skeletons with no public scoring cutover

Repo touch points:

- `supabase/migrations/*`
- new `supabase/functions/jep-*`
- `apps/web/lib/server/jep.ts`
- `supabase/functions/jep-score-refresh/index.ts`

Implementation rules:

- no new source or factor family enters this phase unless it passes the required source-admission gate
- if a proposed source fails on current availability, launch joinability, or future-launch coverage, do not scaffold production ingest for it

Acceptance criteria:

- raw-source provenance can answer "which release/file/query built this feature row?"
- heavy source files are stored outside Postgres
- current `jep_v5` path remains untouched for public reads

Rollback boundary:

- additive tables and jobs can be disabled without affecting `jep_v5`

### Phase 2: Ship moon and anthropogenic-background features

Duration: `3-5 days`

Owners:

- backend
- data engineering

Deliverables:

- Horizons client and cache for observer-specific moon ephemerides
- USNO fallback and QA tooling
- monthly `VNP46A3` ETL plus yearly `VNP46A4` fallback ETL
- derived `s_moon`, `s_anthro`, and `s_background` feature generation

Implementation rules:

- no runtime LAADS or Horizons dependency in the request path
- store full upstream query strings or file references for replay
- keep `VNP46A2` out of the critical path initially

Acceptance criteria:

- a launch/observer feature snapshot can include moon and background-light terms with source provenance
- monthly background ETL is repeatable without manual intervention
- missing moon/background data degrades confidence, not correctness semantics

Rollback boundary:

- moon and background features can be excluded from the shadow scorer without removing ETL assets

### Phase 3: Ship structured vehicle priors and the `jep_v6` shadow scorer

Duration: `5-8 days`

Owners:

- modeling
- backend

Deliverables:

- structured `jep_vehicle_priors` tables keyed to `LL2 rocket.configuration.id`
- gated weighted geometric mean implementation in a new `jep_v6` scorer
- side-by-side `jep_v5` versus `jep_v6_shadow` comparison outputs

Implementation rules:

- do not reuse `jep_profiles` as the primary structured store
- do not publish `jep_v6` publicly in this phase
- keep launch-go probability out of scope unless separately approved
- keep mission-specific special-event priors out of scope unless they later pass the required source-admission gate

Acceptance criteria:

- `jep_v6_shadow` runs for eligible launches without breaking the public API
- score diffs between `jep_v5` and `jep_v6_shadow` are stored and reviewable
- every prior row has a source-doc URL, revision marker, confidence, and active date range

Rollback boundary:

- shadow scorer can be turned off by setting without affecting public `jep_v5`

### Phase 4: Add optional official visibility-map ingestion and analyst QA

Duration: `4-6 days`

Owners:

- backend
- web admin/internal
- data operations

Deliverables:

- mission-page asset fetcher and asset hash tracking
- raw image storage and georeference metadata
- web-only analyst QA flow for map verification
- penalty-only `m_vismap` modifier in `jep_v6`

Implementation rules:

- never allow official maps to override impossible geometry
- never use a map in scoring without QA or a high automated georef quality threshold
- keep this phase optional per launch

Acceptance criteria:

- maps can be attached to launches with zone metadata and analyst status
- `jep_v6` only applies a penalty when a map is present and validated
- missing maps are represented as unavailable, not negative evidence

Rollback boundary:

- map modifier can be turned off without losing ingested assets

### Phase 5: Roll out additive API and three-surface behavior

Duration: `4-7 days`

Owners:

- web
- mobile
- backend

Deliverables:

- additive `/api/v1` fields for new factors, provenance, and confidence
- web launch detail support for the richer JEP breakdown
- mobile JEP requests with observer coordinates when permission or stored location exists
- admin/internal dashboards for source freshness, shadow-score coverage, and QA state

Implementation rules:

- keep customer payloads shared across web, iOS, and Android
- keep analyst tooling web-only
- preserve pad fallback when observer context is unavailable

Acceptance criteria:

- web, iOS, and Android all render the same `jep_v6` payload family
- mobile can request observer-aware JEP rather than always defaulting to pad fallback
- no breaking `/api/v1` contract changes are introduced

Rollback boundary:

- surfaces can continue serving `jep_v5` while the richer payload stays dark

### Phase 6: Calibrate outcomes and decide public cutover

Duration: `2-4 weeks` initial calibration work, then ongoing

Owners:

- modeling
- backend
- product/ops

Deliverables:

- automated `jep_outcome_reports` intake pipeline
- historical sighting and evidence pipeline driven by machine-collected signals
- reliability evaluation for the `jep_v6` probability layer
- model card and release checklist for public probability mode

Implementation rules:

- keep public mode in `watchability` until calibration thresholds are met
- do not depend on manual labeling as the primary calibration path
- generate labels from automated evidence collection, then treat them as confidence-weighted observations rather than perfect ground truth
- human review should be optional exception handling for disputed or high-value launches, not a required steady-state workflow

Recommended automation sources:

- public image and video discovery tied to launch time and geography
- automated media/social search for launch-specific sighting evidence
- image/video classifiers that detect likely twilight plume signatures
- geotime consistency checks against launch NET, observer region, and solar geometry
- negative-evidence windows where broad public coverage exists but no credible sightings are found
- source-reputation weighting so official or trusted evidence counts more than weak social chatter

Acceptance criteria:

- automated labeled outcome counts meet the configured threshold
- ECE and Brier meet the readiness thresholds
- public cutover decision is documented with a rollback path

Rollback boundary:

- public probability mode remains disabled until we explicitly flip it

### Deferred Track: Local obstruction system after public v1

This is no longer on the public v1 critical path.

If the local-obstruction track returns later, it should use:

- `Copernicus DEM` for terrain
- `Overture buildings` and `building_part` for current built obstruction
- `GHS-OBAT` only as a backfill for missing heights
- precomputed masks outside the request path
- the same required source-admission gate before any ingest is built out
- a separate operator and product decision, not a silent extension of public v1

## Current Repo Status On 2026-04-08

Already implemented behind dark flags or additive tables:

- `jep_source_versions`, `jep_source_fetch_runs`, and `jep_feature_snapshots`
- `jep_moon_ephemerides` plus the Horizons and USNO-backed moon refresh path
- `jep_background_light_cells` plus the Black Marble refresh path
- `launch_jep_score_candidates` and the first shadow `jep_v6` candidate write path
- moon/background feature snapshots and shadow-score persistence plumbing

Implemented in repo but now deferred by public-v1 scope:

- `jep_horizon_masks`
- local-horizon feature snapshots
- horizon-aware branches in the shadow scorer

Not yet implemented for the active public-v1 path:

- `jep_vehicle_priors`
- vehicle-prior integration into the shadow scorer
- additive `/api/v1` exposure of richer `jep_v6` payloads
- public cutover logic
- automated evidence intake and calibration reporting

Practical reading of this status:

- Phase 1 and Phase 2 are substantially underway in code, though still dark-gated
- the local-obstruction prototype exists, but it is no longer a release blocker
- the next active blocker is not another source ingest; it is model specificity through vehicle priors

## Active Next Implementation Slice

The next implementation slice should be the minimum work needed to make the shadow model materially smarter for US launches without reopening deferred scope.

Build next:

- `jep_vehicle_priors` keyed to `LL2 rocket.configuration.id`
- initial curated rows for the US-first families:
  - Florida Falcon 9
  - California Falcon 9
  - Falcon Heavy
  - Starship / Starbase
- shadow-scorer integration for the `mission_profile` family
- analyst-readable score-diff review for Florida, California, and Texas launch families

Do not build in this slice:

- mission-specific special-event priors
- Copernicus or Overture ingest expansion
- public API read-path cutover
- probability-mode work

Expected outcome of this slice:

- `jep_v6_shadow` stops behaving like a mostly generic geometry/weather model
- Florida, California, and Texas launches can diverge for defensible family-level reasons
- the next customer-facing step can be evaluated from real shadow diffs rather than speculation

## Vehicle Priors Execution Checklist

This is the concrete checklist for the next active implementation slice.

### Scope lock

- key all priors by `launches.ll2_rocket_config_id`
- do not key the primary model by free-text vehicle names
- keep the first shipping scope to the US-first launch families only

### Initial family set

- Florida Falcon 9
- California Falcon 9
- Falcon Heavy
- Starship / Starbase

### Required evidence standard for each prior row

- one official provider or agency source URL
- a human-readable rationale for why that family should differ materially in JEP watchability
- an explicit confidence level
- an active date range or revision marker

### Minimum row shape to implement first

- `ll2_rocket_config_id`
- `family_key`
- `family_label`
- `source_url`
- `source_title`
- `source_revision`
- `active_from`
- `active_to`
- `confidence`
- `notes`
- numeric priors needed by the shadow scorer for the first `mission_profile` pass

### First-pass modeling rule

- only encode broad family-level watchability differences that are stable enough to defend in plain English
- do not try to smuggle mission-specific events into these rows
- do not add factors that require a new ingest or unavailable telemetry

### Join and coverage checks before coding

- confirm the target US-first future launches have `ll2_rocket_config_id`
- confirm the first family set covers a useful share of Florida, California, and Texas launches
- if a family cannot be keyed cleanly by `ll2_rocket_config_id`, do not include it in the first pass

### Explicit non-goals for this slice

- no mission-specific special-event priors
- no launch-go probability modeling
- no local-obstruction weighting
- no public read-path change
- no automatic scraping pipeline for prior authoring

### Exit gate for this slice

- `jep_vehicle_priors` exists and is seeded for the first family set
- the shadow scorer consumes the `mission_profile` family with non-neutral values where priors exist
- score diffs are reviewable by launch family
- launches with no prior row remain valid and neutral rather than failing closed

## Recommended Rollout Order

1. Phase 0 and Phase 1 first.
2. Phase 2 and Phase 3 next, because they materially improve the physically grounded shadow model without expanding public scope.
3. Phase 4 only after the core shadow scorer is already producing sane outputs.
4. Phase 5 after backend shadow coverage is adequate.
5. Phase 6 only after real automated evidence exists.
6. Revisit the deferred local-obstruction track only after the public US-first `watchability` rollout is stable.

## Explicit Non-Goals For The First Cut

- no direct launch-day upstream fetches in the customer request path
- no attempt to make upper-atmosphere/noctilucent context a live weighted production factor
- no silent promotion of heuristic probability to public-ready probability
- no local terrain/building obstruction modeling in the public v1 score
- no `Copernicus DEM`, `Overture`, or `GHS-OBAT` dependency on the public v1 critical path
- no new ingest build-out for sources that fail the required source-admission gate
- no one-step replacement of `jep_v5`

## Verification Plan

Implementation verification must run under the pinned repo toolchain, not the current shell.

Required repo checks after implementation work:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Required targeted JEP checks:

- source-ingest replay tests for Horizons, Black Marble, LL2 joins, and visibility-map assets
- scorer golden tests comparing `jep_v5` and `jep_v6_shadow`
- observer-geometry regression tests so impossible observer/launch pairs remain blocked
- mobile and web contract tests confirming additive `/api/v1` compatibility
- calibration-readiness checks before any public probability cutover
- local-obstruction ingest tests only if the deferred track is resumed

## Known Environment Blocker

Current shell state during this planning pass:

- Node: `25.8.0`
- npm: `11.11.0`

`npm run doctor` currently fails because the repo requires:

- Node `20.19.6`
- npm `10.8.2`

That does not block this plan document, but it does block final implementation verification until the shell is switched back to the pinned toolchain.

## External Sources Reviewed

- JPL Horizons API docs: `https://ssd-api.jpl.nasa.gov/doc/horizons.html`
- USNO Astronomical Applications API docs: `https://aa.usno.navy.mil/data/api`
- NASA Black Marble project: `https://www.earthdata.nasa.gov/data/projects/black-marble`
- NASA Earthdata VNP46A2 product page: `https://www.earthdata.nasa.gov/es/data/catalog/laads-vnp46a2-2`
- LAADS Earthdata token docs: `https://ladsweb.modaps.eosdis.nasa.gov/learn/download-files-using-edl-tokens/`
- LAADS VNP46A4 archive root: `https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4/`
- Copernicus DEM docs for the deferred local-obstruction track: `https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM.html`
- Copernicus auth docs for the deferred local-obstruction track: `https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/Authentication.html`
- Copernicus S3 access docs for the deferred local-obstruction track: `https://documentation.dataspace.copernicus.eu/APIs/S3.html`
- Overture cloud sources docs for the deferred local-obstruction track: `https://docs.overturemaps.org/getting-data/cloud-sources/`
- Overture buildings guide for the deferred local-obstruction track: `https://docs.overturemaps.org/guides/buildings/`
- GHS-OBAT dataset page for the deferred local-obstruction track: `https://data.jrc.ec.europa.eu/dataset/f41a22f1-5741-4c41-86eb-6384654f6927`
- LL2 home page: `https://thespacedevs.com/llapi`
- LL2 launches docs: `https://ll.thespacedevs.com/2.3.0/launches/?format=api`
- Blue Origin NG-1 mission page: `https://www.blueorigin.com/missions/ng-1`
- NASA Wallops Mission Status Center page: `https://www.nasa.gov/image-article/wallops-mission-status-center/`
