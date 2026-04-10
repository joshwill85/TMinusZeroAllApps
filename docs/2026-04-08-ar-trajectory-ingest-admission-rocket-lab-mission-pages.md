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
- Decision summary: Rocket Lab source pages are known and already seeded as candidate URLs, but they are not admitted for ingest implementation because availability, joinability, and coverage are only proven at the source-sample level, not at the field level for our launches.
- Blocking reason if not `pass`: field-level evidence does not yet exist in the repo
- Next action: keep the source-sample audit, launch-inventory join audit, and field audit current; do not write any Rocket Lab-specific ingest until field-value coverage changes materially
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
  - derived seed references plus a repeatable source-sample audit
- Evidence summary:
  - the orbit-ingest path already seeds Rocket Lab missions and updates pages as derived source candidates
  - the backlog also calls out Rocket Lab mission/update page seeds
  - `npm run audit:rocket-lab:sources` now provides a repeatable sample audit for seed-page availability and same-host candidate-doc discovery
  - on `2026-04-08`, a live `--sample-limit=4` run produced `availability=yes`, `joinability=partial`, `usableCoverage=no`, with `2/2` seed pages reachable, `114` candidate pages discovered, and `0` candidate PDFs discovered from those current seed pages
  - on `2026-04-08`, a live launch-inventory join audit over a bounded `30`-day lookback / `365`-day lookahead window produced `26` Rocket Lab launches, `4` deterministic joins, `9` probable joins, `1` ambiguous join, and `12` launches with no qualifying page match
  - on `2026-04-08`, a live field audit over the `13` deterministic/probable joined launches found only `2` launches with numeric orbit-like values, `4` launches with milestone signals, `0` launches with recovery signals, and `0` launches carrying both a numeric orbit-like field and milestone signals
- Result: `partial`
- Notes: The existence of candidate pages and PDFs is now auditable, but field presence is still not proven across our launches.
  The current live sample also suggests that the present seed pages surface many HTML mission/update pages but do not currently expose first-party PDF press-kit links in an admitted, launch-joined way.

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
- Notes: The repo now has a bounded join-audit implementation, but the current live result is still only `partial` because deterministic coverage is too low and too many launches either map only fuzzily or not at all.

## Question 3: Usable Coverage

Question: if we can join it, do enough of our real launches actually have the values we need?

- Eligible launch window used for audit:
  - no field-level launch audit completed yet
- Launches sampled:
  - none at launch-inventory level
- Launches with usable values:
  - unknown
- Coverage rate:
  - unknown
- Missing-pattern summary:
  - the current sample audit proves seed-page availability and candidate-doc discovery
  - it does not prove direction, milestone, recovery, or visibility values across real T-Minus Zero launches
- Result: `no`
- Notes: This is still the stop condition. A field-level launch audit now exists, and it confirms that current matched-page value coverage is still not enough to admit a Rocket Lab ingest.

## Operational Readiness

- Parser fixture plan:
  - source-sample audit fixtures are now in place for candidate discovery and page-signal scoring
  - launch-inventory join and field-audit fixtures are now in place for deterministic evidence
  - parser fixtures for any true ingest stay blocked until a field-level audit proves enough useful values exist
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
  - run `npm run audit:rocket-lab:sources`
  - run `npm run audit:rocket-lab:joins`
  - run `npm run audit:rocket-lab:fields`
  - keep a low-cost source sample audit in place
  - document joinability candidates and usable coverage gaps
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
  - `scripts/rocket-lab-source-audit.ts`
  - `scripts/rocket-lab-join-audit.ts`
  - `scripts/rocket-lab-field-audit.ts`
