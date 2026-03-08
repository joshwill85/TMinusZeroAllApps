# AR Trajectory — Net-New Data Plan (Phased)

Generated: 2026-01-18  
Scope: Only the AR trajectory feature and the *new / missing* data inputs that will materially improve Tier 2+ accuracy.

Primary reference: `docs/specs/launch-ar-trajectory.md`

---

## 0) Baseline (what exists today)

We already have the storage primitives and a “good enough to ship Tier 0” generator:
- **Trajectory storage**
  - Products: `supabase/migrations/0069_launch_trajectory_products.sql`
  - Constraints: `supabase/migrations/0070_launch_trajectory_constraints.sql`
- **Core launch inputs for AR**
  - Pad coordinates in public cache: `supabase/migrations/0068_public_cache_pad_coords.sql`
  - Timeline (when present) for expiry + events: stored on `launches_public_cache` and consumed by `supabase/functions/trajectory-products-generate/index.ts`
- **Current generators/ingestors (server-side)**
  - Product generator: `supabase/functions/trajectory-products-generate/index.ts`
  - LL2 landings fetcher: `lib/ingestion/ll2Landings.ts`
  - LL2 landings → constraints: `supabase/functions/trajectory-constraints-ingest/index.ts`
  - Press kit / mission docs orbit parsing: `supabase/functions/trajectory-orbit-ingest/index.ts`
  - Hazard polygons + matching (NAVCEN BNM): `supabase/functions/navcen-bnm-ingest/index.ts`
  - SpaceX infographics → constraints (already automated): `supabase/functions/spacex-infographics-ingest/index.ts`

This plan is about **net-new data acquisition + ingestion** to improve accuracy (not UI work).

---

## 1) The “missing data” (what we don’t reliably have yet)

### A) Hazard / keep‑out areas with geometry + time windows (Tier 2)

Why it helps:
- Constrains plausible azimuth corridors.
- Lets us reject obviously wrong templates for a given range/pad/time window.

What we need (normalized fields in a constraint row):
- `geometry`: GeoJSON `Polygon|MultiPolygon` in WGS84 (EPSG:4326)
- `data.validStartUtc`, `data.validEndUtc` (ISO strings)
- `data.title` and a short `data.rawTextSnippet` (debuggability)
- Provenance: `source`, `source_id` (e.g., bulletin identifier), and a `data.sourceUrl`

Where to find it (selection required; start US-only):
- Public aviation + maritime hazard advisories (e.g., NOTAM / NOTMAR-style notices) that publish:
  - coordinate lists defining keep‑out areas, and
  - start/end times when the area is active.

How it lands in our system:
- Stored as `launch_trajectory_constraints` with `constraint_type='hazard_area'` and `geometry` populated.

### B) Target orbit parameters (numeric inclination/altitude) (Tier 2)

Why it helps:
- Numeric inclination (even without a full trajectory) enables a much better initial azimuth corridor than today’s heuristic defaults.

What we need (normalized fields in a constraint row):
- `data.inclination_deg` (most valuable)
- optional: `data.altitude_km`, `data.apogee_km`, `data.perigee_km`
- optional: `data.orbit_class` (LEO/GTO/SSO/etc; helpful fallback)
- Provenance: `data.sourceUrl`, `data.documentHash`, `data.parserVersion`, and parse confidence

Where to find it (practical and implementable with our current schema):
- **Press kits / mission docs linked from LL2**
  - Candidate URLs already exist in our data via `launches_public_cache.launch_info_urls` and `mission_info_urls` (see columns added in `supabase/migrations/0012_launch_detail_media_links.sql`).
  - The net-new work is automatically fetching + parsing those URLs (not relying on file uploads).

How it lands in our system:
- Stored as `launch_trajectory_constraints` with `constraint_type='target_orbit'`.

### C) A data-driven “template library” (Tier 1, plus Tier 2 fallback)

Why it helps:
- For launches with no hazards and no inclination, we still want templates learned from real missions (not hard-coded azimuth guesses).

What we need (a derived dataset we do not have today):
- Per `(site|pad, vehicle_family, orbit_class)`:
  - `azimuth_mean_deg`, `azimuth_sigma_deg`, `sample_count`
  - optional: coarse ascent profile parameters (still generic, but tuned)

Where to find it:
- Derived internally from the constraints we ingest over time:
  - `target_orbit` (best input)
  - `hazard_area` (corridor constraint)
  - `landing` (weak input; treat as validation/sanity only)

How it lands in our system (net new table recommended):
- New table: `public.trajectory_templates` (JSON payload + versioning + stats).

---

## 2) Constraint schemas (what we will store)

We will store all net-new inputs in `launch_trajectory_constraints` so product generation has a single read path.

### `constraint_type='hazard_area'`

- `geometry`: GeoJSON Polygon/MultiPolygon (WGS84)
- `data`: JSON:
  - `validStartUtc`: string
  - `validEndUtc`: string
  - `title`: string
  - `sourceUrl`: string
  - `rawTextSnippet`: string (short; debugging only)
  - `extractedCoords`: optional original coordinate list (if needed)

### `constraint_type='target_orbit'`

- `geometry`: null
- `data`: JSON:
  - `inclination_deg`: number | null
  - `altitude_km`: number | null
  - `apogee_km`: number | null
  - `perigee_km`: number | null
  - `orbit_class`: string | null
  - `sourceUrl`: string
  - `documentHash`: string (sha256)
  - `parserVersion`: string
  - `evidence`: optional short substring(s) showing why we believe the parse

Confidence:
- `confidence >= 0.9` only when we can point to a deterministic parse from a pinned document hash.
- `confidence <= 0.7` for ambiguous parses or OCR/text-extraction failures.

---

## 3) Phased implementation plan (net new)

### Phase 0 — Make constraints “observable” (1–2 days)

Goal: when we say “AR uses constraints”, we can see which constraints exist per eligible launch and why.

Work:
1. Add a lightweight admin/debug endpoint (or SQL helper) that outputs, for the eligible launches:
   - constraint types present, `fetched_at`, `confidence`, and `source`.
2. Standardize `source` naming and `parserVersion` strings so we can track changes over time.

### Phase 1 — Make LL2 landings constraints always-on (2–4 days)

Even though we can fetch LL2 landings today, we don’t have it as a guaranteed/refreshed dataset in prod.

Work:
1. Add a new Edge job (net new):
   - `supabase/functions/trajectory-constraints-ingest/index.ts`
   - Computes eligible launches using the same expiry/window rules as AR product generation
   - Fetches LL2 landings and upserts `constraint_type='landing'`
2. Add `system_settings` flags:
   - `trajectory_constraints_job_enabled`
   - `trajectory_constraints_limit`, `trajectory_constraints_lookahead`
3. Schedule via `pg_cron` using `public.invoke_edge_job()` (same pattern as other jobs).

Exit criteria:
- At least the next 3 eligible launches always have a “landing” constraint row when LL2 provides one.

### Phase 2 — Automated press kit discovery + orbit parsing (1–2 weeks)

Goal: populate `target_orbit` constraints automatically, using URLs already attached to launches.

Work:
1. Discovery (per eligible launch):
   - Extract candidate URLs from:
     - `launches_public_cache.launch_info_urls`
     - `launches_public_cache.mission_info_urls`
2. Fetch + cache (net new tables recommended):
   - `public.trajectory_source_documents`:
     - `url`, `content_type`, `fetched_at`, `sha256`, `status`, `error`, optional extracted `text`
   - Rationale: avoid re-fetching PDFs every run; keep provenance + debuggability.
3. Parse:
   - Reuse/extend the parsing heuristics in `supabase/functions/trajectory-orbit-ingest/index.ts` (inclination/apogee/perigee/altitude keywords).
   - Persist a single `target_orbit` constraint row per `(launch_id, sourceUrl, documentHash)` with confidence.
4. Manual override path (still net new, but simple):
   - Admin can paste a URL (or upload a doc) and attach it to a launch, forcing a parse.

Exit criteria:
- For a representative set of upcoming launches, we can show inclination (when present in docs) and prove provenance via `sourceUrl + sha256`.

### Phase 3 — Hazard polygons ingestion (2–4+ weeks; start small)

Goal: ingest time-bounded hazard polygons and match them to launches conservatively.

Work:
1. Pick one initial “hazard bulletin” format and build a parser that yields GeoJSON.
2. Build a 3-stage pipeline:
   - Fetch: store raw documents in a cache table (`hazard_source_documents` or reuse `trajectory_source_documents` with a `kind` column).
   - Normalize: produce candidate polygons + time windows in a staging table.
   - Match: attach to launches (time overlap + range/pad hints) and upsert `constraint_type='hazard_area'` with a conservative `confidence`.
3. Keep a manual escape hatch by inserting admin-only rows into `launch_trajectory_constraints` (or extending `navcen-bnm-ingest` to support additional hazard formats).

Exit criteria:
- For Cape/Vandenberg launches where hazards are published, the next 3 eligible launches have at least one matched hazard polygon with a valid window.

### Phase 4 — Build a template library (ongoing)

Goal: replace hard-coded azimuth heuristics with learned templates once we have enough samples.

Work:
1. Add a new table: `public.trajectory_templates` (new migration).
2. Add a job that periodically recomputes templates from historical constraints:
   - Prefer `target_orbit` as the “gold” input (derive azimuth corridor from inclination + pad latitude).
   - Use `hazard_area` to tighten/validate.
   - Use `landing` only as weak validation (do not overfit to landing sites).
3. Update trajectory generation to consult templates first (fallback to heuristics only when no template exists).

Exit criteria:
- We can point to a template row powering Tier 1 products for common `(pad, vehicle_family, orbit_class)` combinations.

### Phase 5 — Close the loop (measurement + iteration) (ongoing)

Goal: know whether new constraints actually improve usability.

Work:
1. Ensure trajectory products record which constraints they used in `product.assumptions[]`.
2. Use privacy-preserving AR session summaries (already in schema):
   - `supabase/migrations/0071_ar_camera_guide_sessions.sql`
3. Track success signals that don’t require PII:
   - fewer retries, fewer fallbacks, longer sessions, improved “heading_status”.

---

## 4) How trajectory generation will consume net-new data

Constraint priority order (most → least valuable):
1. `target_orbit` → compute azimuth corridor (best)
2. `hazard_area` → narrow corridor / reject implausible azimuths
3. `trajectory_templates` → fallback learned priors
4. `landing` → sanity check only (weak correlation)

Reference generator to evolve: `supabase/functions/trajectory-products-generate/index.ts`
