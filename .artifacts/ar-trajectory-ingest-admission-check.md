# AR Trajectory Ingest Admission Check

- generatedAt: 2026-04-08T21:40:50.597Z
- policyVersion: ar_trajectory_ingest_admission_registry_v1
- policyPath: docs/specs/ar-trajectory-ingest-admission-registry-v1.json
- pass: yes

## Summary

- entries=10
- pass=16
- fail=0
- warn=0

## Checks

| Status | Check | Details |
|---|---|---|
| pass | Decision enum | ll2_identity (LL2 launch identity and rocket.configuration.id) decision=pass |
| pass | Pass decision gate | ll2_identity (LL2 launch identity and rocket.configuration.id) clears yes/yes/yes |
| pass | Decision enum | spacex_official_infographics (SpaceX official mission infographic assets) decision=pass |
| pass | Pass decision gate | spacex_official_infographics (SpaceX official mission infographic assets) clears yes/yes/yes |
| pass | Review doc exists | spacex_official_infographics (SpaceX official mission infographic assets) -> docs/2026-04-08-ar-trajectory-ingest-admission-spacex-official-infographics.md |
| pass | Decision enum | blue_origin_mission_pages (Blue Origin official mission pages) decision=defer |
| pass | Review doc exists | blue_origin_mission_pages (Blue Origin official mission pages) -> docs/2026-04-08-ar-trajectory-ingest-admission-blue-origin-mission-pages.md |
| pass | Decision enum | rocket_lab_mission_pages (Rocket Lab mission and updates pages) decision=defer |
| pass | Review doc exists | rocket_lab_mission_pages (Rocket Lab mission and updates pages) -> docs/2026-04-08-ar-trajectory-ingest-admission-rocket-lab-mission-pages.md |
| pass | Decision enum | faa_navcen_hazard_geometry (FAA / NAVCEN hazard geometry) decision=pass |
| pass | Pass decision gate | faa_navcen_hazard_geometry (FAA / NAVCEN hazard geometry) clears yes/yes/yes |
| pass | Decision enum | public_faa_live_truth (public FAA live or geospatial surfaces as consumer ascent truth) decision=reject |
| pass | Decision enum | official_visibility_maps (provider or agency visibility maps and interactive visibility assets) decision=defer |
| pass | Decision enum | special_event_priors (mission-specific special-event priors such as relights, venting, tracer-style events) decision=defer |
| pass | Decision enum | ocr_first_infographics (OCR-first infographic extraction without stronger source coverage) decision=defer |
| pass | Decision enum | partner_live_feeds (operator-provided or licensed partner live feeds) decision=defer |

