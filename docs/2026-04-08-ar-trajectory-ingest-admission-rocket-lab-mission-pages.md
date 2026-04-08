# 2026-04-08 AR Trajectory Ingest Admission Review: Rocket Lab Mission Pages

Last updated: 2026-04-08

## Review Metadata

- Review date: 2026-04-08
- Reviewer: Codex
- Source family: Rocket Lab missions and updates pages
- Proposed ingest or adapter name:
  - future provider-specific adapter
  - current repo seed references in `supabase/functions/trajectory-orbit-ingest/index.ts`
- Target fields or artifacts:
  - mission-page URLs
  - update-page URLs
  - any future trajectory-relevant mission fields
- Intended use:
  - direction authority
  - milestone authority
  - corroboration only
- Product impact:
  - customer-facing: yes
  - admin/internal impact: yes
  - shared API/backend impact: yes

## Admission Decision

- Decision: `defer`
- Decision summary: Rocket Lab source pages are known and already seeded as candidate URLs, but they are not admitted for ingest implementation because availability, joinability, and coverage have not been audited at the field level.
- Blocking reason if not `pass`: field-level evidence does not yet exist in the repo
- Next action: run a source sample audit before writing any Rocket Lab-specific ingest
- Registry entry to update: `docs/2026-04-08-ar-trajectory-ingest-admission-registry.md`

## Question 1: Availability

Question: is the data we want actually available from this source in a usable form?

- Source location:
  - `https://rocketlabcorp.com/missions/`
  - `https://rocketlabcorp.com/updates/`
- Access mode:
  - public unauthenticated
- Artifact type:
  - HTML
- Desired fields:
  - mission-page URLs
  - launch-specific mission details
  - any direction, milestone, or visibility hints if present
- Sample size reviewed:
  - repo seed references only
- Evidence summary:
  - the orbit-ingest path already seeds Rocket Lab missions and updates pages as derived source candidates
  - the backlog also calls out Rocket Lab mission/update page seeds
- Result: `partial`
- Notes: The existence of candidate pages is known, but field presence has not been audited.

## Question 2: Joinability

Question: if the data is available, can we reliably join it to T-Minus Zero launch identity?

- Candidate join keys:
  - provider
  - mission name
  - launch name
  - NET / window
  - canonical URL
- Deterministic join rule:
  - not yet proven
- Expected ambiguous cases:
  - multiple updates per mission
  - update pages that are not launch-specific
  - naming drift between Launch Library 2 and provider pages
- Manual fallback allowed: yes
- Result: `partial`
- Notes: There is no provider-specific deterministic join implementation in the repo yet.

## Question 3: Usable Coverage

Question: if we can join it, do enough of our real launches actually have the values we need?

- Eligible launch window used for audit:
  - no field-level audit completed yet
- Launches sampled:
  - none
- Launches with usable values:
  - unknown
- Coverage rate:
  - unknown
- Missing-pattern summary:
  - current evidence stops at page-seed discovery
- Result: `no`
- Notes: This is the current stop condition. No Rocket Lab ingest should be built until a field-level audit exists.

## Operational Readiness

- Parser fixture plan:
  - not started
- Freshness / SLA expectation:
  - unknown until the source structure is audited
- Failure mode severity:
  - medium if the source is assumed ready prematurely
- Manual override requirement: yes if later promoted
- Attribution and expiry requirement:
  - required for any future production use
- Security / legal concern:
  - public site crawl only; confirm crawl tolerance before automation grows

## Final Recommendation

- Recommended action:
  - defer until source conditions improve
- Exact scope allowed:
  - run a low-cost source sample audit
  - document joinability candidates and usable coverage
- Exact scope not allowed:
  - do not scaffold a Rocket Lab ingest yet
  - do not rely on the current derived URL seeds as proof of production readiness
- Follow-up owner:
  - Backend/Data
- Follow-up date:
  - after a source sample audit is completed

## Evidence Links

- Roadmap or policy doc:
  - `docs/2026-04-08-ar-trajectory-v3-data-and-roadmap-plan.md`
- Current system evidence:
  - `docs/ar-trajectory-execution-backlog-2026-02-10.md`
- Sample source artifacts:
  - `supabase/functions/trajectory-orbit-ingest/index.ts`
- Related scripts or adapters:
  - `supabase/functions/trajectory-orbit-ingest/index.ts`
