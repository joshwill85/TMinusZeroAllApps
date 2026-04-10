# 2026-04-10 Review Findings Remediation Plan

## Scope

- Request type: mixed customer-facing + admin/internal remediation planning
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes

Surface notes:

- Web is included only for the admin JEP shadow-review route and page behavior.
- iOS and Android are included for the mobile launch reminder follow-sheet regression.
- Shared backend is included for LL2 ingest reference writes.
- No public `/api/v1` contract expansion is planned.

## Current-State Verification

As of 2026-04-10, the four review findings still apply.

What I verified:

- The risky lines for all four findings were introduced in commit `c39ec64` on 2026-04-08.
- There are no newer commits after `6557de0` on 2026-04-10, so there is no later committed branch state beyond the current `main` tip.
- The current worktree has local edits in [apps/mobile/app/(tabs)/feed.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/app/(tabs)/feed.tsx) and [apps/mobile/app/launches/[id].tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/app/launches/[id].tsx), but those edits are in realtime refresh and map-budget paths, not the reviewed follow/reminder branches.
- [supabase/functions/_shared/ll2Ingest.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/_shared/ll2Ingest.ts) and [apps/web/app/api/admin/jep/shadow-review/route.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/api/admin/jep/shadow-review/route.ts) currently have no uncommitted edits affecting the reviewed lines.
- [apps/web/app/api/admin/jep/shadow-review/route.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/api/admin/jep/shadow-review/route.ts) and [supabase/functions/_shared/ll2Ingest.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/_shared/ll2Ingest.ts) were touched by later file-level history, but the specific risky lines still blame to `c39ec64`; later commits did not revise those decisions.

Conclusion:

- Nothing after the reviewed changes has fixed, softened, or otherwise invalidated these four findings.
- The plan should treat all four comments as still actionable.

## Decision Principles

1. Restore intended behavior, not just reviewer-satisfying shape.
2. Avoid broad refactors while the repo has unrelated in-flight work.
3. Preserve future enhancement paths instead of reverting useful improvements wholesale.
4. Add targeted regression coverage where the repo currently has no guard.
5. Do not run verification under the wrong toolchain.

Toolchain note:

- The active shell is currently Node `v25.8.0`.
- The repo is pinned to Node `24.14.1` and npm `11.11.0`.
- No npm-based verification should run until the shell is switched to the pinned toolchain.

## Decisions

### 1. Mobile guest reminder access should be device-scoped, not sign-in-gated

Why this is the right decision:

- Mobile anon/public behavior is already modeled as a device-scoped tier with one launch reminder slot.
- [apps/mobile/src/api/queries.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/src/api/queries.ts#L1320) shows `useMobilePushRulesQuery()` only needs installation context.
- [apps/web/lib/server/v1/mobilePushV2.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/lib/server/v1/mobilePushV2.ts) already supports guest owners and guest rule limits.
- Gating this path on `isAuthed` is therefore inconsistent with the existing product model.

Decision:

- Signed-out guests and signed-in public users should share the same single-launch reminder path on mobile.
- Premium-only recurring scopes remain locked for non-premium users.
- The fix should also realign helper copy and capacity labels with actual guest behavior.

### 2. LL2 rocket-config updates should stay incremental but become null-safe

Why this is the right decision:

- Reverting to pure `{ insertOnly }` would avoid null clobbers, but it would also discard the intended benefit of incremental config refreshes.
- The harmful behavior is not “updates happen”; it is “sparse incremental rows overwrite existing non-empty metadata with null.”
- The correct model is monotonic enrichment for nullable descriptive fields such as `family`, `full_name`, and `manufacturer`.

Decision:

- Keep incremental rocket-config refreshes.
- Change rocket-config writes so incoming non-empty values can update stored rows, but missing/null values do not erase existing metadata.
- Do not widen this into a general reference-write refactor; contain the special handling to rocket configs.

### 3. Missing deltas should be unranked, not treated as the largest change

Why this is the right decision:

- A missing delta means “not comparable yet,” not “maximum magnitude.”
- Analyst review default ordering should surface the most meaningful scored changes first.
- The current `abs_delta` behavior produces misleading first pages in normal partial-rollout states.

Decision:

- Sink `scoreDelta == null` rows to the bottom for all delta-based sorts.
- Keep `net` as the secondary tie-breaker.

### 4. Summary must describe the full filtered population, not the first page

Why this is the right decision:

- The current route is already conceptually paginated via `limit`.
- Analysts use the summary to understand population coverage, shadow availability, and delta distribution.
- A page-scoped summary is materially misleading when more than one page of filtered rows exists.

Decision:

- Build `summary` from the full filtered `reviewRows`.
- Keep `launches` as the paginated slice.
- Because this is an internal admin route, also include explicit pagination metadata such as `returnedLaunches` and `limit` so the UI can state when the table is truncated.

## Phased Plan

### Phase 0. Safe setup

1. Switch the shell to Node `24.14.1` and npm `11.11.0`.
2. Run `npm run doctor`.
3. Leave unrelated working-tree files untouched.
4. Keep changes isolated to the four reviewed areas plus any tiny shared helper or regression test needed to make those fixes stable.

### Phase 1. Restore mobile guest launch reminders

Files:

- [apps/mobile/app/(tabs)/feed.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/app/(tabs)/feed.tsx)
- [apps/mobile/app/launches/[id].tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/mobile/app/launches/[id].tsx)

Plan:

1. Replace the `: isAuthed ? ... : locked` split with a public-reminder branch that is keyed to mobile anon capability, not sign-in state.
2. Restore guest access to the launch-level reminder toggle in both the feed follow sheet and the launch detail follow sheet.
3. Update surrounding copy so signed-out guests see accurate messaging about the one device-scoped reminder slot.
4. Keep premium recurring follow scopes locked for non-premium users.
5. Prefer a very small shared helper for “public reminder availability + copy” only if it reduces duplication without turning into a refactor.

Guardrails:

- Do not change premium follow behavior.
- Do not change watchlist behavior.
- Do not widen this into a launch-alert UX redesign.

### Phase 2. Make LL2 rocket-config writes non-destructive

File:

- [supabase/functions/_shared/ll2Ingest.ts](/Users/petpawlooza/TMinusZero%20AllApps/supabase/functions/_shared/ll2Ingest.ts)

Plan:

1. Replace the generic blind rocket-config upsert with a null-safe merge path for `ll2_rocket_configs`.
2. Preserve existing non-empty `family`, `full_name`, and `manufacturer` values when an incremental payload omits them.
3. Allow non-empty incoming values to update stored metadata.
4. Leave agency/location/pad reference semantics unchanged.

Guardrails:

- Do not silently write historical repair data as part of the code fix.
- After the code fix is in place, run a read-only repair audit first.
- Only perform a write backfill if the audit shows damage and there is explicit approval.

Follow-up audit:

- Run `npm run audit:trajectory:rocket-family -- --mode=report` if the environment is configured for database access.
- If blanks caused by the current bug are present, propose `npm run backfill:trajectory:rocket-family -- --mode=backfill --write` as a separate approved action.

### Phase 3. Fix shadow-review sort and summary semantics

Files:

- [apps/web/app/api/admin/jep/shadow-review/route.ts](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/api/admin/jep/shadow-review/route.ts)
- [apps/web/app/admin/ops/jep/page.tsx](/Users/petpawlooza/TMinusZero%20AllApps/apps/web/app/admin/ops/jep/page.tsx)

Plan:

1. Keep the existing filter pipeline.
2. Compute `summary` from the full filtered `reviewRows` before slicing for pagination.
3. Change the comparator so null deltas sink below numeric deltas for `abs_delta`, `delta_desc`, and `delta_asc`.
4. Keep `net` sorting behavior unchanged except as a tie-breaker.
5. Add `returnedLaunches` and `limit` to the route response and show a simple “showing first N launches” cue in the admin UI when truncated.

Guardrails:

- Do not change the admin access model.
- Do not widen the route into a general paging/search redesign.
- Keep the route internal-only and backwards-compatible with the current admin page in the same change.

## Regression Coverage Plan

The current repo does not appear to have focused automated coverage for these exact failure modes, so part of the fix should be adding targeted regression checks.

### Mobile reminder regression coverage

Add a focused guard that proves:

- a guest installation with push registration can still read launch reminder rules
- the guest/public follow sheet path exposes the launch reminder option
- premium-only recurring scopes stay locked for non-premium users

Preferred shape:

- extend an existing guard script if that keeps context small
- otherwise add a small new script-level regression check rather than a large test harness

### LL2 ingest regression coverage

Add a deterministic regression test or script case that proves:

- existing rocket-config family survives an incremental row with `family: null`
- non-empty incoming family still updates a previously blank row

### Shadow-review regression coverage

Add a focused route/helper test that proves:

- `abs_delta` sorts numeric deltas ahead of null deltas
- summary totals stay the same when only `limit` changes
- gate filters still exclude/include rows as before

## Verification Set

After switching to the pinned toolchain:

1. `npm run doctor`
2. `npm run type-check:mobile`
3. `npm run lint --workspace @tminuszero/mobile`
4. `npm run type-check:ci`
5. `npm run lint`
6. `npm run test:v1-contracts`
7. `npm run test:mobile-query-guard`
8. `npm run test:admin-surface-guard`
9. `npm run test:jep-v6-shadow`
10. Run the new focused regression checks added for these findings

Manual verification:

1. iOS guest device:
   open feed follow sheet and launch detail follow sheet, confirm launch reminder toggle exists and works
2. Android guest device:
   repeat the same reminder flow
3. Signed-in public user:
   confirm launch reminder still works and copy stays accurate
4. Premium user:
   confirm recurring follow scopes remain available
5. Admin shadow-review page:
   confirm the first page defaults to real scored deltas first
6. Admin shadow-review page:
   confirm summary values do not change when only `limit` changes

## Rollout Order

Recommended implementation order:

1. Mobile reminder fix
2. LL2 ingest null-safe merge
3. Shadow-review route + admin page fix
4. Focused regression coverage
5. Full verification pass

Why this order:

- The mobile issue is the only P1 customer-facing regression.
- The LL2 bug affects future data integrity and should be stopped before more sparse incremental runs land.
- The admin route issues are important but internal and easiest to validate once the higher-risk mobile/backend work is stable.

## Rollback Notes

- Mobile reminder fix is low-risk and can be reverted cleanly if it introduces unexpected UI issues.
- Shadow-review route changes are admin-only and can be reverted without customer impact.
- LL2 ingest merge logic only affects future writes once deployed; if it misbehaves, revert the function first.
- Any already-blanked rocket-family data should be repaired only through an explicit audit-backed backfill, not by guessing.

## Out of Scope

- No entitlement model redesign
- No broader mobile follow-sheet redesign
- No automatic historical data backfill without approval
- No unrelated cleanup in the already-dirty working tree
