# 2026-04-06 LL2 Stage And Recovery Remediation Plan

Last updated: 2026-04-06

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: customer-facing with ingestion and observability changes

## Goal

Make launch-detail stage and recovery data correct and durable across all three customer surfaces by:

- replacing fragile serial-search launcher joins with direct LL2 launch-detail stage parsing
- fixing the `ll2_landings` to `ll2_launch_landings` ingest path so future recovery rows stop failing to persist
- performing one low-IO full backfill for future launches
- keeping steady-state refresh cadence intentionally modest

## Current Findings

### Upstream LL2 is mixed, not empty

- LL2 detailed launch objects already expose the canonical stage relationship we want:
  - `rocket.launcher_stage[].launcher`
  - `rocket.launcher_stage[].landing`
- LL2 landings also support:
  - `firststage_launch__ids`
  - `spacecraft_launch__ids`
- Some future launches already have concrete upstream values:
  - `BlueBird Block 2 #2` currently has `GS1-SN002` plus landing `1804`
  - `Cygnus CRS-2 NG-24` currently has `B1094` plus landing `1698`
- Some future launches are still genuine upstream placeholders:
  - `Unknown F9`
  - `Unknown FH`
  - `Unknown NG`

### Local stage joins are partly stale and partly placeholder-only

- Current future `ll2_launcher_launches` rows total: `51`
- Breakdown:
  - `41` rows joined to `Unknown F9`
  - `3` rows joined to `Unknown FH`
  - `3` rows joined to `Unknown NG`
  - `4` rows joined to concrete launchers
- Some of those placeholder rows are legitimate upstream placeholders.
- Some are bad local matches. Example:
  - `New Glenn | BlueBird Block 2 #2` is locally joined to `Unknown F9`, while live LL2 now assigns `GS1-SN002`.

### Local recovery persistence is currently broken

- Future `ll2_launch_landings` rows in the DB: `0`
- Recent `trajectory_constraints_ingest` runs fail on foreign-key insertion into `ll2_launch_landings` because referenced landing IDs are missing from `ll2_landings`.
- That means LL2 can already have a future landing, but our local pipeline still ends up with no persisted recovery row.

## Recommendation

### 1. Stop using serial-number launch search as the customer-facing source of truth

Do not keep relying on:

- `launches/?serial_number=<serial>`

for customer-facing stage attribution.

Instead, treat LL2 detailed launch records as canonical for future launch-stage joins:

- fetch the future `launches/?mode=detailed` feed in pages
- read `rocket.launcher_stage[]`
- upsert `ll2_launcher_launches` from `stage.launcher.id`
- upsert `ll2_launchers` directly from the embedded launcher payload when present

This is the cleanest fix because it follows LL2’s explicit per-launch assignment instead of reverse-searching by serial and hoping the mapping is still current.

### 2. Keep the global launcher-flight catalog path out of the hot customer path

The existing `ll2-catalog` launcher-flight mode is acceptable for broad catalog enrichment, but it is not the right steady-state mechanism for future launch-detail correctness because:

- it is serial-search based
- it is global rather than future-launch targeted
- it currently requires draining an offset cursor across all launchers
- it is vulnerable to stale placeholder relationships

Recommendation:

- keep the existing global launcher-flight path disabled for this customer-facing fix
- introduce a future-launch-targeted stage refresh path instead of trying to rehabilitate the old serial-search loop

### 3. Use two different cadences for stage and recovery

#### Stage joins

Recommended cadence: every `12 hours`

Why:

- booster/core assignment changes, but not usually minute-to-minute
- the full future launch set is small enough that a paged future `launches/?mode=detailed` sweep twice daily is still low IO
- this keeps future launch detail accurate without turning stage joins into an always-hot ingest path

With the current future inventory, this is roughly:

- `~4` LL2 calls per run at `limit=100` for `~363` future launches
- `~8` LL2 calls per day at the current 12-hour cadence

That is modest relative to the current LL2 limit configuration and far simpler than maintaining a partial cursor over global launchers.

#### Recovery / landing rows

Recommended cadence: keep the near-term landing refresh hourly

Why:

- recovery info is more likely to change closer to launch
- the current job already scopes to the top eligible launch set, so IO stays bounded
- trajectory products already depend on that cadence

Recommendation:

- keep `trajectory-constraints-ingest` hourly
- keep the eligible set bounded
- fix the FK path so the hourly job becomes reliable instead of failing on first missing landing ID

## Target Architecture

### Future stage refresh job

Create a dedicated future-launch stage refresh flow that:

1. reads future launches with `ll2_launch_uuid`
2. fetches LL2 detailed launch records
3. extracts `rocket.launcher_stage[]`
4. upserts `ll2_launchers` from embedded launcher objects
5. fully replaces `ll2_launcher_launches` rows for those launch UUIDs
6. records per-launch stats for:
   - concrete launcher assignment
   - placeholder launcher assignment
   - no stage data
   - changed launcher assignment

Locked behavior:

- placeholder launchers are allowed in storage
- placeholder launchers are suppressed in customer UI
- concrete launcher assignments overwrite stale placeholder joins

### Landing persistence hardening

Fix the landing ingest path so `ll2_landings` is ensured before `ll2_launch_landings` upsert.

Recommended behavior:

1. fetch landings from LL2 using:
   - `firststage_launch__ids`
   - `spacecraft_launch__ids`
2. upsert or ensure all returned landing records into `ll2_landings`
3. only then rebuild `ll2_launch_landings`
4. continue writing `launch_trajectory_constraints`

Locked behavior:

- a new landing ID must not crash the run
- one bad launch must not prevent later future launches from refreshing
- spacecraft recovery and booster recovery must both remain supported

### Derived display behavior

Storage rules should preserve distinction between:

- concrete booster assignment
- placeholder booster assignment
- booster landing
- spacecraft landing

UI rules should continue to:

- suppress `Unknown F9` / `Unknown FH` / `Unknown NG` as customer-visible labels
- show concrete serials when present
- show recovery details only when the underlying landing data is specific enough to be useful

## One-Time Full Backfill

Scope recommendation:

- future launches only

Reason:

- this is the customer-facing problem set
- IO stays low
- it avoids turning this into a historical archive project
- it fixes the launches users are actually opening right now

### Backfill sequence

1. Ship the new future-launch stage refresh path behind a disabled setting.
2. Ship the landing-persistence fix behind the existing hourly landing job.
3. Run a one-time future-launch stage backfill for every future launch with `ll2_launch_uuid`.
4. Run a one-time future-launch landing backfill for the same future launch set.
5. Rebuild derived launch-detail enrichment rows or caches only for launches whose stage/recovery rows materially changed.
6. Confirm the changed launch sample across web, iOS, and Android.

### Backfill acceptance criteria

- `BlueBird Block 2 #2` no longer points to `Unknown F9`
- `Cygnus CRS-2 NG-24` no longer points to `Unknown F9`
- future `ll2_launch_landings` count becomes non-zero where LL2 currently provides landings
- placeholder-only launches remain placeholder-only in storage, but not customer-visible
- no FK failure remains in `trajectory_constraints_ingest`

## Rollout Order

### Phase 0: ship new ingest paths behind flags

- add a dedicated future-launch stage refresh implementation
- harden landing ensure-before-link persistence
- add stats and alerting for placeholder vs concrete coverage

### Phase 1: one-time future backfill

- run stage backfill for all future launches
- run landing backfill for all future launches
- validate sample launches that were previously wrong or empty

### Phase 2: enable steady-state cadence

- enable future-launch stage refresh on a `12 hour` cadence
- keep hourly landing refresh for the bounded eligible set
- keep the old global launcher-flight catalog path disabled unless separately needed for non-customer analytics

### Phase 3: monitoring and cleanup

- add monitoring for:
  - future launches with stale stage-refresh age
  - future launches with concrete upstream launcher assignments but local placeholder joins
  - landing-job FK failures
  - future launches with upstream landings but zero local `ll2_launch_landings`
- leave serial-search joins out of the customer-facing correction path

## Rollback Notes

- The new stage refresh should be additive and flaggable.
- The one-time backfill only rewrites future launch join rows and future launch landing rows.
- If the new stage parser misbehaves, disable the future stage refresh job and leave UI suppression in place.
- If landing ensure logic misbehaves, disable the hourly landing write step without reverting unrelated launch-detail work.

## Verification Set

### Required implementation checks

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run lint`

### Add if shared/mobile code changes

- `npm run test:mobile-query-guard`
- `npm run type-check:mobile`
- `npm run lint --workspace @tminuszero/mobile`

### Required data verification

- query future launches before and after backfill for:
  - `ll2_launcher_launches`
  - `ll2_launch_landings`
  - `ll2_landings`
- compare a sample of known launches against live LL2:
  - `BlueBird Block 2 #2`
  - `Cygnus CRS-2 NG-24`
  - one `Unknown F9` launch that remains placeholder upstream
  - one `Unknown FH` launch that remains placeholder upstream
  - one `Unknown NG` launch that remains placeholder upstream
- verify launch detail on:
  - web canonical page
  - iOS canonical page
  - Android canonical page

## Decision Summary

- Yes: move stage joins to direct launch-detail parsing.
- Yes: keep stage refresh low-frequency at `12 hours`.
- Yes: keep landing refresh hourly for the bounded near-term set.
- Yes: do a one-time full backfill for future launches only.
- No: do not rely on the global serial-search launcher-flight catalog job for customer-facing stage correctness.
