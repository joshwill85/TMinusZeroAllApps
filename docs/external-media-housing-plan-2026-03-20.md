# External Media Housing Plan

Last updated: 2026-03-20

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Goal

Reduce outbound navigation for NASA and SpaceX media, prefer T-Minus Zero hosted media where rights allow, and keep source attribution explicit without making media itself the click target.

## Decisions For This Slice

- NASA images are in scope for managed local hosting, subject to current attribution and no-endorsement rules.
- SpaceX launch detail should continue to show SpaceX imagery inline in our UI.
- SpaceX website images are in scope for "no image click-out", but not for automatic mirroring until rights are clarified.
- YouTube stays inline on web where we already support embeds.
- Native inline YouTube playback is not part of the first implementation slice.

## Current State

### Web

- Launch detail external resource cards are fully outbound anchors today.
  - `apps/web/app/launches/[id]/page.tsx`
  - `LaunchExternalResourceCard`
- Artemis content feed wraps both title and image in outbound links today.
  - `apps/web/app/artemis/content/page.tsx`
- Artemis dashboard intel cards wrap title and image in outbound links today.
  - `apps/web/components/artemis/dashboard/ViewIntel.tsx`
- Web launch detail can embed YouTube and Vimeo inline and falls back to an external link when the provider is not embeddable or embeds are blocked by privacy settings.
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/web/app/legal/privacy-choices/privacy-choices-client.tsx`

### iOS / Android

- Native launch detail opens watch URLs and source URLs externally.
  - `apps/mobile/app/launches/[id].tsx`
- Native Artemis content is currently a row-based source feed, not an image-card feed.
  - `apps/mobile/src/features/programHubs/artemisExtendedScreens.tsx`
- There is no current native YouTube embed or WebView player path in the launch flow.

### Backend / Contracts

- Artemis content ingest stores remote `url` and `image_url` values in `public.artemis_content_items`.
  - `supabase/functions/artemis-content-ingest/index.ts`
  - `supabase/migrations/0178_artemis_content_authority.sql`
- SpaceX launch enrichment stores external resources in `public.launch_external_resources`, with preview/image URLs inside resource data.
  - `supabase/functions/spacex-infographics-ingest/index.ts`
  - `supabase/migrations/20260307110000_launch_external_resources_and_ll2_launch_landings.sql`
- Shared contracts currently expose remote-facing fields only.
  - `packages/contracts/src/index.ts`
  - `apps/web/lib/server/v1/mobileArtemis.ts`
  - `apps/web/lib/server/v1/mobileApi.ts`

## Source Policy Matrix

### NASA

- Policy: prefer managed local hosting for still images.
- UI rule: images are not outbound anchors.
- Attribution rule: keep a visible `Source` link and NASA credit.
- Delivery rule: prefer hosted image URL, fall back to remote image URL only if managed copy is unavailable.

### SpaceX Website / content.spacex.com

- Policy: do not make images or infographics click through to SpaceX pages by default.
- Display rule: keep SpaceX imagery present on each launch detail when we have it, even when the media card is not clickable.
- Rights rule: do not automatically mirror website imagery until reuse rights are confirmed.
- UI rule: keep a separate `Source` link, but media itself stays in-app.
- Follow-up option: allow mirroring only for explicitly licensed assets, likely via a separate licensed-source pipeline.

### YouTube

- Web: keep inline embeds where `buildVideoEmbed()` already supports them.
- Mobile: keep external handoff for now.
- Follow-up: native inline playback requires a separate product and compliance decision.

## Phase Plan

## Phase 0: Safe UI Decoupling

Goal: stop making NASA and SpaceX media cards outbound click targets before changing storage or contracts.

- Web launch detail:
  - Update `LaunchExternalResourceCard` in `apps/web/app/launches/[id]/page.tsx`.
  - Replace the outer anchor with a non-clickable card container.
  - Render explicit actions such as `Source` and, when applicable, `Open page`.
  - Keep watch/video links separate from image/infographic cards.
- Web Artemis content feed:
  - Update `apps/web/app/artemis/content/page.tsx`.
  - Remove anchor wrapping from image blocks.
  - Keep a distinct source link control under each item.
- Web Artemis dashboard intel:
  - Update `apps/web/components/artemis/dashboard/ViewIntel.tsx`.
  - Remove anchor wrapping from image blocks.
  - Keep a distinct source link control under each item.

Result:

- Users can view the media in our UI without accidental outbound navigation.
- Source attribution remains explicit.
- No shared contract change is required for this phase.

## Phase 1: Managed Media Foundation

Goal: add an additive backend path for "prefer our hosted copy when allowed".

- Add a managed-media policy helper, starting with domain-level treatment:
  - `allow_host`: NASA still-image sources
  - `display_only`: SpaceX website imagery until rights are clarified
  - `external_only`: anything not approved for in-app hosting
- Add managed media storage metadata.
  - Recommended: new `public.managed_media_assets` table plus a Supabase Storage bucket.
  - Minimum fields:
    - `id`
    - `source_domain`
    - `source_url`
    - `content_type`
    - `storage_path`
    - `public_url`
    - `sha256`
    - `width`
    - `height`
    - `fetched_at`
    - `attribution_label`
    - `license_note`
    - `status`
- Keep source tables additive:
  - `public.artemis_content_items`: add `hosted_image_url text null`
  - `public.launch_external_resources`: either add hosted URL fields inside `data` or add explicit additive columns if query needs justify them
- Add a small resolver helper that returns the preferred display URL:
  - `hostedImageUrl || hostedPreviewUrl || imageUrl || previewUrl`

Result:

- The product has a shared, explicit concept of "managed copy" vs "source URL".
- NASA and SpaceX can follow different policy branches without UI conditionals scattered everywhere.

## Phase 2: NASA Hosting Rollout

Goal: make NASA still images prefer our managed copy on web and mobile payloads.

- Artemis ingest:
  - Extend `supabase/functions/artemis-content-ingest/index.ts` to copy eligible NASA images into managed storage.
  - Persist `hosted_image_url` on `public.artemis_content_items`.
- Web server mapping:
  - Extend `apps/web/lib/server/artemisContent.ts` to expose both source and hosted image URLs.
- Shared contracts:
  - Add additive `hostedImageUrl` to Artemis content item schemas in `packages/contracts/src/index.ts`.
  - Pass that through `apps/web/lib/server/v1/mobileArtemis.ts`.
- UI consumers:
  - Web Artemis content surfaces prefer hosted images.
  - Native Artemis surfaces can stay row-based in the first pass, but should consume the additive field so future image UI uses hosted assets by default.

Result:

- NASA images are shown from our managed copy when available.
- Source links remain available without being the media interaction itself.

## Phase 3: SpaceX No-Click-Out Policy

Goal: remove media click-outs for SpaceX while keeping rights-safe behavior.

- Launch detail external resources:
  - Keep `url` as the source page.
  - Add additive display fields to launch external resource payloads when available:
    - `hostedAssetUrl`
    - `hostedPreviewUrl`
- Mapping:
  - Extend `packages/contracts/src/index.ts` launch external resource schema.
  - Extend `apps/web/lib/server/v1/mobileApi.ts` and the web launch detail flatteners to surface preferred display URLs cleanly.
- Ingest:
  - `supabase/functions/spacex-infographics-ingest/index.ts` should tag SpaceX website assets as `display_only` unless a later licensed-source rule allows mirroring.

Result:

- SpaceX image and infographic cards stay in our UI.
- SpaceX imagery remains visible on launch detail even when the card no longer links out.
- We do not silently take on reuse risk by bulk mirroring unapproved website assets.

## Phase 4: Native Video Follow-Up

Goal: decide separately whether native apps should support inline YouTube playback.

- This is intentionally not coupled to the image-hosting work.
- If approved later, evaluate:
  - in-app browser / `SFSafariViewController`-style approach
  - embedded WebView approach
  - policy impacts for App Store / Play and privacy settings parity

## Exact File Touch Points

### Web UI

- `apps/web/app/launches/[id]/page.tsx`
- `apps/web/app/artemis/content/page.tsx`
- `apps/web/components/artemis/dashboard/ViewIntel.tsx`

### Shared Contracts / Web API Mapping

- `packages/contracts/src/index.ts`
- `apps/web/lib/server/v1/mobileArtemis.ts`
- `apps/web/lib/server/v1/mobileApi.ts`

### Backend / Ingest / Storage

- `supabase/functions/artemis-content-ingest/index.ts`
- `supabase/functions/spacex-infographics-ingest/index.ts`
- new migration(s) under `supabase/migrations/`
- new managed-media helper(s) under `apps/web/lib/server/` or `supabase/functions/_shared/`

### Mobile

- `apps/mobile/src/features/programHubs/artemisExtendedScreens.tsx`
- `apps/mobile/app/launches/[id].tsx`

Mobile note:

- The first slice does not require a new native image gallery. Native changes are mainly contract consumption and keeping source links explicit.

## Rollout Order

1. Land Phase 0 web-only UI decoupling.
2. Land schema/storage groundwork and additive contracts.
3. Roll out NASA managed hosting.
4. Roll out SpaceX display-policy changes on top of the additive fields.
5. Decide separately on native inline video.

## Rollback Notes

- Phase 0 is UI-only and can be reverted without data rollback.
- Managed media rollout should be additive:
  - keep remote `imageUrl` and `previewUrl` fields intact
  - never make hosted URLs required until ingestion success is proven
- If storage ingestion regresses, clients fall back to existing remote image URLs.

## Verification Set

Run under the pinned toolchain only:

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

Manual verification:

- Web launch detail:
  - SpaceX infographic/image cards no longer navigate on media click.
  - Source links still work.
  - YouTube embed still plays inline.
- Web Artemis surfaces:
  - NASA images render in place.
  - Source links remain available.
- Native:
  - launch detail and Artemis content still open source links correctly
  - no regressions in launch detail rendering when additive hosted fields are absent

## Open Decisions

- Whether a Supabase-managed public URL is sufficient for "housed by us", or whether media should be delivered through a same-origin app route.
- Whether article titles should remain source links after image click-outs are removed, or whether all external navigation should move behind explicit `Source` actions.
- Whether explicitly licensed SpaceX Flickr assets should be added as a separate approved ingest path.
- Whether native inline YouTube playback belongs in the same quarter or a later media UX slice.

## Clarification Added 2026-03-21

- Product requirement: each SpaceX launch detail should continue to show SpaceX imagery when available; the change is to remove the outbound image click-through, not to remove the imagery itself.
- Rights caution: lack of image-specific guidance on the public site is not treated as an affirmative reuse license. Until explicit reuse terms are available, the plan remains:
  - display in-app
  - do not make the image itself an outbound link
  - do not automatically mirror into managed storage
