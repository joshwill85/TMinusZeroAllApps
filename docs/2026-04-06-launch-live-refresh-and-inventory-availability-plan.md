# 2026-04-06 Launch Live Refresh And Inventory Availability Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

## Why this plan exists

- The current product contract is split between two different ideas of "live":
  - launch feed/detail cadence code says Premium launch data is `120s` outside the launch hot window and `15s` inside it
  - LL2 incremental ingest and older entitlement/admin/live-route plumbing still behave like flat `15s`
- Mobile pull-to-refresh behavior was intentionally tightened for low I/O on 2026-04-01, but that plan no longer matches the desired customer behavior.
- Launch detail combines LL2-backed launch core data with slower modules such as CelesTrak inventory, trajectory evidence, FAA overlays, and weather.
- Future launches currently do not have enough inventory source truth to justify showing an inventory block before data exists.

## Locked product decisions

- Pull-to-refresh must never trigger LL2 ingestion, CelesTrak ingestion, weather ingestion, or any other provider fetch.
- Customer refresh requests may only read from data we have already ingested into our own backend.
- Premium and anon pull-to-refresh both return a toast outcome instead of silently doing nothing.
- Toast copy should vary by outcome, for example:
  - data updated
  - already up to date
  - next scheduled refresh time
  - inventory not available yet
- The launch-detail inventory block should be hidden entirely when we are confident inventory data is not expected yet.
- Zero-filled placeholder inventory badges must never be shown as facts.

## Source-of-truth contract

### 1. What "Premium live" means

- "Premium live" should mean LL2-backed launch core freshness:
  - launch row changes
  - payload manifest / spacecraft manifest changes
  - feed ordering / match-count changes
- The Premium live cadence contract should be:
  - `120 seconds` outside the site launch hot window
  - `15 seconds` from `T-60 minutes` through `T+30 minutes`
- This contract must be shared by:
  - backend LL2 incremental scheduling behavior
  - `/api/v1` launch feed/detail version metadata
  - mobile and web UI copy
  - admin/monitoring labels

### 2. What "Premium live" does not mean

- CelesTrak inventory is not part of the `120/15` promise.
- Weather, FAA, JEP, and trajectory evidence are not part of the `120/15` promise unless a later plan explicitly promotes them into that contract.
- These slower modules should expose honest freshness/availability state, not inherit LL2 language.

## Audit summary

- Shared Premium cadence constants are currently defined in `packages/domain/src/launchRefresh.ts`.
- LL2 incremental still runs as a flat burst loop via `supabase/functions/ll2-incremental-burst` and the minute cron `ll2_incremental_burst`.
- `ingestion-cycle` is a separate 15-minute batch orchestrator and should stay separate from the Premium live path.
- Premium entitlement refresh metadata still exposes a flat `15s` interval from `packages/domain/src/viewer.ts`.
- Launch detail versioning currently keys off the launch row timestamp, even though the detail payload includes multiple separately-refreshed modules.
- Live DB checks on 2026-04-06 show `363` future launches and `0` future launches with `launch_designator`, so future inventory is not currently expected prelaunch.

## External source constraints

- Launch Library supports incremental update polling by change time and is the correct upstream to align with the Premium hot-window cadence.
- CelesTrak explicitly warns against frequent GP polling and states it only checks for new GP data every 2 hours.
- CelesTrak launch inventory also depends on an International Designator, which our future-launch rows do not currently have.

## Implementation plan

### Phase 1. Refresh policy unification

- Create one shared launch-refresh policy source of truth for:
  - default Premium interval
  - hot-window Premium interval
  - hot-window lead/lag boundaries
  - cadence-reason naming
- Keep the current `packages/domain/src/launchRefresh.ts` logic as the shared pure policy source.
- Remove any remaining flat-`15s` launch-specific assumptions from:
  - entitlement-derived launch refresh messaging
  - older `/api/live/*` launch routes
  - admin summary labels and monitoring wording

### Phase 2. Backend LL2 cadence alignment

- Keep `ll2_incremental_burst` on its current minute scheduler.
- Change the Edge burst function so it becomes adaptive:
  - in hot window: current behavior, `4` calls spaced `15s`
  - outside hot window: at most one LL2 incremental call every `120s`
- Reuse the same hot-window decision logic already used by launch feed/detail cadence hints.
- Do not move this logic into `ingestion-cycle`.
- Update monitoring thresholds and admin labels so they reflect the adaptive contract instead of flat `~15 sec`.

### Phase 3. Customer refresh semantics

- Keep customer request paths DB/cache-only.
- Premium feed/detail pull-to-refresh:
  - may call our own version endpoint
  - may fetch the latest DB-backed payload when newer ingested data exists
  - must not trigger provider work
- Anon feed/detail pull-to-refresh:
  - same backend-only rule
  - should check whether a newer public snapshot already exists
  - should refetch the public payload only when a newer ingested snapshot exists
- Standardize toast outcomes across iOS and Android:
  - updated from ingested data
  - already up to date
  - next scheduled live/public refresh time
  - premium-required messaging where applicable
- Web stays included for contract and launch-detail rendering parity, but browser pull-down UX is not part of this slice.

### Phase 4. Detail version correctness

- Replace the current launch-detail version shortcut with a version contract that reflects the modules we promise to refresh on customer request.
- Minimum safe rule:
  - if the screen promises launch core + payload freshness, the version token must include those sources
- Preferred approach:
  - keep one top-level version token for feed/detail refresh decisions
  - add additive per-module freshness fields for slower modules that are displayed on launch detail
- Do not keep using only `launches.last_updated_source` as the detail refresh gate.

### Phase 5. Inventory availability policy

- Hide the inventory block entirely when all of the following are true:
  - the launch is still in the future
  - no `catalog_available` inventory exists
  - there is no credible signal that inventory should already exist
- Treat these states as "hide block" for future launches:
  - no launch designator
  - `pending`
  - `catalog_empty`
  - no inventory row
- Reveal the block when either of these becomes true:
  - `catalog_available` exists
  - the launch has passed and we need to show post-launch pending/error state honestly
- When visible, inventory UI must remain state-aware:
  - no fake zero chips
  - no `unknown=0` placeholders
  - status copy instead of fabricated counts

### Phase 6. Shared API and UI changes

- Keep contract changes additive in `/api/v1`.
- Extend launch detail payload/version responses with the minimum fields needed for:
  - honest refresh toasts
  - inventory-block visibility gating
  - module freshness display where needed
- Update:
  - mobile feed/detail refresh handlers
  - web launch-detail rendering for hidden inventory state
  - any shared launch-detail UI package logic
- Do not widen scope into unrelated alerting, billing, or AR UI changes.

## Rollout order

1. Land the plan and approve the contract changes.
2. Unify launch-refresh policy and monitoring/admin wording.
3. Update LL2 incremental burst to the adaptive `120/15` backend contract.
4. Fix `/api/v1` launch version contracts so manual refresh reads the right freshness signals.
5. Update mobile feed/detail pull-to-refresh to use the new contract and toast outcomes.
6. Hide the future-launch inventory block until inventory is truly available.
7. Verify web launch-detail parity and admin telemetry wording.
8. Monitor live cadence, refresh outcomes, and support/admin reports before widening any slower modules into the "live" promise.

## Rollback notes

- The adaptive LL2 cadence change can be rolled back independently by restoring flat `15s` behavior in `ll2-incremental-burst`.
- Additive `/api/v1` fields can remain in place even if the new UI behavior is rolled back.
- Inventory-block hiding is presentation-only and can be reverted without data migration.
- Manual refresh semantics can be rolled back surface-by-surface if a client-specific regression appears.

## Risks and mitigations

- Risk: adaptive backend cadence and client cadence drift again.
  - Mitigation: keep one shared policy source and add regression coverage around the hot-window boundaries.
- Risk: refresh toasts claim "up to date" while a slower module changed.
  - Mitigation: scope the refresh promise to launch-core modules and expose slower-module freshness honestly.
- Risk: hiding inventory too aggressively masks a real post-launch state.
  - Mitigation: only hide for future launches; once the launch is post-NET, show explicit pending/error copy when relevant.
- Risk: older live-route consumers still rely on flat `15s`.
  - Mitigation: inventory all `/api/live/*` and `/api/v1` launch consumers before changing copied labels or semantics.

## Open decisions to resolve before implementation

- Whether anon pull-to-refresh should fetch the full public payload immediately on a newer version, or only after the current screen is focused and stable.
- Whether the launch-detail top-level toast should mention slower-module freshness explicitly, or only describe launch-core refresh results.
- Whether post-launch `pending` inventory should appear immediately after NET or after a grace period.

## Verification

- Required under pinned toolchain:
  - `node -v && npm -v`
  - `npm run doctor`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
- Targeted functional checks:
  - Premium feed outside hot window reports and behaves like `120s`
  - Premium feed/detail inside hot window reports and behaves like `15s`
  - customer pull-to-refresh never triggers ingestion jobs
  - Premium and anon receive the correct toast outcome for update vs no-update cases
  - future launch detail hides inventory when no real inventory is available
  - post-launch inventory still appears with honest status when data is pending, available, or errored

## Supersedes

- This plan supersedes the pull-to-refresh behavior assumptions in `docs/2026-04-01-low-io-refresh-cache-realignment-plan.md` where those assumptions conflict with the locked decisions above.
