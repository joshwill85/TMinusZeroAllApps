# SpaceX “Mission Infographic” OCR Feasibility Spike (AR Trajectory)

Date: 2026-01-25  
Scope: `constraint_type='mission_infographic'` (SpaceX website CMS `missions/{missionId}` → `infographicDesktop/infographicMobile`)

## Goal

Determine whether SpaceX “mission infographics” contain **reliable, extractable orbit parameters** (e.g., inclination, altitude, apogee/perigee, azimuth) worth incorporating into Tier-2 trajectory generation.

This is **not** a SpaceX press-kit (PDF) evaluation. Press kits (when present) are expected to arrive near launch and are handled by the orbit/doc ingestion job.

## Method

- Implemented a local spike script: `scripts/spike-spacex-infographic-ocr.ts`
  - Pulls mission IDs from SpaceX tiles or accepts explicit `--mission-ids=...`.
  - Fetches infographic images from the SpaceX CMS mission endpoint.
  - Runs OCR with a local Dockerized Tesseract (no new npm deps required in this environment).
  - Attempts to parse orbit terms (`SSO/GTO/LEO/...`) plus numeric fields (`inclination °`, `altitude km`, `apogee/perigee km`).
- Sampled a mixed set of SpaceX missions (recent + upcoming), including:
  - Starlink, commercial, crew, science, rideshare, NSSL, Starship.

## Result

Across the sampled missions:

- Most infographics were **template flight-profile diagrams** (e.g., droneship landing, landing zone, no recovery, Dragon separation), not mission-specific “orbit cards”.
- OCR returned **generic labels** such as “STAGE SEPARATION”, “FAIRING SEPARATION”, “ENTRY BURN”, etc.
- Parsed orbit parameters were **consistently absent** (no inclination/altitude/apogee/perigee detected), including for a Starship infographic.

## Decision (Go/No-Go)

**No-Go** for using `mission_infographic` OCR as an accuracy input for trajectory generation today.

We should keep `mission_infographic` as **display-only** data unless/until SpaceX changes the infographic format to include structured orbit numbers at high precision/recall.

## Next-best path for SpaceX orbit accuracy

If we want SpaceX orbit parameters:

- Focus on **press kits / mission docs** ingestion and parsing, which is expected to appear near launch (job-based), rather than OCR of these infographic templates.

