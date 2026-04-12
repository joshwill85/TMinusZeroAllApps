# 2026-04-11 News + Info Native Excellence Plan

## Platform Matrix

- Customer-facing: yes
- Web: included as reference surface and `/api/v1` host
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Summary

- Deliver one shared Expo implementation that makes mobile `news` and `info/docs` feel handheld-first rather than like hosted-web fallbacks.
- Keep customer-facing destinations and business rules aligned with web, but use native browse, native detail, native deep links, native search resolution, native handoff, and richer motion/layout on iOS and Android.
- Use a hybrid native news model: the app owns stream discovery and article detail, while full publisher-body reading still hands off through an in-app browser or explicit external-source action.

## Scope

- Add dedicated native routes for `/about` and `/news/[id]`.
- Treat `/docs/about` as an alias to `/about`, and keep `/docs/faq` plus `/docs/roadmap` as real native screens instead of collapsing them back to the docs hub.
- Extend the shared route normalization layer so `/info`, `/about`, `/docs/about`, `/docs/faq`, `/docs/roadmap`, `/news`, `/news/[id]`, `/jellyfish-effect`, `/support`, and `/legal/*` resolve natively on mobile.
- Rebuild the native news index into a premium stream with persisted filters, provider picker sheet, pull-to-refresh, pagination, retry/error states, and recent-item recall.
- Add a native article detail experience with hero media, byline/timing/source metadata, related launch context, source handoff, share, and launch follow/open actions.
- Rebuild the info hub into a Command Deck organized into `Featured`, `Browse`, `Docs`, `Guides`, and `Legal/Support`, including a recent-items rail.
- Ship native About, FAQ, Roadmap, and Jellyfish page treatments driven by shared content payloads plus additive presentation metadata.

## API And Contract Work

- Add `NewsArticleDetailV1` and `GET /api/v1/news/[id]`.
- Add a canonical native `detailHref` to `GET /api/v1/news` items.
- Extend launch-related news payloads and core-entity news previews so mobile opens native article detail instead of publisher URLs.
- Extend `InfoHubV1` additively with ordered deck sections and presentation hints.
- Extend `ContentPageV1` additively with optional presentation metadata for story, FAQ, timeline, guide, and legal layouts.
- Keep all `/api/v1` changes additive and compatibility-safe.

## Mobile Implementation Order

1. Contracts, shared route normalization, and web `/api/v1` endpoints.
2. Native `/news/[id]` detail route plus search/related-news/native-link rewiring.
3. Native news stream overhaul with provider picker, persisted filters, pagination, and recent history.
4. Command Deck rebuild plus native About/FAQ/Roadmap/Jellyfish presentations.
5. Link-truth cleanup across Docking Bay, support, search, launch detail, and other first-party mobile entry points.

## Verification

- Route truth on iOS and Android for `/info`, `/about`, `/docs/about`, `/docs/faq`, `/docs/roadmap`, `/news`, `/news/[id]`, `/jellyfish-effect`, `/support`, and `/legal/*`.
- News flow coverage for type filter, provider picker, pagination, pull-to-refresh, article detail, share, in-app browser handoff, explicit external-source open, related launch open, and follow path.
- Search and in-app linking coverage so mobile search results and launch-detail related news open native article detail.
- Graceful degraded states for missing media, missing authors, missing launch links, empty stream, API errors, no-more-results, and offline retry.
- Pinned-toolchain checks for shared/mobile work: `npm run doctor`, `npm run check:three-platform:boundaries`, `npm run test:v1-contracts`, `npm run test:mobile-query-guard`, `npm run type-check:ci`, `npm run type-check:mobile`, `npm run lint`, and `npm run lint --workspace @tminuszero/mobile`.
