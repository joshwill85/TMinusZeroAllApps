# LL2 Data Relationships (Quick Map)

- `launch`
  - `launch_service_provider` → agency (provider/operator)
  - `rocket.configuration` → vehicle config (e.g., “Falcon 9 Block 5”)
    - `manufacturer` → agency for vehicle
    - `program[]` → related programs (each with agencies)
    - performance fields: `maiden_flight`, `leo_capacity`, `gto_capacity`, `reusable`, etc.
  - `mission`
    - `type`, `description`, `orbit`
    - `agencies[]` → mission agencies
    - `crew[]` (via launch.crew) → astronauts + roles (when crewed)
  - `pad`
    - `location` (timezone, state/country, map image)
    - `map_url`, `lat/lon`, `country_code`
- `last_updated` → use for incremental sync/change detection (with overlap window); CDC is supplemented by LL2 event ingestion.

# SNAPI Join Tables
- `snapi_items` → article/blog/report metadata from Spaceflight News API.
- `snapi_item_launches` → bridge to internal `launches.id` via LL2 launch UUIDs referenced by SNAPI.

# APIs Leveraged
- LL2 `/launch` (list + detail) — primary data source for schedule + detail (provider, mission, rocket, pad, programs, crew). US-only filtering uses `location__ids` cached from `/location?country_code=USA` into `system_settings.ll2_us_location_ids`.
- SNAPI v4 `/articles`, `/blogs`, `/reports` — related news metadata joined via LL2 launch UUIDs.
- Supabase/Postgres — persistence, RLS, notification/prefs/subscriptions.

# Launch Object Inventory (LL2 + CelesTrak INTDES)
- `launches.launch_designator` is the COSPAR join key used for CelesTrak `INTDES=...` queries.
- LL2 manifest source:
  - `ll2_payload_flights` (+ `ll2_payloads`) for intended payload manifest entries.
- Cataloged object source:
  - `launch_object_inventory_snapshots` stores change-only snapshot metadata per launch designator.
  - `launch_object_inventory_snapshot_items` stores normalized SATCAT objects per snapshot (PAY/RB/DEB/UNK).
  - `celestrak_intdes_datasets` tracks freshness/state (`catalog_state`, `last_checked_at`, `latest_snapshot_id`).
- Canonical satellite table remains:
  - `satellites` (latest SATCAT metadata per NORAD catalog ID).
- Public launch detail read path:
  - `get_launch_object_inventory_v1(ll2_launch_uuid, include_orbit, history_limit)` returns:
    - inventory status/freshness
    - reconciliation counts (LL2 payload manifest vs SATCAT payload/object counts)
    - SATCAT payload + non-payload object lists
    - recent snapshot history metadata

# Detail Page Data (from cached LL2 fields)
- Now served from Supabase public cache; no runtime LL2 calls on the site.
- Mission: name, type, orbit, description, agencies.
- Rocket: full name, family, description, manufacturer, performance stats when available.
- Service provider: name, type, country, description.
- Pad: pad name/code, map URL, lat/lon, location/timezone.
- Crew: astronaut name + role when present.

# LL2 Catalog (Info Page)
- Base tables (`ll2_*`) are RLS-locked; UI reads from `ll2_catalog_public_cache`.
- Join points to launches:
  - `launches.ll2_agency_id` → `ll2_agencies.ll2_agency_id`
  - `launches.ll2_pad_id` → `ll2_pads.ll2_pad_id` → `ll2_locations.ll2_location_id`
  - `launches.ll2_rocket_config_id` → `ll2_rocket_configs.ll2_config_id`
  - `ll2_docking_events.launch_id` → `launches.ll2_launch_uuid`
  - `ll2_event_launches.launch_id` → `launches.id` (LL2 events already mapped)
  - `ll2_astronaut_launches` + `ll2_launcher_launches` store LL2 launch UUIDs (plus internal `launch_id` when matched).
