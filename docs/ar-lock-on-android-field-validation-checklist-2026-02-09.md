# AR Lock-On Android Field Validation Checklist

Date: 2026-02-09  
Scope: Close remaining `P2-01` manual validation gap for lock-on (`docs/ar-trajectory-gap-closure-tracker-2026-02-09.md`).

## 1) Test Matrix (Required)

Minimum devices:
- Pixel-class Android phone (Chrome stable).
- Samsung S-class Android phone (Chrome stable).
- Mid-tier Android phone (Chrome stable).

Optional but recommended:
- Samsung Internet on Samsung device.
- Chrome beta on one device.

Session preconditions:
- Feature flag enabled: `NEXT_PUBLIC_AR_LOCK_ON_V1=1`.
- Launch with visible ascent opportunity (or rehearsal replay target).
- Good GPS lock and clear sky line of sight.
- Production UX expectation: lock-on auto-attempts (no manual target lock-on in standard settings UI).

## 2) Manual Scenarios

Run each scenario once per required device/browser pair and record one telemetry `sessionId`.

1. Baseline acquisition
- Start AR, keep rocket region centered.
- Verify lock transitions `searching -> tracking`.
- Confirm ghost predictions (+1s/+2s/+5s) appear.

2. Loss and reacquire
- Pan intentionally off target to force loss.
- Pan back and confirm reacquire.
- Confirm no stuck `lost` state after target is back in frame.

3. Lock-on-off regression (debug-only check)
- Run a debug session with `NEXT_PUBLIC_AR_LOCK_ON_MANUAL_DEBUG=1`.
- Toggle tracker `Off` in the debug controls panel.
- Confirm no ghost overlays render while tracker is off.
- Confirm no major FPS degradation relative to pre-lock-on baseline.

4. Permission and fallback resilience
- Deny motion or camera once, recover via retry.
- Confirm no dead-end; fallback mode remains usable.

## 3) Telemetry Pass/Fail Query

Use the same 14-day lock-on cohort:

```sql
with scoped as (
  select
    id,
    client_profile,
    lock_on_mode,
    lock_on_attempted,
    lock_on_acquired,
    time_to_lock_bucket,
    coalesce(lock_loss_count, 0) as lock_loss_count,
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
      when lock_on_acquired then case when lock_loss_count <= 2 then 1 else 0 end
      else null
    end
  )::numeric(6,4) as stable_lock_rate_among_acquired,
  avg(case when dropped_frame_bucket in ('0..1', '1..5') then 1 else 0 end)::numeric(6,4) as low_drop_rate,
  avg(case when dropped_frame_bucket in ('15..30', '30+') then 1 else 0 end)::numeric(6,4) as high_drop_rate,
  avg(case when pose_update_rate_bucket in ('15..30', '30..60', '60+') then 1 else 0 end)::numeric(6,4) as healthy_pose_rate
from scoped;
```

Target thresholds are defined in `docs/ar-lock-on-frame-budget-runbook-2026-02-09.md`.

Automated report path (same thresholds/query logic):

```bash
npm run trajectory:lock-on:field-report -- --days=14 --output=.artifacts/ar-lock-on-field-report.json --markdown=.artifacts/ar-lock-on-field-report.md
```

Notes:
- Requires Supabase admin env vars (same requirement as telemetry admin scripts).
- `--warn-only` keeps the command non-blocking while still emitting pass/fail status.

## 4) Pass/Fail Sheet (Fill Per Rehearsal)

Use one row per device/browser run:

| Date | Device | Browser | Session ID | Acquire? | <=5s lock? | Reacquire? | Ghosts rendered? | FPS regression when disabled? | Result |
|---|---|---|---|---|---|---|---|---|---|
| YYYY-MM-DD | Pixel 8 Pro | Chrome  | uuid | yes/no | yes/no | yes/no | yes/no | yes/no | pass/fail |

Release recommendation:
- Mark `P2-01` manual validation complete only when all required device/browser rows pass and telemetry cohort remains within threshold.
