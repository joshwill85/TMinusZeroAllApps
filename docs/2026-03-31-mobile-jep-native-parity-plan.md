# Mobile JEP Native Parity Plan

Date: 2026-03-31

## Platform matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Surface type: customer-facing

## Goal

Bring the new plain-language JEP explanation to iOS and Android in a way that feels native, answers:

1. What is the score?
2. Why is it that score?
3. What would need to change for it to have a chance?

The mobile version should match the web reasoning model without copying the entire web component tree into React Native.

## Current state

- Web now has the rich explanation/ranking UI in `apps/web/components/JepScorePanel.tsx`.
- Mobile launch detail only shows a single JEP percentage card in `apps/mobile/src/components/launch/tabs/LiveTab.tsx`.
- The shared live-tab model only carries `jepScore: number | null` in `packages/launch-detail-ui/src/contentOrganization.ts`.
- Mobile launch detail already computes a server-side JEP row in `apps/web/lib/server/v1/mobileApi.ts`, but only uses it to set `hasJepScore`; the detailed payload is not exposed to native clients.
- A dedicated public JEP route already exists at `apps/web/app/api/public/launches/[id]/jep/route.ts`.
- Mobile currently has no location permission or location query stack for JEP personalization.

## Recommendation

### 1. Use a dedicated JEP query for native

Do not stuff the full JEP explanation into the main launch-detail payload first.

Reasons:

- JEP has different freshness and caching behavior than the rest of launch detail.
- Personalized observer JEP should remain opt-in and separate from the default launch-detail fetch.
- The web app already has a dedicated JEP route, so native can align with that contract instead of inventing a mobile-only path.

Recommendation:

- Add a typed API client method for the existing JEP route.
- Add a native query hook dedicated to JEP.
- Keep launch detail responsible for the page shell and launch context; keep JEP responsible for viewability reasoning.

### 2. Share the reasoning model, not the web JSX

The best long-term path is:

- expose a typed raw JEP payload through `packages/contracts`
- derive the plain-language factor/ranking model in a shared package
- render that shared model with web-specific and mobile-specific components

Do not duplicate the ranking copy in both `apps/web` and `apps/mobile`.

Recommendation:

- Create a shared builder such as `packages/domain/src/jep/presentation.ts` or `packages/launch-detail-ui/src/jepPresentation.ts`.
- Input: raw JEP score payload.
- Output: presentation model with:
  - overall summary
  - factor assessments
  - ranked change opportunities
  - guidance rows

This keeps the logic for:

- twilight band explanations
- horizon threshold explanations
- weather blocker wording
- ranked “first thing that needs to change”

in one place.

### 3. Ship a mobile-native layout, not a web transplant

Best mobile layout:

- A compact `Chance to see it` hero card at the top of the Live tab.
- A `Why this score` stack with four compact factor cards.
- A `What would need to change` ranked list with 3 numbered rows.
- A collapsed `Technical breakdown` section for the deeper metrics.

Recommended factor cards:

- Twilight timing
- Sky clarity
- Visible path
- Sunlit plume overlap

Each factor card should include:

- current factor value
- short status pill
- one plain-language explanation
- one needed range or condition when applicable

Recommended ranked levers:

- Launch timing / NET window
- Weather / clouds
- Viewing geometry / local horizon

Important:

- Treat launch timing as a combined human lever across twilight timing and sunlit plume overlap.
- Do not rank raw factors independently in the change list.
- If the launch is still in daylight, timing should appear first.

### 4. Keep JEP in the Live tab

Recommendation:

- Keep the main JEP explainer in the Live tab instead of moving it fully into Overview.

Why:

- It is dynamic and near-launch-sensitive.
- The Live tab already becomes the default tab close to launch.
- It belongs near other time-sensitive launch-state information.

Optional later enhancement:

- Mirror a small summary badge or “Chance to see it” chip in Overview, but keep the detailed explanation in Live.

### 5. Roll out personalization in two phases

#### Phase A: pad-fallback parity

Ship first without native location permission.

- Query the existing JEP route with no observer.
- Show `Using launch pad (fallback)` state.
- Render the full explanation/ranking from pad-fallback data.

This gets iOS and Android to functional parity quickly without permission churn.

#### Phase B: explicit location opt-in

Add native location only after the pad-fallback version is stable.

- Add `expo-location`.
- Add a `Use my location` CTA inside the JEP card.
- Request permission only when the user taps that CTA.
- Requery the JEP endpoint with the observer buckets needed by the existing server route.
- Never auto-prompt for location on launch-detail open.

This is the native-correct behavior for iOS and Android.

## Proposed implementation slices

### Slice 1: shared JEP contract

Files:

- `packages/contracts/src/index.ts`
- `packages/api-client/src/index.ts`
- `packages/query/src/index.ts`
- `apps/mobile/src/api/queries.ts`

Work:

- Add a contract schema/type for the JEP payload returned by the existing route.
- Add `ApiClient.getLaunchJep(id, options?)`.
- Add query keys and query options for launch JEP.
- Add `useLaunchJepQuery`.

### Slice 2: shared presentation builder

Files:

- `packages/domain/src/jep/*` or `packages/launch-detail-ui/src/jepPresentation.ts`
- `apps/web/components/JepScorePanel.tsx` (follow-up consumer)

Work:

- Move the plain-language factor and ranked-change derivation out of the web component.
- Return a stable presentation model that both surfaces can render.

### Slice 3: native UI

Files:

- `apps/mobile/src/components/launch/JepPanel.tsx`
- `apps/mobile/src/components/launch/tabs/LiveTab.tsx`

Work:

- Add a native JEP panel built from the shared presentation model.
- Keep the current single percentage card as a fallback until the new panel is fully wired.
- Use existing native card/pill patterns rather than porting the desktop panel layout.

### Slice 4: explicit location opt-in

Files:

- `apps/mobile/package.json`
- new mobile location helper/provider files
- `apps/mobile/src/components/launch/JepPanel.tsx`

Work:

- Add `expo-location`.
- Add a permission-safe CTA flow.
- Requery JEP with observer buckets after opt-in.

## UX details that matter

- Default collapsed state: keep the main summary visible immediately; do not bury the ranking behind the first tap.
- Technical metrics: collapse by default.
- Copy tone: short, directive, plain English.
- Status badges: use existing native badge tones (`success`, `warning`, `danger/info-style`).
- Refresh: pull-to-refresh should refetch the JEP query.
- Failure mode: if JEP fetch fails, fall back to the current simple percentage card or hide the section cleanly.

## Rollout order

1. Add typed JEP contract and client/query plumbing.
2. Extract shared JEP presentation builder from web-only component logic.
3. Render pad-fallback native JEP panel in the Live tab.
4. Validate parity between web and mobile on the same launch.
5. Add opt-in location personalization.

## Rollback notes

- Keep the existing mobile percentage card available as a fallback during rollout.
- Do not remove the current `hasJepScore` launch-detail behavior until the dedicated JEP query is stable.
- If the shared presentation builder causes regressions, native can temporarily consume raw JEP fields while web remains unchanged.

## Verification set

Run under the pinned toolchain:

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

If the environment supports it:

- iOS and Android launch-detail smoke pass
- Detox coverage for the Live tab JEP panel states:
  - JEP present
  - pad fallback label shown
  - ranked changes render
  - technical breakdown toggle works
  - fetch failure fallback

## Recommendation summary

The best path is not “copy the web panel to React Native.”

The best path is:

- dedicated JEP query
- shared explanation/ranking builder
- native-scannable Live-tab panel
- location as an explicit second-phase enhancement

That gives you consistent reasoning across web, iOS, and Android without making mobile feel like a squeezed desktop page.
