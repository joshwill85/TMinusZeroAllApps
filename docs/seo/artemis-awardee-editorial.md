# Artemis Awardee SEO Editorial Gate

This project uses `public.artemis_entities` rows with `entity_type='seo_awardee'` to control search index eligibility for recipient pages under `/artemis/awardees/*`.

## Approval Model

- `metadata.seoApprovalState='approved'`: page is indexable and included in sitemap.
- `metadata.seoApprovalState='draft'`: page can render, but emits `noindex` and is excluded from sitemap.
- `metadata.seoApprovalState='rejected'`: page can render, but emits `noindex` and is excluded from sitemap.

## Recommended Row Shape

- `entity_type`: `seo_awardee`
- `entity_key`: `awardee:<slug>`
- `name`: display recipient name
- `description`: optional short summary
- `metadata`:
  - `recipientName`: canonical display name
  - `recipientKey`: normalized recipient key (optional, inferred if omitted)
  - `slug`: canonical page slug
  - `seoApprovalState`: `draft | approved | rejected`
  - `summary`: SEO page summary override
  - `aliases`: string array of known recipient aliases

## Notes

- Approved recipients are still reconciled against Artemis procurement rows at render-time.
- Curated defaults exist in code for initial coverage and can be superseded by DB editorial rows.
