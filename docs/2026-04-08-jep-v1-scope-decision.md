# 2026-04-08 JEP V1 Scope Decision

Last updated: 2026-04-09

## Platform Matrix

- Web: not included
- iOS: not included
- Android: not included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: internal JEP product and implementation re-scope for the public v1 model

## Decision

Public `jep_v6` v1 will remain an observer-aware, US-first `watchability` model, but it will not attempt to model fine local obstruction.

Keep in public v1:

- sample-based sunlit plume geometry
- observer-specific broad visibility geometry
- Earth-curvature and distance sanity gating
- trajectory elevation and line-of-sight gating
- weather/cloud obstruction
- moon and anthropogenic background-light effects
- launch-family and vehicle-prior tuning

Explicitly out of scope for public v1:

- local terrain masks
- local building masks
- Copernicus DEM ingestion as a release blocker
- Overture buildings ingestion as a release blocker
- GHS-OBAT backfill as a release blocker
- any score penalty based on nearby skyline, trees, rooftops, or hills

## Rationale

This decision keeps the product simple where it matters and still blocks obviously impossible outcomes.

What must still be true:

- a Florida launch should not look watchable from California
- a launch with no sunlit visible corridor should stay near the floor
- worse weather, worse moonlight, or worse broad geometry should not improve the score

What we are intentionally not trying to do in v1:

- estimate whether a specific neighborhood rooftop, condo tower, tree line, or ridgeline blocks the view
- build a heavyweight GIS pipeline before the core US watchability model is live
- overfit the score to hyper-local skyline conditions before we have evidence that users need that fidelity

## Product Rule

The public v1 model assumes a clean local viewing lane once the plume is broadly visible from the observer location.

That means:

- broad observer geometry remains required
- fine local obstruction does not

In plain language:

- `California versus Florida` is a geometry problem and must still score near zero
- `downtown Miami rooftop versus open beach` is a local obstruction problem and is intentionally not modeled in public v1

## User-Facing Visibility Rule

The product must not tell users that a jellyfish plume `will happen` as a hard promise.

Public semantics should separate three different things:

- `visibility call`: is a visible twilight plume physically on the table at all from this observer
- `watchability score`: if it is physically on the table, how strong or obvious it is likely to be
- `confidence`: how much we trust the call given trajectory, weather, and additive source coverage

Required decision rule:

- if `gate_open = false`, the product should say `No visible jellyfish-style plume expected from your area`
- if `gate_open = true`, the product may say `possible`, `favorable`, or `highly favorable`, but should not say `guaranteed`

Recommended public bands for v1:

- `gate_open = false`
  - label: `Not expected`
  - copy: `No visible jellyfish-style plume expected from your area.`
- `gate_open = true` and score `0-34`
  - label: `Possible`
  - copy: `A visible twilight plume is possible, but it would likely be faint or hard to notice.`
- `gate_open = true` and score `35-64`
  - label: `Possible`
  - copy: `A visible twilight plume is possible from your area if conditions hold.`
- `gate_open = true` and score `65-84`
  - label: `Favorable`
  - copy: `Conditions are favorable for a visible jellyfish-style plume.`
- `gate_open = true` and score `85-100`
  - label: `Highly favorable`
  - copy: `Conditions are highly favorable for a strong visible jellyfish-style plume.`

Confidence guidance for the public surface:

- `High` when the score is backed by current trajectory products, current weather inputs, and no major missing release-critical factors
- `Medium` when the core geometry and weather inputs are present but one secondary watchability factor is missing or degraded
- `Low` when the score depends on fallback logic, weak trajectory coverage, or missing source families that should materially improve the call later

Practical implication:

- moonlight and anthropogenic background light can lower the public `watchability` score because they affect how obvious the plume is to a human observer
- they do not decide whether the physical twilight-plume geometry exists in the first place

## Source Admission Rule

Every new JEP data source, ingest, or factor family must answer `yes` to all three questions before it is allowed onto the active implementation path:

1. Is the data current, available, and consistently provided?
2. If so, can it be joined to our launch identity with stable keys or deterministic matching?
3. If so, in samples of our future launch inventory, do we actually have the values we need and can use?

If the answer is `no` at any step:

- do not build it out as active implementation work
- move it to deferred or remove it from scope
- keep the corresponding score family neutral

Passing this rule is necessary, but not sufficient. A source can still be deferred if it is outside the public-v1 product scope or rollout priority.

## Implementation Implications

- the dark-gated local-horizon schema and helper work can remain in the repo, but it is no longer on the public v1 critical path
- Copernicus and Overture remain externally viable future sources that can pass the data gate, but they are still deferred by public-v1 scope
- mission-specific special-event priors are not on the active implementation path unless they later pass the source-admission rule
- the next critical implementation slices are vehicle priors, shadow `jep_v6` scorer completion, additive API rollout, and automated evidence intake for later calibration
- the full migration plan lives in `docs/2026-04-07-jep-best-in-class-migration-plan.md`

What this means right now:

- the moon/background foundation and shadow-candidate plumbing can continue
- local-horizon code can stay in the repo, but it should not drive the next milestone
- the next active build target is `jep_vehicle_priors` plus shadow-scorer integration for US-first launch families
- those priors should be keyed by `ll2_rocket_config_id`, backed by official provider or agency sources, and kept strictly family-level rather than mission-specific

Current live operating model:

- keep scheduled Black Marble ETL out of Supabase Edge Functions
- use the repo-owned manual batch runner at `.github/workflows/jep-black-marble-batch.yml` and `scripts/jep-black-marble-batch.mts`
- keep the managed scheduler and source-job flags off; the batch path is now the supported ingestion path until or unless a better batch runtime replaces it
- `jep_v6_background_feature_snapshots_enabled` can remain on once the batch runner has populated `jep_background_light_cells`
- use the internal `forceAll` job-auth override on `jep-score-refresh` when a same-day shadow recompute is needed after a fresh Black Marble batch

## Re-entry Criteria For Local Obstruction

Local obstruction can return as a later phase only if all of the following become true:

- the US-first public `watchability` rollout is already stable
- users clearly need spot-level skyline fidelity
- we have a production-safe ingestion path for official Overture monthly assets
- we have a production-safe DEM access pattern for Copernicus
- the added operational cost is justified by measurable user value
