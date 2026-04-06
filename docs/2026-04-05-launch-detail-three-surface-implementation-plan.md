# 2026-04-05 Launch Detail Three-Surface Implementation Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes

## Product decision

- Canonical launch-detail surfaces for this effort are:
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/mobile/app/launches/[id].tsx`
- The tab-based launch-detail prototypes stay in scope only to remove parity regressions and placeholder behavior.
- The objective is not to force identical UI across web and native. The objective is aligned product behavior, section coverage, ordering, and data quality.

## Requested improvements

1. Make the Milestone Map visually appealing and aligned with the reference repo.
2. Display and organize JEP more like the reference repo.
3. Restore FAA airspace launch advisories where they are currently missing or over-filtered.
4. Keep Vehicle Details focused on stages and recovery.
5. Bring in the Chrono-Helix vehicle timeline.
6. Embed the matched X post instead of only linking to it where the platform allows.
7. Make Mission stats visually stronger and closer to the reference implementation.
8. Move Forecast Outlook up.
9. Put JEP below Forecast Outlook.
10. Remove the "What would need to change" section from JEP.

## Audit summary

- The full web launch detail already contains Milestone Map, FAA, Stages & recovery, Chrono-Helix, X embed, and rich Mission stats.
- The full mobile launch detail already contains Forecast Outlook above JEP, FAA cards, Stages & recovery, and Mission stats, but lacks native vehicle timeline and only links to matched X posts.
- The shared tab architecture still drops or simplifies key content:
  - FAA advisories render as placeholders.
  - social surfaces only link out.
  - mission stats are flattened.
  - vehicle timeline is empty.
  - object inventory parity was only partially restored.
- JEP drifted from the tighter reference presentation on both web and mobile by adding factor-readout and "What would need to change" layers.
- FAA data plumbing already exists end-to-end; likely defects are filtering, payload shaping, and UI omission rather than ingest absence.

## External research constraints

- X embedding:
  - Web can use X for Websites / embedded post patterns.
  - Native does not have an equivalent first-party React Native embed path, so the low-cost safe fallback is a bounded in-app web sheet or external deep link.
- FAA:
  - The FAA TFR site and API remain the authoritative public source for launch-day TFR/NOTAM references.
  - Advisory views must retain source links and clearly remain informational.

## Implementation phases

### Phase 0: lock canonical direction and remove scope drift

- Preserve the main full-page web and mobile launch-detail routes as the source of truth.
- Keep the existing in-progress sticky/floating top-bar work in web and mobile intact unless it directly blocks these launch-detail tasks.
- Update the tab architecture only after shared payloads and canonical pages are corrected.

### Phase 1: shared/backend contract and payload work

- Add canonical X post embed metadata to the shared launch detail contract:
  - stable extracted tweet/status id
  - provider handle where available
  - matched timestamp retained
- Expand shared launch-detail shaping so tabs can consume:
  - mission stats cards and booster cards rather than only summary counts
  - vehicle timeline rows
  - richer FAA advisory content
- Audit FAA filtering in `apps/web/lib/server/faaAirspace.ts`:
  - keep the launch-window matching improvements
  - avoid hiding valid launch-day advisories due to overly strict time-window rejection
  - preserve raw NOTAM text when available
- Keep `/api/v1` changes additive only.

### Phase 2: canonical web page parity

- Keep the current Milestone Map and Chrono-Helix baseline where they already match or exceed the reference.
- Refine section ordering and presentation:
  - Forecast Outlook before JEP where a dedicated forecast section exists
  - JEP below forecast
  - remove "What would need to change"
- Keep X embed on web using the existing privacy-gated embed component.
- Strengthen FAA section by:
  - preserving the interactive map
  - restoring raw text visibility or explicit raw-text access when available
  - widening visible advisory coverage if filtering is suppressing valid records
- Keep Mission stats visually rich and aligned with the existing story-card style.

### Phase 3: canonical mobile page parity

- Preserve Forecast Outlook above JEP.
- Remove the JEP "What would need to change" card.
- Upgrade matched social post handling:
  - if a canonical X status id exists, open an in-app web sheet for embedded display
  - retain external open-on-X fallback
- Add a native vehicle timeline section using the same underlying vehicle launch history as web.
- Upgrade Mission stats presentation to mirror the web story-card hierarchy while staying native.
- Keep Stages & recovery in the dedicated vehicle section and avoid splitting it into weaker summaries.

### Phase 4: tab architecture cleanup

- Replace placeholder content in the shared tab experience:
  - live tab gets real FAA advisory cards and richer matched X handling
  - vehicle tab gets real mission-stats cards and vehicle timeline data
  - mission tab keeps the newer payload/object inventory improvements
  - web tab page stops using placeholder mission/vehicle/related content where proper tab components exist
- Shared extraction logic in `packages/launch-detail-ui` should stop collapsing data that the canonical pages already expose.

## Primary files

- Shared/backend/contracts
  - `packages/contracts/src/index.ts`
  - `packages/launch-detail-ui/src/detailModel.ts`
  - `packages/launch-detail-ui/src/contentOrganization.ts`
  - `packages/launch-detail-ui/src/tabLogic.ts`
  - `apps/web/lib/server/faaAirspace.ts`
  - `apps/web/lib/server/v1/mobileApi.ts`
- Canonical web
  - `apps/web/app/launches/[id]/page.tsx`
  - `apps/web/components/JepScorePanel.tsx`
  - `apps/web/components/XTweetEmbed.tsx`
  - `apps/web/components/LaunchMilestoneMapLive.tsx`
  - `apps/web/components/ChronoHelixTimeline.tsx`
- Canonical mobile
  - `apps/mobile/app/launches/[id].tsx`
  - `apps/mobile/src/components/launch/JepPanel.tsx`
- Shared tab surfaces
  - `apps/web/app/launches/[id]/page.tabs.tsx`
  - `apps/web/components/launch/tabs/*`
  - `apps/mobile/app/launches/[id].tabs.tsx`
  - `apps/mobile/src/components/launch/tabs/*`

## Rollout order

1. Land additive shared contract and mobile payload changes.
2. Harden FAA filtering and source-text shaping.
3. Update canonical web launch detail.
4. Update canonical mobile launch detail.
5. Update shared tab architecture to consume the richer payloads.
6. Run verification after the shell is back on the pinned toolchain.

## Rollback notes

- X embed metadata is additive and can be ignored by older clients.
- FAA filtering changes should be isolated so they can be reverted without undoing UI work.
- JEP UI simplification is presentation-only and can be reverted independently on web or mobile.
- Vehicle timeline work should be additive and should not break launch detail if timeline queries fail.
- Tab architecture upgrades should not be allowed to block canonical page delivery.

## Verification

- Required once the local shell is switched back to Node `20.19.6` and npm `10.8.2`:
  - `node -v && npm -v`
  - `npm run doctor`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
- Additional targeted checks:
  - launch-detail web route renders JEP, FAA, Chrono-Helix, and X embed without hydration issues
  - mobile launch detail renders forecast, JEP, FAA, stages/recovery, mission stats, and vehicle timeline in the intended order
  - tab-based launch detail routes no longer show placeholder FAA/social/vehicle behavior

## Known environment blocker

- Current shell is Node `25.8.0` and npm `11.11.0`.
- Final verification must wait until the shell matches the repo pins.
