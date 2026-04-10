# 2026-04-10 JEP Location-First Rollout Plan

Last updated: 2026-04-10

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: customer-facing JEP UX and shared JEP serving contract

## Goal

Make JEP behave like an honest two-mode product:

- `From your location`
- `Near the launch site`

The system should always ask for the user's current location before presenting personalized JEP, fall back safely to launch-area reference mode if location is unavailable, and let the user explicitly switch back to `Near launch site`.

At the same time, the UI should stop relying on a single opaque `0-100` number and instead explain:

- whether a visible plume is `Not expected`, `Possible`, `Favorable`, or `Highly favorable`
- when the window is strongest
- whether the user is looking at a personal answer or a launch-area reference answer

## Current Repo Truth

### Web

- [JepScoreClient.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/components/JepScoreClient.tsx) already tries to refine from browser geolocation.
- It currently does that automatically after mount, not through an explicit in-product mode chooser.
- [JepScorePanel.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/components/JepScorePanel.tsx) already knows how to label launch-area fallback honestly.

### Mobile

- [JepPanel.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/src/components/launch/JepPanel.tsx) always calls `useLaunchJepQuery(launchId, {})`.
- That means mobile is currently launch-area fallback only.
- The app does not currently have a location-permission abstraction or `expo-location` installed.

### Shared API and contract

- [packages/api-client/src/index.ts](/Users/petpawlooza/TMinusZero%20AllApps/packages/api-client/src/index.ts) already supports additive `observer_lat` and `observer_lon`.
- [packages/contracts/src/index.ts](/Users/petpawlooza/TMinusZero%20AllApps/packages/contracts/src/index.ts) already includes `bestWindow` and `scenarioWindows`.
- [apps/web/lib/server/jep.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/jep.ts) now serves public `jep_v6` when `jep_v6_public_enabled = true`.

## Product Rules

### 1. Personal first, reference second

- The product should start by asking which viewpoint to use.
- `Use my location` is the primary action.
- `Near launch site` is the secondary action.
- If location is denied, unsupported, times out, or fails, the product may fall back to launch-area reference mode, but it must say so clearly.

### 2. No silent ambiguity

- Never present launch-area fallback in a way that reads like a personal visibility answer.
- Never say or imply `you can see this` when the current viewpoint is the pad/ascent corridor reference.

### 3. Time-window story beats one raw number

- The score stays, but it becomes secondary to:
  - visibility call
  - current viewpoint
  - strongest window
  - short time-window ladder around NET

### 4. Safe permission behavior

- We should force an in-product prompt.
- We should not fire OS geolocation permission blindly on initial page paint.
- Browser and native permission prompts should be triggered by a user action inside that prompt.

## Target UX

### First entry into JEP

Show a dedicated viewpoint prompt before the final JEP treatment is trusted:

- Title: `Choose your viewpoint`
- Primary: `Use my location`
- Secondary: `Near launch site`
- Supporting copy:
  - `Use my location` explains this is the only way to answer for the user's actual vantage point.
  - `Near launch site` explains this is a reference forecast for viewers near the pad and ascent corridor.

### While location is being resolved

- show loading state: `Checking your viewpoint`
- if request is in flight, keep pad/reference content hidden or visually subordinate
- avoid flashing a confident pad answer first and then replacing it

### If location fails

- fall back to launch-area reference mode
- keep a visible badge:
  - `Launch-area fallback`
- show a retry affordance:
  - `Use my location`

### Ongoing controls

Add a persistent viewpoint toggle in the JEP module:

- `From your location`
- `Near launch site`

Behavior:

- switching to `From your location` re-runs permission/request flow if needed
- switching to `Near launch site` bypasses geolocation and uses pad reference immediately
- current selection should persist per device/session so users are not reprompted on every render after making a choice

## Target Content Model

### Primary content

- `Viewpoint`
- `Visibility call`
- `Watchability score`
- `Best window`

### Secondary content

- short scenario ladder centered on existing `scenarioWindows`
- short reasons list:
  - `Strongly helped by plume illumination`
  - `Held back by twilight timing`
  - `Limited by cloud cover`

### Recommended public labels

- `Not expected`
- `Possible`
- `Favorable`
- `Highly favorable`

### Required wording split

- For personal mode:
  - `From your location`
- For reference mode:
  - `Near launch site`
  - `Reference only`

## Shared Contract Plan

Keep the first implementation additive and backward-compatible.

### Reuse immediately

- existing request coordinates:
  - `observer_lat`
  - `observer_lon`
- existing response fields:
  - `observer`
  - `bestWindow`
  - `scenarioWindows`

### Add next

Additive response fields should include:

- `visibilityCall`
  - `not_expected | possible | favorable | highly_favorable`
- `viewpoint`
  - `personal | launch_site_reference`
- `confidenceLabel`
  - `low | medium | high`
- `viewpointPromptRecommended`
  - boolean, for clients that have not yet collected user choice

These should be additive only. Do not break existing `LaunchJepScoreV1`.

## Implementation Phases

### Phase 0. Freeze semantics

Objective:

- settle labels, thresholds, and forced-prompt behavior before UI work

Deliverables:

- shared copy table for:
  - permission prompt
  - personal mode
  - launch-site reference mode
  - denied/timeout/unavailable states
- threshold table for:
  - `Not expected`
  - `Possible`
  - `Favorable`
  - `Highly favorable`

Exit gate:

- web, mobile, and backend all use the same vocabulary

### Phase 1. Shared contract and domain slice

Objective:

- make the API response explicitly viewpoint-aware and time-window-friendly

Repo areas:

- [packages/contracts/src/index.ts](/Users/petpawlooza/TMinusZero%20AllApps/packages/contracts/src/index.ts)
- [packages/api-client/src/index.ts](/Users/petpawlooza/TMinusZero%20AllApps/packages/api-client/src/index.ts)
- [packages/query/src/index.ts](/Users/petpawlooza/TMinusZero%20AllApps/packages/query/src/index.ts)
- [packages/domain/src/jepPresentation.ts](/Users/petpawlooza/TMinusZero%20AllApps/packages/domain/src/jepPresentation.ts)

Changes:

- add additive viewpoint and visibility-call fields
- derive label bands from the current score + gate state
- expose presentation helpers for:
  - viewpoint mode
  - visibility call
  - scenario ladder copy

Exit gate:

- no breaking API changes
- web and mobile can render from shared helpers instead of hardcoding divergent logic

### Phase 2. Web viewpoint flow

Objective:

- replace silent background geolocation refinement with explicit viewpoint choice

Repo areas:

- [JepScoreClient.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/components/JepScoreClient.tsx)
- [JepScorePanel.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/components/JepScorePanel.tsx)
- launch detail page integration in [page.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/launches/[id]/page.tsx)

Changes:

- introduce a small client state machine:
  - `unanswered`
  - `requesting_location`
  - `personal`
  - `launch_site_reference`
  - `location_failed`
- show viewpoint prompt before personal refinement
- add explicit toggle between personal and launch-site reference modes
- surface `bestWindow` and `scenarioWindows` in a human-time ladder

Safety rules:

- do not auto-trigger browser geolocation on mount
- do not suppress the reference fallback; just label it honestly
- preserve no-store behavior for personalized requests

Exit gate:

- no web page can show a launch-area fallback answer without the `Near launch site` framing

### Phase 3. Mobile viewpoint flow

Objective:

- bring iOS and Android to parity with the same mode model

Repo areas:

- [JepPanel.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/src/components/launch/JepPanel.tsx)
- [queries.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/src/api/queries.ts)
- new mobile location helper module

Changes:

- add `expo-location`
- create a small native location service:
  - request foreground permission
  - fetch current coordinates
  - normalize denied/unavailable/timeout states
- present the same viewpoint chooser and toggle as web
- wire `useLaunchJepQuery` with observer coordinates when personal mode is active

Safety rules:

- location prompt must be user initiated from the JEP UI
- do not request background location
- cache the user's last chosen viewpoint locally so the app does not nag every session

Exit gate:

- mobile is no longer hardcoded to pad fallback

### Phase 4. Time-window presentation

Objective:

- turn JEP from a raw score card into a forecast story

Changes:

- use `bestWindow` as the primary highlight
- render `scenarioWindows` as a compact ladder around NET
- show:
  - `Impossible`
  - `Very unlikely`
  - `Possible`
  - `Favorable`
  - `Highly favorable`

Important rule:

- the time ladder must always be viewpoint-specific
- if the user is in launch-site reference mode, the ladder must say so

Exit gate:

- the user can understand `when` and `why`, not just `85/100`

### Phase 5. Rollout and guardrails

Objective:

- ship safely without reintroducing misleading states

Rollout order:

1. staging web with `jep_v6` already on
2. staging mobile builds
3. additive web launch
4. additive mobile launch

Feature flags:

- `jep_viewpoint_prompt_enabled`
- `jep_time_window_ui_enabled`
- `jep_mobile_personalization_enabled`

Do not tie these to the core scoring flag. Presentation rollout and scorer rollout should be independently reversible.

## Verification Plan

### Shared/backend

- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run lint`

### Mobile-specific

- `npm run type-check:mobile`
- `npm run lint --workspace @tminuszero/mobile`
- Detox coverage for:
  - first open prompt
  - deny location
  - choose launch-site reference
  - switch from reference to personal

### Web-specific

- browser checks for:
  - first open prompt appears
  - choosing `Use my location` triggers browser permission flow
  - deny -> labeled reference fallback
  - choose `Near launch site` -> no geolocation call
  - scenario ladder matches current mode

### Required regression checks

- a personal observer that should hard-zero must still hard-zero under `jep_v6`
- a launch-site reference row must never render with `Using your location`
- mobile and web must use the same label bands for the same payload

## Risks and Mitigations

### Risk: prompt fatigue

Mitigation:

- force the initial in-product prompt
- persist the chosen viewpoint after that

### Risk: browser permission behavior differs from native

Mitigation:

- keep the viewpoint chooser shared
- keep the actual permission request surface-specific

### Risk: launch-site reference remains visually dominant

Mitigation:

- reduce emphasis on fallback mode
- keep explicit `Reference only` treatment

### Risk: new contract fields create churn

Mitigation:

- additive-only schema change
- reuse current fields where possible

## Recommended Next Slice

Implement in this order:

1. Phase 0 semantics freeze
2. Phase 1 shared contract/domain additions
3. Phase 2 web viewpoint prompt and toggle

Do not start mobile implementation before the web flow and shared vocabulary are stable. Mobile needs a new location stack and should reuse the settled web semantics rather than inventing its own.
