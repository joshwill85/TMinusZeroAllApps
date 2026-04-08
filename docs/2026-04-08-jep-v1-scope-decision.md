# 2026-04-08 JEP V1 Scope Decision

Last updated: 2026-04-08

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

## Re-entry Criteria For Local Obstruction

Local obstruction can return as a later phase only if all of the following become true:

- the US-first public `watchability` rollout is already stable
- users clearly need spot-level skyline fidelity
- we have a production-safe ingestion path for official Overture monthly assets
- we have a production-safe DEM access pattern for Copernicus
- the added operational cost is justified by measurable user value
