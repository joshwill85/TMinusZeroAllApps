# 2026-04-08 AR Trajectory Ingest Admission Review: Blue Origin Mission Pages

Last updated: 2026-04-08

## Review Metadata

- Review date: 2026-04-08
- Reviewer: Codex
- Source family: Blue Origin official mission pages and missions/news index
- Proposed ingest or adapter name: `supabase/functions/blue-origin-missions-ingest`
- Target fields or artifacts:
  - official mission-page URLs
  - flight-code linkage
  - timeline-context events
- Intended use:
  - corroboration only
- Product impact:
  - customer-facing: yes
  - admin/internal impact: yes
  - shared API/backend impact: yes

## Admission Decision

- Decision: `defer`
- Decision summary: Blue Origin official pages are real and already useful for discovery and timeline context, but they are not yet admitted as trajectory-truth ingest because field-level usefulness is not proven.
- Blocking reason if not `pass`: usable coverage for direction, milestone, recovery, and visibility values is not yet demonstrated
- Next action: keep URL discovery and source-document capture, then run a provider-specific field audit before any trajectory-truth adapter is built
- Registry entry to update: `docs/2026-04-08-ar-trajectory-ingest-admission-registry.md`

## Question 1: Availability

Question: is the data we want actually available from this source in a usable form?

- Source location:
  - `https://www.blueorigin.com/missions`
  - linked mission pages discovered from that crawl
- Access mode:
  - public unauthenticated
- Artifact type:
  - HTML
- Desired fields:
  - official mission URL
  - flight code
  - any future trajectory-relevant fields if they exist
- Sample size reviewed:
  - repo evidence only
- Evidence summary:
  - the repo already crawls the Blue Origin missions page
  - it stores source-document metadata
  - it extracts mission links and timeline events
- Result: `yes`
- Notes: Availability is proven for page discovery, not for structured trajectory fields.

## Question 2: Joinability

Question: if the data is available, can we reliably join it to T-Minus Zero launch identity?

- Candidate join keys:
  - provider
  - launch name
  - mission name
  - flight code
  - launch id
- Deterministic join rule:
  - current code classifies Blue Origin launches from `launches_public_cache`
  - it extracts a flight code from launch naming and mission links where possible
- Expected ambiguous cases:
  - missions without stable flight-code references
  - multiple Blue Origin programs with similar naming
  - launch rows that have only generic provider branding
- Manual fallback allowed: yes
- Result: `partial`
- Notes: Joinability is good enough for discovery and timeline context, but not yet strong enough to admit field-level truth extraction without a more explicit audit.

## Question 3: Usable Coverage

Question: if we can join it, do enough of our real launches actually have the values we need?

- Eligible launch window used for audit:
  - current repo evidence only
- Launches sampled:
  - repo evidence only
- Launches with usable values:
  - sufficient for mission-link indexing and timeline context
- Coverage rate:
  - unknown for direction, milestones, recovery, and visibility fields
- Missing-pattern summary:
  - the current adapter proves page discovery, not trajectory-value presence
  - no repo evidence currently shows useful field coverage for a trajectory-truth adapter
- Result: `no`
- Notes: This is the stop condition for any new Blue Origin trajectory-truth ingest at the current stage.

## Operational Readiness

- Parser fixture plan:
  - add fixtures only after a field-level audit proves the target fields exist often enough to matter
- Freshness / SLA expectation:
  - moderate for mission-link indexing; unproven for launch-critical truth fields
- Failure mode severity:
  - low for timeline context
  - high if mistakenly treated as trajectory truth before coverage is proven
- Manual override requirement: yes
- Attribution and expiry requirement:
  - required if any mission-page field is ever promoted into launch-window truth
- Security / legal concern:
  - public site crawl only; preserve attribution and rate-limit discipline

## Final Recommendation

- Recommended action:
  - defer until source conditions improve
- Exact scope allowed:
  - continue official URL discovery
  - continue source-document capture
  - continue timeline-context events
  - run a bounded provider-specific field audit
- Exact scope not allowed:
  - do not build a Blue Origin direction-authority adapter yet
  - do not promote discovered mission pages into milestone, recovery, or visibility truth without a separate `pass`
- Follow-up owner:
  - Backend/Data
- Follow-up date:
  - after a provider-specific field audit is completed

## Evidence Links

- Roadmap or policy doc:
  - `docs/2026-04-08-ar-trajectory-v3-data-and-roadmap-plan.md`
- Current system evidence:
  - `docs/ar-trajectory-execution-backlog-2026-02-10.md`
- Sample source artifacts:
  - `supabase/functions/blue-origin-missions-ingest/index.ts`
- Related scripts or adapters:
  - `supabase/functions/blue-origin-missions-ingest/index.ts`
  - `supabase/functions/_shared/blueOriginSources.ts`
