# Free Follow + All-U.S. Alerts Realignment

Date: 2026-03-29

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: yes
- Customer-facing: yes

## Product Rules

- Signed-in non-premium web users can enable one exact-launch push follow at a time.
- Anonymous/basic mobile users keep one exact-launch push follow at a time.
- Free/basic no longer gets a free `state` follow.
- Free/basic can enable `All U.S. launches` as a separate alert rule.
- `0/1` and `1/1` only reflect the single exact-launch follow slot.
- The single exact-launch slot resets automatically once the followed launch NET has passed.
- Premium watchlist-backed follows, Premium alert rules, and the Premium Following feed remain unchanged.

## Contract / API Changes

- Add additive entitlement capabilities for:
  - exact-launch free follow
  - free `all_us` alerts
  - premium-only `state` alerts
- Add additive entitlement limit for `singleLaunchFollowLimit`.
- Add additive `/api/v1/me/basic-follows` summary route for signed-in web users:
  - `singleLaunchFollowLimit`
  - `activeLaunchFollow`
  - `allUsEnabled`

## Backend Changes

- Web `/api/v1/me/launch-notifications/:id`:
  - allow signed-in non-premium push follows
  - enforce one future launch follow for non-premium users
  - prune expired non-premium follows when NET has passed
- Web `/api/v1/me/alert-rules`:
  - keep `region_us` basic-allowed
  - keep `state` premium-only
- Mobile push v2:
  - allow guest/basic scopes `launch` and `all_us`
  - remove guest/basic `state`
  - enforce guest/basic limits `{ launch: 1, all_us: 1 }`
  - prune expired guest/basic `launch` rules
- Dispatch:
  - include signed-in basic web users with active browser push subscriptions
  - stop counting or delivering expired non-premium single-launch follows

## Client Changes

- Web launch follow menus:
  - free/basic shows only `This launch` as the available free follow scope
  - button and sheet show `0/1` or `1/1`
  - if another launch occupies the slot, the current launch option is disabled with explanatory copy
- Web preferences:
  - free/basic can manage `All U.S. launches`
  - state remains premium-only
  - browser push subscribe/test works for signed-in free/basic users
- Mobile launch follow sheets:
  - free/basic shows only `This launch`
  - state moves behind Premium
  - button and sheet show `0/1` or `1/1`
- Mobile preferences:
  - free/basic can create, edit, and remove `All U.S. launches`
  - state remains premium-only

## Rollout / Rollback

- Keep all changes additive to shared contracts and `/api/v1`.
- Roll out backend support first, then web/mobile UI.
- Roll back by disabling the new free capabilities and hiding the new summary route consumers; no destructive data migration is required.

## Verification

- `node -v && npm -v`
- `npm run doctor`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
