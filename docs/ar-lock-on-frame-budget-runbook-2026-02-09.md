# AR Lock-On Frame Budget + Toolchain/Docker Runbook

Date: 2026-02-09  
Scope: AR-P2-01 lock-on acceptance baselines, plus safe Node/npm + Docker verification and upgrade flow.

Companion execution checklist:
- `docs/ar-lock-on-android-field-validation-checklist-2026-02-09.md`

## 1) Lock-On Acceptance Thresholds (Beta Gate)

Population:
- `ar_camera_guide_sessions` rows from the last 14 days
- `client_profile in ('android_chrome', 'desktop_debug')`
- `coalesce(lock_on_mode, 'auto') = 'auto'`
- `lock_on_attempted = true`

Target thresholds:
- Lock acquisition rate: `lock_on_acquired` >= 65% of attempted sessions.
- Time-to-lock: at least 60% of attempted sessions are in `time_to_lock_bucket in ('<2s', '2..5s')`.
- Lock stability: at least 80% of acquired sessions have `lock_loss_count <= 2`.
- Frame budget:
  - at least 75% of rows are in `dropped_frame_bucket in ('0..1', '1..5')`
  - at most 10% of rows are in `dropped_frame_bucket in ('15..30', '30+')`
  - at least 80% of rows are in `pose_update_rate_bucket in ('15..30', '30..60', '60+')`.

Non-regression threshold (lock-on disabled debug sessions):
- The share of `dropped_frame_bucket in ('15..30', '30+')` must not increase by more than 3 percentage points vs. pre-lock-on baseline.

## 2) SQL Snapshot Query

```sql
with scoped as (
  select
    client_profile,
    lock_on_mode,
    lock_on_attempted,
    lock_on_acquired,
    time_to_lock_bucket,
    lock_loss_count,
    dropped_frame_bucket,
    pose_update_rate_bucket
  from ar_camera_guide_sessions
  where created_at > now() - interval '14 days'
    and client_profile in ('android_chrome', 'desktop_debug')
    and coalesce(lock_on_mode, 'auto') = 'auto'
    and lock_on_attempted is true
)
select
  count(*) as attempted_sessions,
  avg(case when lock_on_acquired then 1 else 0 end)::numeric(6,4) as lock_acquire_rate,
  avg(case when time_to_lock_bucket in ('<2s', '2..5s') then 1 else 0 end)::numeric(6,4) as lock_le_5s_rate,
  avg(
    case
      when lock_on_acquired then case when coalesce(lock_loss_count, 0) <= 2 then 1 else 0 end
      else null
    end
  )::numeric(6,4) as stable_lock_rate_among_acquired,
  avg(case when dropped_frame_bucket in ('0..1', '1..5') then 1 else 0 end)::numeric(6,4) as low_drop_rate,
  avg(case when dropped_frame_bucket in ('15..30', '30+') then 1 else 0 end)::numeric(6,4) as high_drop_rate,
  avg(case when pose_update_rate_bucket in ('15..30', '30..60', '60+') then 1 else 0 end)::numeric(6,4) as healthy_pose_rate
from scoped;
```

## 3) Safe Toolchain Verification (Pinned)

Pinned versions:
- Node: `20.19.6`
- npm: `10.8.2`
- Docker base image: `node:20.19.6-alpine`

Local verification checklist:
1. `node -v && npm -v`
2. `npm run doctor`
3. `npm ci`
4. `npm run type-check`
5. `npm run test:smoke`

Docker verification checklist:
1. `docker run --rm node:20.19.6-alpine node -v`
2. `docker run --rm node:20.19.6-alpine npm -v`
3. `docker build -t tminuszero:toolchain-check .`
4. `docker run --rm -t -v "$PWD":/workspace -w /workspace node:20.19.6-alpine sh -lc "npm ci && npm run type-check && npm run test:smoke"`

## 4) Safe Node/npm Upgrade Procedure (When Explicitly Requested)

1. Update all pinned files together in one PR: `.nvmrc`, `package.json` (`engines`, `volta`), Dockerfile `FROM node:...`.
2. Do not split runtime and tooling upgrades across separate version lines.
3. Re-run local verification checklist.
4. Re-run Docker verification checklist.
5. Confirm CI parity and Vercel major compatibility (`20.x` policy).
6. Roll back immediately by reverting those exact pinned-file edits if any gate fails.
