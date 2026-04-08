# JEP System Deep Dive

Date: 2026-04-07

## Purpose

This document describes the current Jellyfish Exposure Potential (JEP) system exactly as it exists in the repo and in production data today.

This is not a proposal document. It covers:

- the live scoring algorithm
- the live weather and geometry methods
- the persistence schema
- the refresh and personalization flows
- the API and client surfaces
- the readiness and probability gating logic
- the current live data coverage and populated fields
- what exists in the repo but is not currently part of the live JEP scorer

Primary implementation files:

- `apps/web/lib/jep/serverShared.ts`
- `apps/web/lib/jep/weather.ts`
- `apps/web/lib/server/jep.ts`
- `apps/web/lib/jep/guidance.ts`
- `apps/web/lib/jep/readiness.ts`
- `apps/web/lib/server/jepObserver.ts`
- `supabase/functions/jep-score-refresh/index.ts`
- `supabase/migrations/20260303000100_jep_core.sql`
- `supabase/migrations/20260303000500_jep_observer_v2.sql`
- `supabase/migrations/20260303173000_jep_v3_accuracy_fields.sql`
- `supabase/migrations/20260311143000_jep_weather_layers_v4.sql`
- `supabase/migrations/20260311190000_jep_weather_obstruction_v5.sql`
- `apps/web/components/JepScorePanel.tsx`
- `apps/mobile/src/components/launch/JepPanel.tsx`

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Customer-facing: yes

## Executive Summary

The current live JEP system is a multiplicative four-factor model:

```text
score = round(illumination_factor * darkness_factor * los_factor * weather_factor * 100)
```

It is not yet a calibrated public probability system in the strict statistical sense.

The repo does compute and store a `probability` value, but public presentation is gated by readiness checks. If readiness is not met, the API returns `mode: "watchability"` and clients foreground the 0-100 score instead of the probability.

The current scorer is built around:

- twilight geometry
- plume sunlit overlap
- line-of-sight visibility from the observer
- weather degradation from layered cloud cover and obstruction

It does not currently use:

- vehicle-specific plume priors
- mission-orbit priors
- launch-go probability
- WS45 launch-day POV directly
- terrain horizon masks
- moonlight or light pollution
- calibrated outcome training

## High-Level Architecture

The JEP system has four major layers:

1. Score production
   - `supabase/functions/jep-score-refresh/index.ts`
   - precomputes rows for the launch pad plus a limited set of observer-registry buckets

2. On-demand personalization
   - `apps/web/lib/server/jep.ts`
   - computes transient personalized rows for explicit query/body observers when allowed

3. Public read and presentation
   - `apps/web/app/api/public/launches/[id]/jep/route.ts`
   - `apps/web/app/api/v1/launches/[id]/jep/route.ts`
   - `apps/web/components/JepScorePanel.tsx`
   - `apps/mobile/src/components/launch/JepPanel.tsx`

4. Persistence and gating
   - `launch_jep_scores`
   - `jep_observer_locations`
   - `system_settings`
   - `jep_outcome_reports`

## End-to-End Runtime Flow

### 1. Launch detail page or API request asks for JEP

Web and API callers eventually call `fetchLaunchJepScore()` in `apps/web/lib/server/jep.ts`.

The system attempts to resolve an observer from:

- URL query params
- POST body
- request headers

Observer normalization happens in `apps/web/lib/server/jepObserver.ts`.

Current surface behavior differs slightly:

- the web launch detail page can start with header-derived observer context on the server
- the web client can then refine with browser geolocation via `apps/web/components/JepScoreClient.tsx`
- the current mobile `JepPanel` requests JEP without passing observer coordinates, so it currently reads the default non-explicit path unless another layer injects observer context upstream

### 2. Observer location is bucketed and hashed

Observer buckets are snapped to 0.1 degrees:

- latitude bucket
- longitude bucket

The bucket pair is hashed with SHA-256 and truncated to 24 hex chars.

This means the live JEP system does not score exact lat/lon. It scores a rounded bucketed observer location.

### 3. The server checks readiness and public visibility

`loadJepVisibilityGate()` in `apps/web/lib/server/jep.ts` reads `system_settings` and derives:

- whether JEP is publicly visible at all
- whether probability mode is allowed
- whether transient personalization is enabled

The readiness calculation is in `apps/web/lib/jep/readiness.ts`.

### 4. The server tries to load a stored JEP row

Lookup order:

1. observer-specific row from `launch_jep_scores`
2. pad fallback row from `launch_jep_scores`
3. legacy row without observer key

The read path is backward-compatible with older schema versions. It tries:

- weather-layer extended columns
- extended columns without weather layers
- base columns only

If extended explainability fields do not exist, it synthesizes defaults on read.

### 5. If allowed, the server may compute a transient personalized row

This only happens when all of these are true:

- the request includes an explicit observer from query/body
- transient personalization is enabled in settings
- the row is missing or stale
- the row is not snapshot-locked
- the launch is still in the future
- a trajectory product exists

Transient compute is rate-limited and deadline-bounded.

Important current behavior:

- header-derived location alone does not unlock transient compute
- query/body observers do
- transient compute timeout is 750 ms
- successful transient rows may be persisted for `source: "provided"` observers within 24 hours of launch

### 6. The response is mapped to a public `LaunchJepScore`

The mapped payload includes:

- score
- probability
- readiness
- factors
- confidence fields
- explainability
- weather details
- observer metadata
- guidance outputs
- trajectory evidence summary

The public response shape is defined in `apps/web/lib/types/jep.ts` and mirrored into contracts consumed by web and mobile.

## Core Scoring Model

The live score formula is:

```text
score = round(illumination * darkness * line_of_sight * weather * 100)
```

Each factor is clamped to the range `[0, 1]`.

The weighted contribution labels shown to users are:

- illumination: 35%
- darkness: 25%
- line of sight: 25%
- weather: 15%

These weights are not applied as additive weights in the score equation. The actual score is multiplicative. The 35/25/25/15 split is used for explainability and contribution display.

## Score Inputs

### Launch inputs used now

Used directly by the current scorer:

- `launch_id`
- `net`
- `net_precision`
- `pad_latitude`
- `pad_longitude`
- `pad_country_code`

Loaded by refresh, but not used by the scorer itself:

- `mission_orbit`
- `vehicle`
- `rocket_family`

### Trajectory inputs used now

The scorer requires a trajectory product. No trajectory means no computed score row.

Used directly:

- `product.samples`
- `product.events`
- `confidence_tier`

The scorer parses:

- sample time since launch
- latitude
- longitude
- altitude
- downrange
- azimuth

If a sample does not include direct geodetic coordinates but does include ECEF coordinates, the scorer converts ECEF to geodetic before continuing.

### Weather inputs used now

Used directly:

- Open-Meteo cloud cover total
- Open-Meteo low cloud cover
- Open-Meteo mid cloud cover
- Open-Meteo high cloud cover
- NWS sky cover
- NWS ceiling

Fetched but not used in the live scorer:

- Open-Meteo visibility
- NWS visibility
- NWS wind
- other NWS grid fields beyond sky cover and ceiling

### Observer inputs used now

- bucketed latitude
- bucketed longitude
- observer source

Observer source affects:

- whether transient compute is allowed
- whether guidance can be personalized
- whether the system may fall back to pad geometry

## Exact Geometry Method

### Time window considered

JEP scoring only considers trajectory samples between:

- `T+60s`
- `T+SECO` if a SECO event exists
- otherwise up to the end of the track

The final end time is clamped into `[180s, 1200s]`.

### Solar depression

The scorer computes observer-side solar depression using `solarDepressionDegrees()`.

Convention in this codebase:

- positive value means Sun below the horizon
- negative value means Sun above the horizon

### Shadow height approximation

The current live scorer does not perform a full Earth-shadow cylinder or ray test.

It uses this approximation:

```text
shadow_height_km = (R_earth + 12 km) / cos(gamma) - R_earth
```

Where:

- `R_earth = 6371 km`
- `gamma = max(0, solar_depression_deg)`
- the `12 km` offset is `SHADOW_H0_KM`

Any sample above `shadow_height_km` is treated as sunlit.

### Sample weighting

Samples are weighted:

- normal weight: `1`
- boosted weight: `2` for samples from `T+150s` to `T+300s`

That boosted band is reused by illumination, LOS, and scenario guidance.

## Illumination Factor

`illumination_factor` is the weighted fraction of scored samples that are above the modeled shadow height.

Exact method:

1. iterate filtered samples
2. ignore samples before `T+60` or after end of jellyfish window
3. compute weight `2` for `150 <= tPlusSec <= 300`, else `1`
4. mark sample lit if `alt_km > shadow_height_km`
5. factor = `lit_weight / total_weight`

Stored companion metric:

- `sunlit_margin_km`

That value is the weighted average of `(altitude_km - shadow_height_km)` across sunlit samples only, clamped to `[0, 2000]`.

## Darkness Factor

`darkness_factor` is not continuous. It is a bucketed function of solar depression.

Exact mapping:

- `depression < 0`: `0`
- `0 <= depression < 3`: `0.3`
- `3 <= depression < 6`: `0.8`
- `6 <= depression < 12`: `1.0`
- `12 <= depression <= 18`: `0.6`
- `depression > 18`: `0.1`

This means the current live sweet spot is effectively nautical twilight, with some tolerance into civil and astronomical twilight.

## Line-of-Sight Factor

`los_factor` is the weighted fraction of sunlit samples that are at least 5 degrees above the observer's horizon.

Exact method:

1. iterate filtered samples
2. ignore non-sunlit samples
3. compute elevation from observer using ECEF conversion
4. count sample visible if `elevationDeg >= 5`
5. factor = `visible_weight / total_weight`

Stored companion metric:

- `los_visible_fraction`

In the current system, `los_factor` and `los_visible_fraction` are effectively the same number.

## Weather Model

The live JEP weather term has three layers:

1. raw layered cloud penalty fallback
2. contrast factor
3. obstruction factor

The final weather score is multiplicative where possible and then floored.

### Weather source resolution

For every JEP computation, the system resolves weather at:

- the observer point
- the pad point
- up to three plume-path sample points

Path sample roles:

- `path_start`
- `path_mid`
- `path_end`

The sampling plan is derived from the trajectory:

- use visible path if visible samples exist
- else use sunlit path
- else use the modeled ascent path

### Open-Meteo use

The live scorer fetches:

- `cloud_cover`
- `cloud_cover_low`
- `cloud_cover_mid`
- `cloud_cover_high`
- `visibility`

But only the cloud cover fields are used by the scorer today.

The fetch horizon is 16 days.

US launches may try a configured list of models. Current defaults are:

- `best_match`
- `gfs_seamless`

### NWS use

For US locations, the live scorer:

1. resolves `/points/{lat},{lon}`
2. caches the gridpoint metadata in `nws_points`
3. fetches the `forecastGridData` URL
4. samples two grid fields near the target launch time:
   - `skyCover`
   - `ceiling`

Current JEP does not use:

- NWS visibility
- NWS precipitation probability
- NWS wind

### Weather factor fallback

If no obstruction or contrast signal is available, the scorer falls back to the simpler layered cloud factor from `deriveJepWeatherImpact()`.

### Raw layered fallback factor

This factor is computed from layered Open-Meteo cloud cover.

Penalty weights:

- low cloud weight: `0.85`
- mid cloud weight: `0.50`
- high cloud weight: `0.25`
- total cloud weight:
  - `0.20` when detailed mid/high layers exist
  - `0.55` when only total/low are effectively available

Penalty ramps:

- low cloud: starts at `10%`, saturates at `90%`
- mid cloud: starts at `20%`, saturates at `95%`
- high cloud: starts at `30%`, saturates at `100%`
- total cloud:
  - detailed mode: starts at `60%`, saturates at `100%`
  - fallback mode: starts at `25%`, saturates at `95%`

Factor:

```text
weather_layer_factor = clamp(1 - combined_penalty, 0, 1)
```

### Contrast factor

This models how much the sky background softens the plume.

Contrast weights:

- low cloud: `0.18`
- mid cloud: `0.34`
- high cloud: `0.28`
- total cloud:
  - `0.16` with detailed layers
  - `0.30` in fallback mode

Penalty ramps:

- low cloud: `35% -> 100%`
- mid cloud: `25% -> 100%`
- high cloud: `30% -> 100%`
- total cloud:
  - detailed mode: `65% -> 100%`
  - fallback mode: `35% -> 100%`

Combined penalty is clamped to `0.82`.

Factor:

```text
contrast_factor = clamp(1 - combined_penalty, 0.18, 1)
```

### Obstruction factor

This models whether the path is blocked by sky cover and ceiling.

Sky-cover penalty:

- weighted with `0.48`
- begins at `45%`
- saturates at `100%`

Ceiling penalty:

- `<= 1500 ft`: `0.44`
- `1500-4000 ft`: linearly down from `0.44` to `0.25`
- `4000-8000 ft`: linearly down from `0.25` to `0.08`
- `8000-12000 ft`: linearly down from `0.08` to `0.02`
- `> 12000 ft`: `0`

Elevation adjustment for ceiling penalty:

- `elevation >= 50 deg`: multiply ceiling penalty by `0.82`
- `elevation >= 25 deg`: multiply by `0.92`
- `elevation <= 10 deg`: multiply by `1.08`

Combined obstruction penalty:

```text
combined = clamp(sky_penalty + ceiling_penalty, 0, 0.92)
obstruction_factor = clamp(1 - combined, 0.08, 1)
```

Observer vs path weighting:

- observer: `0.45`
- path_start: `0.25`
- path_mid: `0.20`
- path_end: `0.10`

Final obstruction factor combines average and worst case:

```text
obstruction = clamp(weighted_average * 0.75 + worst_factor * 0.25, 0.08, 1)
```

### Final weather factor

If obstruction or contrast exists:

```text
weather_factor = obstruction_factor * contrast_factor
```

If only one exists, the scorer uses that one.

If neither exists, it uses the fallback layered factor.

The final returned weather factor is always clamped to:

```text
[0.08, 1.0]
```

This means weather never hard-zeros the score by itself in the current live implementation.

### Weather source labels in the current system

Primary source can be:

- `open_meteo`
- `nws`
- `mixed`
- `none`

The more detailed `sourceUsed` label can be:

- `nws_path_sampling`
- `open_meteo_path_fallback`
- `mixed_nws_open_meteo`
- `geometry_only`

## Confidence Fields

The live system stores three confidence badges.

### Time confidence

Derived from `net_precision`:

- second or minute precision: `HIGH`
- hour precision: `MEDIUM`
- day, week, month: `LOW`
- missing or TBD: `UNKNOWN`

### Trajectory confidence

Derived from trajectory `confidence_tier`:

- `A` or `B`: `HIGH`
- `C`: `MEDIUM`
- `D`: `LOW`
- missing: `UNKNOWN`

### Weather confidence

Derived from weather freshness:

- age under 6h: `HIGH`
- age up to 24h: `MEDIUM`
- older than 24h: `LOW`
- no weather source: `UNKNOWN`

## Probability Calculation

The repo stores a `probability` value, but it is currently a heuristic logistic output, not a trained and publicly calibrated forecast probability.

Exact computation:

```text
score_norm = score / 100

confidence_boost =
  0.22 * time_confidence_value +
  0.32 * trajectory_confidence_value +
  0.18 * weather_confidence_value

linear =
  -2.8 +
  4.3 * score_norm +
  0.7 * illumination_factor +
  0.45 * darkness_factor +
  0.6 * los_factor +
  0.25 * weather_factor +
  confidence_boost

probability = sigmoid(linear)
```

Confidence numeric mapping:

- `HIGH`: `1`
- `MEDIUM`: `0.6`
- `LOW`: `0.25`
- `UNKNOWN`: `0`

If a stored row is missing probability, the read path falls back to:

```text
probability = score / 100
```

### Calibration band

Probability is mapped to bands:

- `< 0.15`: `VERY_LOW`
- `< 0.35`: `LOW`
- `< 0.60`: `MEDIUM`
- `< 0.82`: `HIGH`
- `>= 0.82`: `VERY_HIGH`

## Readiness and Public Probability Gating

Probability presentation is controlled by readiness, not just by whether a numeric probability exists.

Readiness settings live in `system_settings`:

- `jep_public_enabled`
- `jep_validation_ready`
- `jep_model_card_published`
- `jep_probability_min_labeled_outcomes`
- `jep_probability_labeled_outcomes`
- `jep_probability_max_ece`
- `jep_probability_current_ece`
- `jep_probability_max_brier`
- `jep_probability_current_brier`

The current response always includes `probability`, but `mode` is:

- `probability` only when readiness says public probability is ready
- otherwise `watchability`

Current readiness logic requires:

- validation ready
- model card published
- enough labeled outcomes
- ECE threshold met
- Brier threshold met

If those are not met, the score remains customer-facing but the probability is treated as not publicly ready.

## Explainability

The scorer stores an explainability JSON block containing:

- `reasonCodes`
- `weightedContributions`
- `safeMode`

The weighted contribution display always uses:

- illumination `* 0.35`
- darkness `* 0.25`
- line of sight `* 0.25`
- weather `* 0.15`

Current reason codes may include:

- `geometry_only_weather_fallback`
- `personalized_observer`
- `weather_confidence_limited`
- `trajectory_confidence_limited`
- `time_confidence_limited`
- `weather_path_sampling`
- `weather_mixed_sources`
- `weather_blocker_*`
- `nominal`

## Guidance Outputs

The response also carries guidance derived from the trajectory in `apps/web/lib/jep/guidance.ts`.

These are not separate inputs to the main score. They are derived presentation helpers.

### Best window

Derived from visible samples if available, otherwise the strongest modeled angle window.

### Direction band

Derived from the shortest circular azimuth arc across the chosen sample band.

### Elevation band

Derived from min/max elevation across the chosen band.

### Scenario windows

The system simulates what the score would be if launch time slipped by:

- `+15 min`
- `+30 min`
- `+45 min`

It recalculates:

- illumination
- darkness

It keeps current:

- line of sight factor
- weather factor

Scenario window scores therefore only express timing drift against current geometry and weather assumptions. They are not full recomputations with refreshed weather or changed trajectory.

### Solar window range

The system also derives the solar depression range across:

- NET
- window start
- window end

And marks whether the launch window crosses the current twilight sweet spot of:

- `6 deg`
- `12 deg`

### Guidance visibility policy

Observer-specific guidance is suppressed when:

- the returned row is pad-based
- the system fell back from requested observer to pad

This is deliberate. The system only exposes direction/elevation/window guidance when it believes the row corresponds to the actual observer bucket.

## Expiry, Refresh, and Snapshot Behavior

### Row expiry

Future rows expire on a cadence based on hours to NET:

- `<= 1h`: refresh every 5 min
- `<= 6h`: refresh every 15 min
- `<= 24h`: refresh every 60 min
- `<= 7d`: refresh every 360 min
- `> 7d`: refresh every 1440 min

### Post-launch snapshots

After T0:

- existing rows are snapshot-locked by setting `snapshot_at`
- `expires_at` is cleared
- rows stop refreshing

There is also a post-launch compute grace period of 2 hours for missing rows.

## Batch Refresh Job

The batch producer is `supabase/functions/jep-score-refresh/index.ts`.

### What the job loads

From `launches_public_cache`:

- launch id
- net
- net precision
- launch status
- pad lat/lon
- pad country
- mission orbit
- vehicle
- rocket family

From `launch_trajectory_products`:

- product
- confidence tier
- freshness state

From `jep_observer_locations`:

- recently seen observer buckets

### Observer selection for batch precompute

For each launch, the job always computes the pad row first.

It may also compute observer-registry rows:

- from recently seen observer buckets
- nearest to the pad
- capped by `jep_score_max_observers_per_launch`
- capped by `jep_score_max_observer_distance_km`

### Eligibility rules

The refresh job skips launches when:

- launch id missing
- NET invalid
- pad coordinates missing
- launch older than snapshot lookback
- status indicates cancelled
- status implies success/failure before scheduled time

### Due rules

A launch/observer row is due when:

- no row exists
- row is expired
- row has no expiry
- launch is already at/past T0
- trajectory regenerated after the row was computed
- expiry is close enough that the next interval window should refresh it

### Job settings

Current configurable settings:

- `jep_score_job_enabled`
- `jep_score_horizon_days`
- `jep_score_max_launches_per_run`
- `jep_score_weather_cache_minutes`
- `jep_score_model_version`
- `jep_score_open_meteo_us_models`
- `jep_score_observer_lookback_days`
- `jep_score_observer_registry_limit`
- `jep_score_max_observers_per_launch`
- `jep_score_max_observer_distance_km`

## API Surfaces

Current JEP routes:

- `apps/web/app/api/public/launches/[id]/jep/route.ts`
- `apps/web/app/api/v1/launches/[id]/jep/route.ts`

Both support:

- `GET`
- `POST`

Both:

- parse observer from query/body/headers
- optionally allow transient compute
- rate-limit transient personalization
- return `404` when JEP is unavailable

Cache behavior:

- personalized observer responses: `no-store`
- non-personalized public reads: short CDN cache with stale-while-revalidate

## Client Surfaces

### Web

Main panel:

- `apps/web/components/JepScorePanel.tsx`
- `apps/web/components/JepScoreClient.tsx`

The web panel:

- shows score or probability depending on `mode`
- shows factor tiles
- shows cloud layer fields
- shows solar depression, sunlit margin, visible fraction
- shows guidance when personalized
- shows snapshot/stale badges

Current web personalization behavior:

- initial server render may use header-derived observer coordinates
- client-side refinement attempts browser geolocation
- the client posts explicit observer coordinates to `/api/public/launches/[id]/jep`
- if personalized scoring succeeds, the panel switches to user-location mode
- if not, the panel stays on pad fallback

### Mobile

Main panel:

- `apps/mobile/src/components/launch/JepPanel.tsx`

The mobile panel:

- consumes the same public `LaunchJepScore`
- shows score or probability depending on `mode`
- shows factor cards and technical breakdown
- uses the shared API client route `/api/v1/launches/{id}/jep`

Current mobile behavior caveat:

- the current `JepPanel` calls `useLaunchJepQuery(launchId, {})`
- this means the component itself is not currently sending explicit observer coordinates
- in practice, mobile JEP currently behaves like the default launch score path unless another layer adds observer context elsewhere

## Persistence Schema

### `launch_jep_scores`

Core stored fields:

- launch id
- observer location hash
- observer lat/lon buckets
- score
- probability
- calibration band
- illumination factor
- darkness factor
- LOS factor
- sunlit margin
- LOS visible fraction
- weather factor
- weather freshness minutes
- solar depression
- cloud cover total/low/mid/high
- time/trajectory/weather confidence
- weather source
- azimuth source
- geometry fallback flag
- explainability JSON
- model version
- input hash
- computed timestamp
- expiry timestamp
- snapshot timestamp

Primary key:

- `(launch_id, observer_location_hash)`

### `jep_observer_locations`

Stores coarse observer buckets for precompute targeting:

- observer hash
- lat bucket
- lon bucket
- source
- last seen

### `jep_corridor_cache`

Exists for directional provenance:

- source can be `bnm`, `tfr`, or `default_table`

This is part of JEP-adjacent infrastructure, but the current live score itself does not use it as a scoring factor.

### `jep_profiles`

Exists in schema for mission/vehicle priors but is not currently populated or read by the live scorer.

### `jep_outcome_reports`

Exists for calibration and post-event outcomes but is not currently populated and does not feed back into the live scorer.

## Live Data Coverage Snapshot

This section reflects the live production data audit performed on 2026-04-07.

### Future launch coverage

- future launches in `launches_public_cache`: `362`
- `window_start` populated: `362/362`
- `window_end` populated: `362/362`
- `pad_latitude` populated: `361/362`
- `pad_longitude` populated: `361/362`
- `vehicle` populated: `362/362`
- `mission_orbit` populated: `352/362`
- literal `mission_orbit = "Unknown"` rows: `49`
- `rocket_family` populated: `0/362`

### Future launch precision coverage

- `minute`: `82`
- `hour`: `3`
- `day`: `11`
- `month`: `266`

### Future launch window widths

- exactly 0 min: `353`
- 16-30 min: `3`
- 31-60 min: `1`
- over 60 min: `5`

Interpretation:

- window fields are populated
- most future rows still behave like effectively fixed single times
- the live scorer currently uses `net_precision` for confidence, not window width as a scoring term

### Trajectory coverage

- total `launch_trajectory_products` rows: `85`
- future launches with trajectory: `15`
- all `85` trajectory rows have samples and events
- `43/85` have fresh freshness state
- confidence tiers across all stored trajectory rows:
  - `A`: `4`
  - `B`: `36`
  - `C`: `29`
  - `D`: `2`
  - `null`: `14`

Important operational fact:

- JEP cannot be computed without trajectory
- therefore the live full JEP system currently only exists for the subset of launches with trajectory products

### Stored JEP row coverage

- total `launch_jep_scores` rows: `90`
- probability populated: `90/90`
- observer hash populated: `90/90`
- `sunlit_margin_km` populated: `66/90`
- `los_visible_fraction` populated: `90/90`
- `cloud_cover_mid_pct` populated: `0/90`
- `cloud_cover_high_pct` populated: `0/90`

Stored weather source distribution:

- `open_meteo`: `89`
- `none`: `1`

Stored model versions:

- `jep_v3`: `63`
- `jep_v5`: `27`

Observer mix:

- pad rows: `52`
- personalized rows: `38`

Interpretation:

- the schema supports v4/v5 weather-layer fields
- the current stored production rows are still mostly Open-Meteo-only
- future rows in production are not yet showing persisted mid/high cloud values even though the code supports them

### Launch weather table coverage

- total `launch_weather` rows: `52`
- future launches with `launch_weather`: `5`
- `probability` populated: `52/52`
- `concerns` populated: `0/52`

Important meaning caveat:

- `launch_weather.probability` is not a launch-go probability inside current JEP
- it comes from NWS weather ingest semantics, not from a launch readiness model
- the live JEP scorer does not use it

### WS45 coverage

- total `ws45_launch_forecasts` rows: `28`
- rows with `launch_day_pov_percent`: `27/28`
- rows with `launch_day` JSON: `27/28`
- currently valid future WS45 rows: `0`

Interpretation:

- WS45 historical rows exist
- current live JEP does not use WS45 as a scoring factor
- current public WS45 source ingestion is not dependable enough to treat as a live JEP dependency

### Calibration and priors

- `jep_profiles`: `0` rows
- `jep_outcome_reports`: `0` rows

Interpretation:

- vehicle priors are not active in the live system
- public probability cannot be considered empirically calibrated from outcome reports yet

## External Data Sources Used by the Current Scorer

### Open-Meteo

Used live today for:

- total cloud cover
- low cloud cover
- mid cloud cover
- high cloud cover

Requested but currently ignored by the JEP scorer:

- visibility

### NWS / weather.gov

Used live today for US locations:

- sky cover
- ceiling

Stored support table:

- `nws_points`

### Trajectory products

Used live today for:

- ascent samples
- event timing
- trajectory confidence tier

### Internal launch tables

Used live today for:

- launch NET
- net precision
- pad coordinates
- pad country

## Repo Artifacts That Exist But Are Not Part of the Current Live JEP Score

These are important because they are easy to confuse with active inputs.

Not currently used in the live score equation:

- `mission_orbit`
- `vehicle`
- `rocket_family`
- `jep_profiles`
- `jep_outcome_reports`
- `launch_weather.probability`
- WS45 `launch_day_pov_percent`
- Open-Meteo visibility
- NWS visibility
- NWS wind
- terrain horizon masks
- moonlight
- light pollution
- local obstruction maps

Also important:

- `apps/web/lib/jep/forecastHorizon.ts` exposes source-plan labels such as `nbm_ndfd`, `hrrr`, and `goes_nowcast`
- those are planning labels, not the current live JEP fetch implementation
- the live JEP weather fetch path today is still Open-Meteo plus NWS

## Known Current Limitations

These are current-system facts, not proposed fixes.

1. The shadow test is approximate.
   - It uses a shadow-height approximation, not a full ray/shadow geometry test.

2. The score is multiplicative and simple.
   - There are only four top-level factors.
   - Mission-specific plume behavior is not explicitly modeled.

3. Weather is floored.
   - Weather alone cannot fully zero the score because the final weather factor is clamped to at least `0.08`.

4. Visibility/haze is not used.
   - Open-Meteo visibility is requested but ignored.
   - NWS visibility is available but ignored.

5. Probability is heuristic.
   - It is a logistic transform of current factors and confidence fields.
   - It is not yet backed by populated outcome reports.

6. Full JEP coverage is trajectory-limited.
   - Only launches with trajectory products can have full JEP rows.

7. Mid/high weather-layer persistence is incomplete in current stored rows.

8. WS45 exists in the repo and DB, but it is not a live scoring dependency.

## File-by-File Responsibility Map

### Core scoring

- `apps/web/lib/jep/serverShared.ts`
  - score computation
  - geometry
  - weather resolution
  - confidence mapping
  - explainability payload

- `apps/web/lib/jep/weather.ts`
  - layered cloud contrast penalties
  - obstruction penalties
  - weather factor combination

### Read path and transient personalization

- `apps/web/lib/server/jep.ts`
  - fetch existing row
  - transient compute
  - readiness gate
  - public payload mapping

- `apps/web/lib/server/jepObserver.ts`
  - observer parsing
  - bucket snapping
  - observer hash generation

### Guidance and planning presentation

- `apps/web/lib/jep/guidance.ts`
  - best window
  - direction band
  - elevation band
  - scenario windows
  - solar window range

- `apps/web/lib/jep/forecastHorizon.ts`
  - planning phase labels
  - forecast confidence labels
  - source-plan labels

- `apps/web/lib/jep/readiness.ts`
  - probability-public-readiness rules

### Batch persistence

- `supabase/functions/jep-score-refresh/index.ts`
  - due launch selection
  - observer registry targeting
  - batch compute
  - snapshot lock application

### Schemas and storage

- `supabase/migrations/20260303000100_jep_core.sql`
  - base JEP tables

- `supabase/migrations/20260303000500_jep_observer_v2.sql`
  - observer-aware keys and registry

- `supabase/migrations/20260303173000_jep_v3_accuracy_fields.sql`
  - probability and explainability columns

- `supabase/migrations/20260311143000_jep_weather_layers_v4.sql`
  - mid/high cloud columns

- `supabase/migrations/20260311190000_jep_weather_obstruction_v5.sql`
  - model version bump for v5 weather logic

### Client presentation

- `apps/web/components/JepScorePanel.tsx`
- `apps/mobile/src/components/launch/JepPanel.tsx`

## Bottom Line

The current JEP system is a live, working, geometry-plus-weather scoring system with:

- a four-factor multiplicative score
- a heuristic probability overlay
- readiness gating for public probability mode
- batch precompute plus transient personalization
- layered weather degradation using Open-Meteo and NWS
- trajectory-dependent guidance and evidence summaries

It is not yet a fully calibrated probability engine, and several supporting data sources in the repo exist but are not currently active in the live score computation.
