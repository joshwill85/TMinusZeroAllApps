# AR Trajectory — Model Upgrade Data Deep Dive

Date: 2026-01-24  
Question: “Do we have data for trajectory model upgrades?”  
Scope: Server-side trajectory products (`launch_trajectory_products`) and the constraints pipeline (`launch_trajectory_constraints`).

## 0) What “trajectory model upgrade” means (so we don’t talk past each other)

Our current products are a **time-indexed 3D corridor** (ECEF samples + uncertainty) that the client projects into camera space. Upgrading the model can mean:

1) **Better direction constraints (azimuth) + uncertainty**  
   High impact, feasible with existing constraint types.

2) **Better vertical profile (elevation vs T+)**  
   Medium impact; can be improved per rocket family/orbit type, but rarely “mission-specific” without new data.

3) **Better downrange profile (distance vs T+)**  
   Medium impact; can be tightened with landing constraints and some mission classes, but still largely heuristic.

4) **Truly mission-specific 3D path (doglegs, plane changes, injection profile)**  
   High impact but generally **not feasible** from LL2 alone. Needs either authoritative per-mission trajectory data or a licensed simulator feed.

## 1) Inventory: data we already have (and where it comes from)

### A) Launch metadata (LL2 via our ingestion)
Available in `launches_public_cache` and used by product generation:
- Pad lat/lon, pad name, location name
- Vehicle/rocket family
- Mission orbit category (string)
- Timeline events (for expiry + milestone chips)
- `flightclub_url` (link only)

### B) Constraint types we already ingest (automated jobs)
Stored in `launch_trajectory_constraints`:

1) **Landing constraints** (`constraint_type='landing'`)
- Source: LL2 landings (`trajectory-constraints-ingest`).
- Valuable fields:
  - landing lat/lon (sometimes)
  - downrange distance (often)
  - landing type (booster vs spacecraft recovery is not always trivially separable)
- Primary value: constrains likely downrange direction and distance scale.

2) **Target orbit constraints** (`constraint_type='target_orbit'`)
- Source: press kits / mission docs parsing (`trajectory-orbit-ingest`) plus derived fallbacks.
- Potentially available numeric fields (when present in documents):
  - `flight_azimuth_deg` (best for direction)
  - `inclination_deg` (good for direction)
  - `altitude_km`, `apogee_km`, `perigee_km` (used to tune Tier‑2 altitude cap when present)
- Primary value: constrains likely launch azimuth even when landing info is missing.

3) **Hazard areas** (`constraint_type='hazard_area'`)
- Source: NAVCEN BNM ingest (`navcen-bnm-ingest`).
- Data: polygons + validity windows.
- Primary value: can constrain plausible azimuth corridor when matched reliably.
- Current limitation: coverage is not globally comprehensive; matching is conservative.

4) **Mission infographics** (`constraint_type='mission_infographic'`)
- Source: SpaceX website API (`spacex-infographics-ingest`).
- Data: infographic image URLs + matching metadata.
- Primary value today: display only (no structured numbers extracted yet).

## 2) What we currently do with that data (today’s generator behavior)

Generator: `supabase/functions/trajectory-products-generate/index.ts`

### Tier 0 — pad_only
- Only a pad marker at T+0.

### Tier 1 — landing_constrained
- Uses landing location (if lat/lon exists) to constrain **azimuth corridor**, not a “landing arc”.
- Altitude and downrange profiles are generic.

### Tier 2 — estimate_corridor
- First tries `target_orbit` constraints for direction:
  - Use `flight_azimuth_deg` if present, else
  - derive candidate azimuth(s) from `inclination_deg` and choose a plausible one using site/missions heuristics.
- Else tries hazards for direction (hazard-derived azimuth).
- Else falls back to hard-coded heuristic azimuth estimates by site/mission class.
- Altitude/downrange profiles remain generic.

## 3) The big answer: do we have data for “model upgrades”?

### Yes — for **direction and corridor quality** (Tier 2 improvements)
We already ingest enough to materially improve Tier 2 direction accuracy for many launches:
- More consistent `target_orbit` ingestion + better constraint ranking
- Hazard time-window gating + expanded hazard coverage sources
- Better “template priors” built from historical constraints (once enough data accumulates)

### Partially — for **vertical/downrange profile shaping**
We have some inputs that can improve plausibility, but not true mission specificity:
- Rocket family + timeline events can tune ascent profile parameters (e.g., typical MECO-ish times)
- Orbit altitude/apogee/perigee (when parsed) can tune “how high by when” targets
- Landing downrange distance can scale corridor distance

### No (today) — for **FlightClub-grade mission-specific trajectories**
We do not currently ingest a per-mission waypoint list, pitch program, or simulator output. LL2 provides a `flightclub_url` as a link only, not structured trajectory data.

## 4) “Free” upgrades we can do using existing data (recommended)

1) **Use more of `target_orbit` fields**
- Today we use only azimuth + inclination. We can also use:
  - `altitude_km` / `apogee_km` / `perigee_km` to tune `altMaxM`, duration, and uncertainty growth.

2) **Improve `target_orbit` selection**
- Current selection is confidence-first. Add recency and “derived penalty” so doc-sourced constraints win when available.

3) **Hazard time-window gating**
- Only use hazard-derived azimuth when the hazard window plausibly overlaps launch NET.

4) **Build a template library**
- Once enough constraints exist historically, generate `(pad/site, vehicle_family, orbit_class)` priors to replace hard-coded heuristics.

## 5) New data sources to evaluate (for true step-change accuracy)

This is where we need explicit product/legal decisions:

1) **FlightClub**
- LL2 already stores `flightclub_url` (link). If FlightClub exposes structured data we can access *legally*, this could unlock much tighter Tier-2/Tier-3 products.
- Risk: ToS/licensing. We should treat this as “investigate + decide” before any implementation.

2) **Provider press kits and regulatory filings**
- Orbit/azimuth/inclination numbers are often present (PDFs/HTML).
- Our pipeline already supports doc caching + parsing; we likely need to broaden allowlists and parsing patterns.

3) **Hazard sources beyond NAVCEN**
- Needed for non-Cape and non-US coverage.
- Region-by-region feasibility varies; plan should be staged (US-first, then expand).

4) **Mission infographic OCR**
- Only worth it if extraction is reliable enough (high precision/recall). Otherwise, keep as display-only.

## 6) Recommended roadmap (how to turn this into upgrades safely)

### Near-term (P2)
- Improve constraint ranking + hazard gating.
- Expand orbit doc coverage (allowlist + parsing patterns) where safe.
- Run an infographic OCR feasibility spike and make a go/no-go call.
- Produce a written “data sources roadmap” with explicit feasibility + ToS notes.

### Mid-term (P2 → P3)
- Add template generation job and consult templates before heuristics.

### Long-term (P4+)
- Tier-3 vision lock-on for photo-useful guidance regardless of compass limitations.
- Only pursue FlightClub (or equivalent) after explicit ToS/licensing approval.
