# JEP System Specification

Current implementation snapshot as of April 7, 2026.

This document describes the JEP system exactly as it exists in the repo and production data today. It does not describe a proposed future model. Where the repo contains adjacent tables, planned fields, or compatibility paths that are not part of the active scoring path, this document calls that out explicitly.

## Scope

Platform matrix:

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

Product scope:

- Customer-facing: yes
- Admin/calibration backplane: yes

Primary implementation files:

- `apps/web/lib/jep/serverShared.ts`
- `apps/web/lib/jep/weather.ts`
- `apps/web/lib/jep/guidance.ts`
- `apps/web/lib/server/jep.ts`
- `apps/web/lib/server/jepObserver.ts`
- `supabase/functions/jep-score-refresh/index.ts`
- `apps/web/app/api/v1/launches/[id]/jep/route.ts`
- `apps/web/lib/types/jep.ts`
- `packages/contracts/src/index.ts`
- `packages/domain/src/jepPresentation.ts`
- `apps/web/components/JepScorePanel.tsx`
- `apps/mobile/src/components/launch/JepPanel.tsx`

## What JEP Currently Is

JEP is currently a four-factor multiplicative visibility model:

```text
score = illumination * darkness * line_of_sight * weather
```

Each factor is normalized to `0..1`, and the final score is:

```text
score_0_100 = round(score * 100)
```

The four top-level factors are:

- `illumination`: how much of the scored ascent is above the modeled Earth-shadow height
- `darkness`: how favorable the observer's twilight band is
- `line_of_sight`: how much of the useful sunlit ascent clears a 5 deg elevation threshold from the observer
- `weather`: a combined cloud obstruction and sky contrast term

JEP also computes and persists a `probability` field, but that field is not currently public-ready in product terms. The public/readiness gate still keeps the system in `watchability` mode rather than `probability` mode.

## High-Level Architecture

The current system has four main layers.

### 1. Scheduled precompute

The `jep-score-refresh` edge job precomputes JEP rows into `public.launch_jep_scores`.

What it does:

- loads candidate launches from `launches_public_cache`
- filters to launches that are eligible for scoring
- selects the pad observer plus recently active observer buckets
- loads trajectory products from `launch_trajectory_products`
- computes JEP rows with `computeJepScoreRecord`
- upserts rows into `launch_jep_scores`
- snapshot-locks rows once the launch passes T-0

Primary file:

- `supabase/functions/jep-score-refresh/index.ts`

### 2. On-demand transient personalization

If a user supplies an explicit observer location and their observer-specific row is missing or stale, the API can compute a transient personalized JEP on demand.

What it does:

- accepts explicit query/body observer coordinates
- rate-limits the request
- computes a fresh score using the same core scoring code
- returns it immediately
- may persist it if the request meets the persistence rules

Primary file:

- `apps/web/lib/server/jep.ts`

### 3. Read/serve layer

The server fetches the best available row, enriches it with guidance, readiness, planning metadata, and trajectory evidence, and returns a `LaunchJepScore`.

Primary files:

- `apps/web/lib/server/jep.ts`
- `apps/web/lib/jep/guidance.ts`
- `apps/web/lib/types/jep.ts`

### 4. Presentation layer

Web and mobile both render the same underlying score object, but they present it differently.

Primary files:

- Web: `apps/web/components/JepScorePanel.tsx`
- Mobile: `apps/mobile/src/components/launch/JepPanel.tsx`
- Shared presentation text: `packages/domain/src/jepPresentation.ts`

## Current Production Settings

Production settings snapshot from the live database on April 7, 2026:

| Setting | Live value |
| --- | --- |
| `jep_score_job_enabled` | `true` |
| `jep_score_horizon_days` | `16` |
| `jep_score_max_launches_per_run` | `120` |
| `jep_score_weather_cache_minutes` | `10` |
| `jep_score_model_version` | `jep_v5` |
| `jep_score_open_meteo_us_models` | `["best_match","gfs_seamless"]` |
| `jep_score_observer_lookback_days` | `14` |
| `jep_score_observer_registry_limit` | `128` |
| `jep_score_max_observers_per_launch` | `12` |
| `jep_score_max_observer_distance_km` | `1800` |
| `jep_public_enabled` | `false` |
| `jep_validation_ready` | `false` |
| `jep_model_card_published` | `false` |
| `jep_probability_min_labeled_outcomes` | `500` |
| `jep_probability_labeled_outcomes` | `0` |
| `jep_probability_max_ece` | `0.05` |
| `jep_probability_current_ece` | `null` |
| `jep_probability_max_brier` | `0.16` |
| `jep_probability_current_brier` | `null` |

Immediate implication:

- JEP is currently configured to compute `probability`
- JEP is not currently validated/published as a public probability system
- the product therefore remains in `watchability` mode

## Current Production Data Coverage

Live database snapshot from April 7, 2026.

### Launch input coverage

Future launches in `launches_public_cache`: `362`

`net_precision` among future launches:

- `minute`: `82`
- `hour`: `3`
- `day`: `11`
- `month`: `266`

Field coverage among future launches:

- `pad_latitude`: `361 / 362`
- `pad_longitude`: `361 / 362`
- `vehicle`: `362 / 362`
- `mission_orbit` non-null: `352 / 362`
- `mission_orbit` known and not `"Unknown"`: `313 / 362`
- `rocket_family`: `0 / 362`
- `window_start`: `362 / 362`
- `window_end`: `362 / 362`

### Trajectory coverage

Future launches with trajectory products in `launch_trajectory_products`: `15`

Confidence tiers for those future trajectory rows:

- `B`: `5`
- `C`: `10`

Freshness states for those future trajectory rows:

- `fresh`: `6`
- `stale`: `2`
- `unknown`: `7`

### Score row coverage

Rows in `launch_jep_scores`: `90`

Distinct launches covered by those rows: `52`

Observer split:

- pad rows: `52`
- personalized rows: `38`

Model version mix:

- `jep_v3`: `63`
- `jep_v5`: `27`

Weather source mix:

- `open_meteo`: `89`
- `none`: `1`

Field population:

- `probability`: `90 / 90`
- `sunlit_margin_km`: `66 / 90`
- `los_visible_fraction`: `90 / 90`
- `cloud_cover_mid_pct`: `0 / 90`
- `cloud_cover_high_pct`: `0 / 90`

### Supporting tables

- `jep_observer_locations`: `4` rows
- `jep_profiles`: `0` rows
- `jep_outcome_reports`: `0` rows
- `launch_weather`: `52` rows
- recent `ws45_launch_forecasts`: `0` rows

Implications:

- the schema supports observer-aware JEP and probability-style metadata
- production currently has very limited observer-registry coverage
- the score job is running on a mixed history of `jep_v3` and `jep_v5` rows
- mid/high cloud persistence exists in schema, but current stored score rows do not populate it
- there is no live calibration dataset in `jep_outcome_reports`
- `jep_profiles` exists, but is empty and not used

## Data Sources Actually Used In The Current Score

### Launch metadata

Used by precompute:

- `launches_public_cache`

Used by serve/transient path:

- `launches`

Fields actually consumed by the scorer:

- `launch_id`
- `net`
- `net_precision`
- `pad_latitude`
- `pad_longitude`
- `pad_country_code`

Fields fetched by the refresh job but not passed into the scorer:

- `mission_orbit`
- `vehicle`
- `rocket_family`

### Trajectory data

Source table:

- `launch_trajectory_products`

Fields actually consumed by the scorer:

- `product`
- `confidence_tier`

Inside `product`, the scorer uses:

- `samples`
- `events`

`samples` may already contain:

- `tPlusSec`
- `latDeg` / `lat_deg`
- `lonDeg` / `lon_deg`
- `altM` / `alt_m`
- `downrangeM` / `downrange_m`
- `azimuthDeg` / `azimuth_deg`

If latitude/longitude/altitude are missing but `ecef` is present, the scorer derives geodetic position from ECEF coordinates.

### Observer data

Observer sources accepted by the API:

- query string
- request body
- request headers

Observer normalization:

- latitude and longitude are bucketed to `0.1 deg`
- hash is SHA-256 of `latBucket,lonBucket`, truncated to 24 hex chars
- hash `"pad"` is the pad fallback observer

Observer storage:

- `jep_observer_locations`

### Weather data used by the score

Current active weather inputs:

- Open-Meteo live forecast API
- NWS `points` + `forecastGridData` for US-like locations
- cached `nws_points` rows in the database

Open-Meteo fields requested:

- `cloud_cover`
- `cloud_cover_low`
- `cloud_cover_mid`
- `cloud_cover_high`
- `visibility`

Important detail:

- the current scorer requests Open-Meteo `visibility`, but does not actually use it in the score

NWS fields sampled:

- `skyCover`
- `ceiling`

Important detail:

- the current scorer does not use NWS visibility, precipitation, humidity, or wind in the JEP score

### Data that exists in the repo but is not part of the active JEP score

- `launch_weather`
- `ws45_launch_forecasts`
- `jep_profiles`
- `jep_outcome_reports`
- `rocket_family`
- `mission_orbit`
- `vehicle`
- Open-Meteo `visibility`

## Tables And Persistence

### `launch_jep_scores`

This is the core persistence table for score rows.

Important schema evolution:

1. v1 core columns:
   - score
   - illumination/darkness/LOS/weather factors
   - solar depression
   - total and low cloud
   - confidence fields
   - weather source
   - geometry fallback
   - model version
   - input hash
   - computed/expires timestamps
2. v2 observer-scoped keys:
   - `observer_location_hash`
   - `observer_lat_bucket`
   - `observer_lon_bucket`
   - primary key changed to `(launch_id, observer_location_hash)`
3. v3 accuracy/explainability:
   - `probability`
   - `calibration_band`
   - `sunlit_margin_km`
   - `los_visible_fraction`
   - `weather_freshness_min`
   - `explainability`
4. v4 weather layers:
   - `cloud_cover_mid_pct`
   - `cloud_cover_high_pct`
5. v5:
   - model version bump for obstruction-plus-contrast weather logic

### `jep_observer_locations`

Purpose:

- lightweight registry of recently seen observer buckets
- used by the refresh job to precompute personalized variants

### `jep_profiles`

Purpose in schema:

- intended mission/vehicle prior table

Current status:

- empty
- not used by current scoring logic

### `jep_outcome_reports`

Purpose in schema:

- future calibration and validation labels

Current status:

- empty
- not used by current scoring logic

## Full Scoring Method

This section describes the actual current scorer, not a proposed v2.

### Step 1. Basic compute gates

The scorer returns `null` before any math if any of these are missing:

- valid launch `net`
- valid pad latitude/longitude
- trajectory product
- parsed trajectory samples

This means no score is produced if:

- launch timing is absent
- pad coordinates are absent
- no trajectory product exists
- the trajectory product cannot be parsed into usable samples

### Step 2. Parse trajectory samples

`parseSamples` normalizes the trajectory into a sorted sample list.

It accepts:

- direct geodetic sample fields
- or ECEF coordinates which it converts to geodetic coordinates

If `downrangeM` or `azimuthDeg` are missing, it derives them from the pad coordinates and the sample position.

### Step 3. Determine the scored ascent window

The scoring window starts at:

- `T+60 s`

The scoring window ends at:

- `SECO` if a trajectory event label/key contains `seco`
- otherwise the max sample time, clamped to `180..1200 s`

This same window is used by:

- illumination scoring
- line-of-sight scoring
- weather path sampling
- guidance/best window logic

### Step 4. Compute solar depression

The scorer computes solar depression at the observer location at `NET`.

Definition:

- positive value means the Sun is below the horizon
- negative value means the Sun is above the horizon

### Step 5. Compute darkness factor

Current darkness bucket mapping:

| Solar depression at observer | Darkness factor |
| --- | ---: |
| `< 0 deg` | `0.0` |
| `0 deg to <3 deg` | `0.3` |
| `3 deg to <6 deg` | `0.8` |
| `6 deg to <12 deg` | `1.0` |
| `12 deg to 18 deg` | `0.6` |
| `> 18 deg` | `0.1` |

Important note:

- this is a piecewise bucket model
- there is no continuous interpolation between bucket edges

### Step 6. Compute Earth-shadow height

The scorer uses a simple shadow-height approximation:

```text
shadow_height_km = (R + H0) / cos(gamma) - R
```

where:

- `R = 6371 km`
- `H0 = 12 km`
- `gamma = max(0, solarDepressionDeg)`

This is used as the sunlit threshold. A sample is treated as sunlit when:

```text
sample_altitude_km > shadow_height_km
```

Important note:

- this is not an exact shadow-cylinder or full Earth-shadow ray test
- it is the current production approximation

### Step 7. Compute illumination factor

Illumination measures how much of the scored ascent is above the shadow height.

Weighting by time:

- samples from `T+150 s` to `T+300 s` count double
- all other scored samples count normally

Formula:

```text
illumination_factor = weighted_sunlit_samples / weighted_total_samples
```

Additional output:

- `sunlit_margin_km` = weighted average of `(altitude_km - shadow_height_km)` over sunlit samples only

If there are no scored samples:

- illumination factor = `0`

### Step 8. Compute line-of-sight factor

LOS only considers samples that are already sunlit.

For each sunlit sample, the scorer computes the apparent elevation angle from the observer using ECEF-to-topocentric geometry.

Visibility threshold:

- elevation must be at least `5 deg`

Weighting by time:

- same double-weight window from `T+150 s` to `T+300 s`

Formula:

```text
los_factor = weighted_visible_sunlit_samples / weighted_sunlit_samples
```

Equivalent output:

- `los_visible_fraction`

If there are no scored sunlit samples:

- LOS factor = `0`

### Step 9. Build the weather sampling plan

The scorer chooses three path points for weather sampling.

Selection order:

1. use the visible sunlit path if any exists
2. otherwise use the sunlit path
3. otherwise use the broader modeled ascent path

Modes:

- `visible_path`
- `sunlit_path`
- `modeled_path`
- `observer_only` if no sampling plan can be built

Selected path points:

- first point
- midpoint
- last point

Roles:

- `path_start`
- `path_mid`
- `path_end`

### Step 10. Resolve weather at observer, pad, and path points

For each point:

1. fetch or reuse Open-Meteo forecast
2. for US-like locations, fetch or reuse NWS point metadata
3. for US-like locations, fetch or reuse NWS forecast grid data
4. sample the nearest forecast time to `NET`

Source behavior:

- Open-Meteo is always attempted first
- NWS is only attempted for US-like coordinates or US pad country codes
- if Open-Meteo and NWS are both present, the point source becomes `mixed`
- if only NWS sky/ceiling is present, the point source becomes `nws`
- if only Open-Meteo cloud fields are present, the point source becomes `open_meteo`
- otherwise the point source becomes `none`

Important detail:

- `skyCoverPct` falls back to Open-Meteo `cloudCoverTotal` if NWS sky cover is missing
- `ceilingFt` only exists when NWS data is available

### Step 11. Compute weather contrast factor

This factor models how much cloud cover at the observer softens sky contrast.

Current internal weights:

| Input | Weight |
| --- | ---: |
| low cloud penalty | `0.18` |
| mid cloud penalty | `0.34` |
| high cloud penalty | `0.28` |
| total cloud penalty with detailed layers | `0.16` |
| total cloud penalty without detailed layers | `0.30` |

Penalty thresholds:

- low cloud starts penalizing at `35%`
- mid cloud starts penalizing at `25%`
- high cloud starts penalizing at `30%`
- total cloud starts at `65%` when detailed layers exist
- total cloud starts at `35%` when only fallback layers exist

Combined penalty cap:

- `0.82`

Final contrast factor:

```text
contrast_factor = clamp(1 - combined_penalty, 0.18, 1.0)
```

Important note:

- even severe contrast degradation bottoms out at `0.18`, not `0`

### Step 12. Compute weather obstruction factor

This factor models whether clouds and low ceilings physically block the plume path.

#### 12a. Point-level obstruction

Sky-cover penalty:

- starts at `45%`
- ramps to full weight at `100%`
- max sky penalty weight: `0.48`

Ceiling penalty:

- `<= 1500 ft`: `0.44`
- `1500 to 4000 ft`: interpolates `0.44 -> 0.25`
- `4000 to 8000 ft`: interpolates `0.25 -> 0.08`
- `8000 to 12000 ft`: interpolates `0.08 -> 0.02`
- `> 12000 ft`: `0`

Elevation adjustments on the ceiling penalty:

- `>= 50 deg elevation`: multiply by `0.82`
- `>= 25 deg elevation`: multiply by `0.92`
- `<= 10 deg elevation`: multiply by `1.08`

Point-level formula:

```text
combined_penalty = clamp(sky_penalty + ceiling_penalty, 0, 1 - 0.08)
obstruction_factor = clamp(1 - combined_penalty, 0.08, 1)
```

Important note:

- point obstruction bottoms out at `0.08`, not `0`

#### 12b. Multi-point obstruction across observer and path

Current weighting across sampled points:

| Sample | Weight |
| --- | ---: |
| observer | `0.45` |
| path start | `0.25` |
| path middle | `0.20` |
| path end | `0.10` |

Aggregation:

```text
weighted_average = sum(weight * point_factor) / sum(weight)
worst_factor = min(point_factor)
obstruction_factor = clamp(weighted_average * 0.75 + worst_factor * 0.25, 0.08, 1)
```

### Step 13. Combine weather contrast and obstruction

If either contrast or obstruction is available:

```text
weather_factor = obstruction_factor * contrast_factor
```

with fallback behavior:

- if one side is missing, use the other side
- if both are missing, fall back to the legacy layer-only weather factor

Final clamp:

```text
weather_factor = clamp(weather_factor, 0.08, 1)
```

Important note:

- when weather exists, the weather term never reaches `0`
- when no weather exists at all, the legacy fallback with all-null inputs resolves to `1`
- that means a geometry-only run effectively carries no weather penalty

### Step 14. Compute final score

Current production formula:

```text
raw = illumination_factor * darkness_factor * los_factor * weather_factor
score = round(clamp(raw, 0, 1) * 100)
```

Important note:

- the current score formula does not apply explicit exponent weights
- all four factors enter multiplicatively as plain normalized terms

### Step 15. Compute probability

Current probability is a heuristic logistic layer, not a calibrated production probability model.

Formula:

```text
score_norm = score / 100

confidence_boost =
  time_confidence_value * 0.22 +
  trajectory_confidence_value * 0.32 +
  weather_confidence_value * 0.18

linear =
  -2.8 +
  score_norm * 4.3 +
  illumination_factor * 0.7 +
  darkness_factor * 0.45 +
  los_factor * 0.6 +
  weather_factor * 0.25 +
  confidence_boost

probability = sigmoid(linear)
```

Confidence value mapping:

| Confidence label | Numeric value |
| --- | ---: |
| `HIGH` | `1.0` |
| `MEDIUM` | `0.6` |
| `LOW` | `0.25` |
| `UNKNOWN` | `0.0` |

Calibration band mapping:

| Probability | Band |
| --- | --- |
| `< 0.15` | `VERY_LOW` |
| `< 0.35` | `LOW` |
| `< 0.60` | `MEDIUM` |
| `< 0.82` | `HIGH` |
| `>= 0.82` | `VERY_HIGH` |

Important note:

- this is computed and stored
- it is not currently validated enough to drive public probability mode

## Confidence Labels

### Time confidence

Derived from `net_precision`:

- seconds/minutes: `HIGH`
- hours: `MEDIUM`
- day/week/month: `LOW`
- otherwise: `UNKNOWN`

### Trajectory confidence

Derived from trajectory `confidence_tier`:

- `A` or `B`: `HIGH`
- `C`: `MEDIUM`
- `D`: `LOW`
- otherwise: `UNKNOWN`

### Weather confidence

Derived from weather age:

- `< 6 hours`: `HIGH`
- `<= 24 hours`: `MEDIUM`
- `> 24 hours`: `LOW`
- no weather source: `UNKNOWN`

## Explainability Layer

The score row stores `explainability` with:

- `reasonCodes`
- `weightedContributions`
- `safeMode`

Important note:

- `weightedContributions` are not the actual score formula
- they are a descriptive UI breakdown

Current explainability contribution weights:

| Field | Display weight |
| --- | ---: |
| illumination | `0.35` |
| darkness | `0.25` |
| line of sight | `0.25` |
| weather | `0.15` |

This means the UI contribution summary and the actual score formula are not the same thing.

## Guidance Layer

The serve path computes observer guidance on top of the stored score.

Outputs:

- `solarWindowRange`
- `bestWindow`
- `directionBand`
- `elevationBand`
- `scenarioWindows`

### Solar window range

Computed from:

- `NET`
- `window_start`
- `window_end`

It reports the observer's solar depression at those times and whether the range crosses the `6 deg to 12 deg` twilight sweet spot.

### Best window

If there are visible samples:

- group visible samples into windows
- break groups when the gap exceeds `45 s`
- choose the best group by peak elevation, then by span

If there are no visible samples:

- choose a small window around the highest-elevation sample

### Direction band

Derived from the shortest circular arc across candidate azimuths.

### Elevation band

Derived from the min/max elevation across candidate samples.

### Scenario windows

Current scenario offsets:

- `+15 min`
- `+30 min`
- `+45 min`

These scenario scores are computed by recomputing:

- darkness
- illumination

but keeping:

- current line-of-sight factor
- current weather factor

fixed.

Important note:

- scenario windows are timing what-ifs, not full re-simulations with new weather or trajectory

### Observer guidance policy

Guidance is only shown for observer-specific rows when observer guidance is allowed.

If the score is a pad row or pad fallback:

- `bestWindow`
- `directionBand`
- `elevationBand`
- `scenarioWindows`

are intentionally suppressed.

## Forecast Planning Metadata

The response also includes a `planning` block from `forecastHorizon.ts`.

This contains:

- `hoursToNet`
- `phase`
- `confidence`
- `label`
- `note`
- `sourcePlan`

Important note:

- `sourcePlan` is a planning hint, not the current active scoring source stack
- it references `nbm_ndfd`, `hrrr`, and `goes_nowcast`
- those sources are not currently active inputs in the JEP score computation

Current active scoring weather sources remain:

- Open-Meteo
- NWS sky cover and ceiling for US-like locations

## Freshness, Expiration, And Job Cadence

### Score expiration

Expiration interval before launch:

| Time to NET | Expiration interval |
| --- | --- |
| `<= 1 hour` | `5 min` |
| `<= 6 hours` | `15 min` |
| `<= 24 hours` | `60 min` |
| `<= 7 days` | `360 min` |
| `> 7 days` | `1440 min` |

Scores past T-0:

- may be snapshot-locked
- get `snapshot_at`
- have `expires_at = null`

### Job cadence

Managed scheduler default:

- every `300 s`
- offset `150 s`

### Launch candidate horizon

The job looks at launches from:

- `now - 24 hours`

to:

- `now + horizonDays`

with current default:

- `16 days`

### Post-launch grace

If a launch has already passed T-0:

- existing rows are snapshot-locked
- new computation is allowed only inside a `2 hour` post-launch grace window

### Due logic

A launch/observer variant is due if:

- there is no existing row
- the row is expired
- the trajectory was regenerated after the row was computed
- the row is approaching expiry

If the input hash is unchanged and enough TTL remains, the job skips rewriting the row.

## Transient Personalization

Transient personalization is the on-demand compute path for explicit observer input.

### Allowed sources

Only these observer sources qualify:

- `query`
- `provided`

Header-only inferred observers do not qualify for transient compute.

### Conditions

Transient compute requires:

- explicit observer
- transient personalization enabled
- no fresh observer-specific row already present
- no snapshot lock
- launch still in the future
- trajectory product present
- admin client configured

### Time budget

Transient compute is wrapped in a timeout:

- `750 ms`

### Rate limits

GET with transient personalization:

- `4` requests per `300 s` per `launch + observer hash`

POST with transient personalization:

- `6` requests per `300 s` per `launch + observer hash`

### Persistence rules

Transient results may be persisted only when:

- observer source is `provided`
- row is stale or missing
- row is not snapshot-locked
- launch is in the future
- launch is within `24 hours` of T-0

## API Behavior

Route:

- `apps/web/app/api/v1/launches/[id]/jep/route.ts`

Behavior:

- `GET` accepts query observer coordinates and header-derived observer hints
- `POST` accepts body observer coordinates and header-derived observer hints
- pad/global responses can be cached publicly
- personalized responses are `no-store`

Cache behavior:

- no observer: `public, s-maxage=60, stale-while-revalidate=240, stale-if-error=3600`
- observer present: `no-store`

## Public Readiness And Mode Switching

The server derives a `readiness` object from system settings.

Current readiness logic requires all of the following for `probabilityReady`:

- public release enabled
- validation ready
- model card published
- labeled outcomes threshold configured and met
- ECE threshold configured and met
- Brier threshold configured and met

Current production status:

- not public-enabled
- not validation-ready
- model card unpublished
- `0` labeled outcomes
- ECE unreported
- Brier unreported

Result:

- `probabilityReady = false`
- `probabilityPublicEligible = false`
- `mode = watchability`

Important note:

- the response still contains `probability`
- the UI should still treat the system as a score-first watchability system

## UI Behavior

### Web

The web panel:

- shows `score` when mode is `watchability`
- would show `probability` when mode becomes `probability`
- exposes detailed factor readouts
- shows weather details, source, freshness, guidance, and readiness summary

### Mobile

The mobile panel:

- uses the same `LaunchJepScore` payload
- renders a presentation summary plus factor cards
- includes a technical breakdown with the same major factors

### Shared presentation rules

`packages/domain/src/jepPresentation.ts` translates raw factor values into:

- human-readable statuses
- summary text
- factor narratives
- change-opportunity narratives

This is presentation logic only. It does not affect the stored score.

## Compatibility And Fallback Logic

The read path contains several compatibility behaviors.

### Legacy schema fallback

The server tries:

1. observer-scoped rows with extended columns and weather-layer columns
2. observer-scoped rows with extended columns only
3. observer-scoped rows with base columns only
4. legacy launch-only rows

### Probability fallback

If a row lacks persisted `probability`:

- the server falls back to `score / 100`

### Explainability fallback

If a row lacks `explainability`:

- the server synthesizes default explainability from the factor values

### Weather details fallback

If a row predates path-sampled weather details:

- the server synthesizes observer-only weather details from stored factor values

## What Exists But Is Not Part Of The Current JEP Score

These items are in the repo or schema but are not part of the live score computation today.

### Schema or data sources not wired into the active score

- `jep_profiles`
- `jep_outcome_reports`
- `launch_weather`
- `ws45_launch_forecasts`
- `mission_orbit`
- `vehicle`
- `rocket_family`
- Open-Meteo `visibility`

### Helper code not used in the live path

- `apps/web/lib/jep/weatherSampling.ts`

### Planning hints that are not active scoring inputs

- `nbm_ndfd`
- `hrrr`
- `goes_nowcast`

## Known Implementation Characteristics

These are part of the current system and should be understood as-is.

1. The final score is multiplicative and unweighted across the four top-level factors.
2. The weather submodel is internally weighted, but weather still enters the final score as one normalized factor.
3. The explainability contribution weights are descriptive only and do not equal the actual final score formula.
4. Weather does not hard-zero the score. With weather data present it bottoms out at `0.08`. With no weather data at all it effectively becomes `1.0`.
5. Mid/high cloud columns exist in schema, but current production rows do not populate them.
6. Probability is computed and stored but is not currently a validated public mode.
7. Guidance what-if windows only vary timing. They do not re-run weather or line-of-sight with a new trajectory.
8. The planning `sourcePlan` references future-source intentions, not the current live scoring source stack.
9. The score job loads `vehicle`, `mission_orbit`, and `rocket_family`, but the scorer currently ignores them.
10. There is no live calibration dataset yet because `jep_outcome_reports` is empty.

## Bottom Line

The current production JEP system is:

- a four-factor multiplicative visibility score
- backed by live trajectory products
- observer-aware when location is available
- weather-aware using Open-Meteo everywhere and NWS sky/ceiling in US-like cases
- stored in `launch_jep_scores`
- precomputed by a scheduler and optionally recomputed transiently for explicit observers
- enriched with guidance, readiness, and trajectory evidence at read time
- still operating as a score-first watchability system rather than a released probability system

It is not currently:

- a calibrated public probability model
- a mission-prior model
- a launch-readiness model
- a WS45-driven score
- a terrain/horizon-mask model
- a visibility/haze model

That is the full current JEP system as implemented and populated today.
