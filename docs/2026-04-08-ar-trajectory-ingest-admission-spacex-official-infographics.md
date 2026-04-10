# 2026-04-08 AR Trajectory Ingest Admission Review: SpaceX Official Infographics

Last updated: 2026-04-08

## Review Metadata

- Review date: 2026-04-08
- Reviewer: Codex
- Source family: SpaceX official mission infographic and mission-bundle assets
- Proposed ingest or adapter name: `supabase/functions/spacex-infographics-ingest`
- Target fields or artifacts:
  - `mission_infographic`
  - landing-hint corroboration
  - mission bundle assets for supporting launch context
- Intended use:
  - recovery authority
  - corroboration only
- Product impact:
  - customer-facing: yes
  - admin/internal impact: yes
  - shared API/backend impact: yes

## Admission Decision

- Decision: `pass`
- Decision summary: The existing SpaceX adapter is admitted for continued implementation and maintenance, but only for corroborative infographic and landing-hint use on SpaceX launches.
- Blocking reason if not `pass`: none for this narrow scope
- Next action: keep the adapter in service, add parser fixtures and health visibility, and do not widen its authority beyond the allowed scope below
- Registry entry to update: `docs/2026-04-08-ar-trajectory-ingest-admission-registry.md`

## Question 1: Availability

Question: is the data we want actually available from this source in a usable form?

- Source location:
  - SpaceX public mission content referenced through mission tiles and mission bundle assets
  - launch-linked `launch_info_urls` and `mission_info_urls` already stored in `launches_public_cache`
- Access mode:
  - public unauthenticated
- Artifact type:
  - mixed
- Desired fields:
  - infographic asset availability
  - launch page URL
  - landing-hint content when present
- Sample size reviewed:
  - repo evidence only
  - current system snapshot shows `mission_infographic: 64`
- Evidence summary:
  - the repo already ships `spacex-infographics-ingest`
  - the adapter reads `launch_info_urls` and `mission_info_urls`
  - the adapter writes `mission_bundle` resources plus `mission_infographic` constraint rows
  - the current system spec reports a non-trivial existing `mission_infographic` inventory
- Result: `yes`
- Notes: Availability is proven for the narrow SpaceX infographic bundle scope, not for generic mission-truth extraction.

## Question 2: Joinability

Question: if the data is available, can we reliably join it to T-Minus Zero launch identity?

- Candidate join keys:
  - provider
  - mission name
  - launch page URL
  - mission page URL
  - mission id
- Deterministic join rule:
  - start from SpaceX launches in `launches_public_cache`
  - derive `missionId` from `launch_info_urls` or `mission_info_urls`
  - match against the SpaceX mission-tile map
- Expected ambiguous cases:
  - launches without usable mission URLs
  - missions with incomplete or changed public content
- Manual fallback allowed: yes
- Result: `yes`
- Notes: Joinability is good enough for the current SpaceX-only adapter because the join starts from already-known T-Minus Zero launches rather than from a free-form site crawl.

## Question 3: Usable Coverage

Question: if we can join it, do enough of our real launches actually have the values we need?

- Eligible launch window used for audit:
  - current repo snapshot and active adapter behavior
- Launches sampled:
  - repo evidence only
- Launches with usable values:
  - enough to produce `64` `mission_infographic` rows in the current system snapshot
- Coverage rate:
  - not promoted to a repo-wide percentage in this review
- Missing-pattern summary:
  - coverage depends on SpaceX launches exposing mission URLs and infographic assets
  - this does not generalize to non-SpaceX providers
- Result: `yes`
- Notes: Coverage is admitted only for the intended SpaceX subset and only for corroborative infographic/landing-hint use.

## Operational Readiness

- Parser fixture plan:
  - formalize fixtures for `spacex_content_mission_infographic_v2`
- Freshness / SLA expectation:
  - launch-window-sensitive, because SpaceX precision cases already receive stricter completeness treatment
- Failure mode severity:
  - medium to high near launch if the source disappears on a mission that relies on infographic corroboration
- Manual override requirement: yes
- Attribution and expiry requirement:
  - required for any manual landing-hint or infographic override
- Security / legal concern:
  - public web content only; keep attribution and do not elevate this source into direct ascent-truth status

## Final Recommendation

- Recommended action:
  - implement now
- Exact scope allowed:
  - maintain and improve the existing SpaceX infographic adapter
  - use it for `mission_infographic` corroboration and landing-hint extraction
  - keep parser-fixture coverage in `scripts/spacex-infographics-corpus-smoke.ts`
  - add health metrics and manual override handling
- Exact scope not allowed:
  - do not treat SpaceX infographic assets as direct ascent-truth geometry
  - do not use this source alone to rewrite branch topology or milestone timing
  - do not generalize this decision to other providers
- Follow-up owner:
  - Backend/Data
- Follow-up date:
  - next Phase 2 source-adapter hardening slice

## Evidence Links

- Roadmap or policy doc:
  - `docs/2026-04-08-ar-trajectory-v3-data-and-roadmap-plan.md`
- Current system evidence:
  - `docs/2026-04-07-ar-trajectory-current-system-spec.md`
- Sample source artifacts:
  - `supabase/functions/spacex-infographics-ingest/index.ts`
- Related scripts or adapters:
  - `supabase/functions/spacex-infographics-ingest/index.ts`
  - `scripts/spike-spacex-infographic-ocr.ts`
