# AR Trajectory Ingest Admission Review Template

Last updated: 2026-04-08

Use this before building or expanding any AR trajectory source ingest.

If any of the three admission questions below is `no`, stop. Do not build the ingest unless there is explicit approval for a narrow spike with a written reason and a bounded exit condition.

## Review Metadata

- Review date:
- Reviewer:
- Source family:
- Proposed ingest or adapter name:
- Target fields or artifacts:
- Intended use:
  - launch identity
  - vehicle/family segmentation
  - direction authority
  - milestone authority
  - recovery authority
  - visibility authority
  - corroboration only
- Product impact:
  - customer-facing: yes / no
  - admin/internal impact: yes / no
  - shared API/backend impact: yes / no

## Admission Decision

- Decision: `pass` / `defer` / `reject` / `spike`
- Decision summary:
- Blocking reason if not `pass`:
- Next action:
- Registry entry to update: `docs/2026-04-08-ar-trajectory-ingest-admission-registry.md`

## Question 1: Availability

Question: is the data we want actually available from this source in a usable form?

- Source location:
- Access mode:
  - public unauthenticated
  - public account required
  - private / licensed
  - unknown
- Artifact type:
  - API / JSON
  - HTML
  - PDF
  - image / infographic
  - mixed
- Desired fields:
- Sample size reviewed:
- Evidence summary:
- Result: `yes` / `partial` / `no`
- Notes:

## Question 2: Joinability

Question: if the data is available, can we reliably join it to T-Minus Zero launch identity?

- Candidate join keys:
  - launch id
  - provider / agency
  - vehicle
  - mission name
  - NET / window
  - pad / site
  - canonical URL
  - other:
- Deterministic join rule:
- Expected ambiguous cases:
- Manual fallback allowed: yes / no
- Result: `yes` / `partial` / `no`
- Notes:

## Question 3: Usable Coverage

Question: if we can join it, do enough of our real launches actually have the values we need?

- Eligible launch window used for audit:
- Launches sampled:
- Launches with usable values:
- Coverage rate:
- Missing-pattern summary:
- Result: `yes` / `partial` / `no`
- Notes:

## Operational Readiness

- Parser fixture plan:
- Freshness / SLA expectation:
- Failure mode severity:
- Manual override requirement: yes / no
- Attribution and expiry requirement:
- Security / legal concern:

## Final Recommendation

- Recommended action:
  - implement now
  - defer until source conditions improve
  - reject for current roadmap
  - run bounded spike only
- Exact scope allowed:
- Exact scope not allowed:
- Follow-up owner:
- Follow-up date:

## Evidence Links

- Roadmap or policy doc:
- Current system evidence:
- Sample source artifacts:
- Related scripts or adapters:
