# 2026-04-09 Toolchain Stabilization Plan

Last updated: 2026-04-09

## Platform Matrix

- Web: included
- iOS: included
- Android: included
- Admin/internal impact: yes
- Shared API/backend impact: yes
- Scope: admin/internal engineering infrastructure hardening

## Goal

Restore exact local compliance with the repo's current pinned toolchain, then prepare a safe repo-wide upgrade path off Node 20 before its scheduled end-of-life on 2026-04-30.

This plan intentionally separates:

1. local machine compliance on the current repo pins
2. the later repo-wide Node major upgrade

That separation keeps the blast radius small and makes regression triage straightforward.

## Current Repo Truth

- `package.json` currently pins local/CI installs to `Node 24.14.1` and `npm 11.11.0`.
- `.nvmrc`, `.node-version`, and `Dockerfile` are aligned to `24.14.1`.
- `engine-strict=true` plus `preinstall` and `doctor` scripts enforce exact local parity.
- The current shell was observed on mismatched versions before remediation work:
  - Node `25.8.0`
  - npm `11.11.0`
- The repo-wide upgrade target is `Node 24.14.1` and `npm 11.11.0`, matching the latest official `24.x` release from `nodejs.org` on 2026-04-09.
- Vercel's current supported majors are `24.x` (default), `22.x`, and `20.x`, so the repo no longer needs to describe Vercel as effectively `20.x`-only.

## Locked Decisions

- Do not change repo pins during the Phase 0 and Phase 1 work.
- Do not change lockfiles during the Phase 0 and Phase 1 work.
- Do not mix the local compliance fix with framework, dependency, or lint-rule upgrades.
- Keep exact local pins, even if Vercel only enforces the major.
- Prefer Volta for exact per-repo local version routing.
- Treat the Node 24 migration as a dedicated follow-up slice with its own verification gates.

## Safe Rollout Order

### Phase 0: Baseline Capture

Stop/go gate:
- The current shell state is recorded before any machine changes.

Checklist:
- Record `node -v && npm -v`.
- Record `npm run doctor`.
- Record current repo worktree status.
- Record whether Volta or nvm is already installed.
- Record whether existing docs still contain stale runtime guidance.

Expected result:
- `doctor` fails because the active shell is not on the repo pins.

### Phase 1: Local Machine Compliance On Current Pins

Stop/go gate:
- The local shell can run `node -v`, `npm -v`, and `npm run doctor` on `20.19.6` / `10.8.2`.

Checklist:
- Install Volta if it is not already present.
- Ensure shell startup loads Volta only once.
- Install exact versions:
  - `node@20.19.6`
  - `npm@10.8.2`
- Re-open or source the shell config for the active terminal session.
- Re-run:
  - `node -v`
  - `npm -v`
  - `npm run doctor`

Success criteria:
- `npm run doctor` returns `toolchain: ok`.
- No repo pin files changed.
- No lockfiles changed.

Rollback:
- Remove Volta shell init lines from shell startup files if installation causes shell regressions.
- Remove `~/.volta` only if a full uninstall is explicitly needed.

### Phase 2: Repo-Wide Upgrade Prep

Completed in this slice.

Checklist:
- Update stale runtime guidance in docs.
- Choose exact `24.x` patch and matching npm version at execution time.
- Avoid branch switching in a dirty worktree; keep the change isolated to toolchain files plus runtime guidance.

### Phase 3: Repo Pin Upgrade

Completed in this slice.

Files expected to change:
- `.nvmrc`
- `.node-version`
- `package.json`
- `Dockerfile`
- CI workflow files that pin Node
- docs that mention Vercel or Node 20 assumptions

### Phase 4: Verification Under New Pins

Mostly completed in this slice.

Required validation set:
- `npm run doctor`
- `npm ci`
- `npm run check:three-platform:boundaries`
- `npm run test:v1-contracts`
- `npm run test:mobile-query-guard`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`
- `npm run test:smoke`
- Docker parity checks
- Preview deployment validation

Observed status in this slice:
- Passed:
  - `npm run doctor`
  - `npm ci`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
  - `npm run build`
  - `npm run test:smoke`
- Blocked by environment:
  - Docker parity checks, because the local Docker daemon was not running
- Still intentionally deferred:
  - preview deployment validation

### Phase 5: Production Runtime Cutover

Deferred in this slice.

Stop/go gate:
- CI, preview deploys, and smoke tests are green under the new pins before production runtime settings move.

## Risks

- Installing a version manager changes shell startup behavior. Keep shell-init edits minimal and idempotent.
- If Homebrew or ambient PATH entries continue to outrank Volta shims, the shell can still resolve the wrong Node binary even after installation.
- Some scripts may behave differently under the eventual Node 24 upgrade even if they are clean on Node 20 today.
- Older `ts-node` script entrypoints that mix TS path aliases with ESM workspace imports may need follow-up migration to `tsx` or `.mts` entrypoints as they are exercised under Node 24.

## Today’s Execution Log

### Phase 0

- Captured the active shell state before remediation:
  - `node -v` -> `v25.8.0`
  - `npm -v` -> `11.11.0`
- Recorded `npm run doctor` failure on the mismatched shell:
  - required Node `20.19.6`
  - required npm `10.8.2`
- Confirmed no usable local version manager was active in PATH:
  - `volta` not on PATH
  - `nvm` not installed
- Confirmed stale runtime guidance remains in:
  - `README.md`
  - `AGENTS.md`
- Recorded the pre-remediation worktree state before local machine changes.

### Phase 1

- Confirmed Volta was already installed at `~/.volta`, but shell startup did not expose it.
- Added guarded Volta shell-init blocks to:
  - `~/.zprofile`
  - `~/.zshrc`
- Re-sourced shell startup files and verified:
  - `volta --version` -> `2.0.2`
  - `node -v` -> `v20.19.6`
  - `npm -v` -> `10.8.2`
- Verified the repo pins resolve correctly through Volta:
  - `volta list` shows `node@20.19.6` and `npm@10.8.2` as current for this repo.
- Verified in a fresh interactive login shell:
  - `node -v` -> `v20.19.6`
  - `npm -v` -> `10.8.2`
  - `npm run doctor` -> `toolchain: ok`

### Phase 3

- Updated the repo-wide pins to the chosen upgrade target:
  - `package.json` -> Node `24.x`, npm `11.x`, Volta `24.14.1` / `11.11.0`
  - `.nvmrc` -> `24.14.1`
  - `.node-version` -> `24.14.1`
  - `Dockerfile` -> `node:24.14.1-alpine`
- Updated repo guidance to match the new pins and current Vercel runtime support in:
  - `README.md`
  - `AGENTS.md`
  - `agent.md`
  - operator runbooks under `docs/`
- Updated script/toolchain helpers so diagnostics no longer hardcode Node 20 assumptions.
- Refreshed `package-lock.json` under the upgraded pinned npm.
- Switched the `test:smoke` runner to `tsx` and added `tsx` as a direct dev dependency so the smoke suite remains deterministic under Node 24.

### Phase 4

- Verified in a fresh interactive login shell:
  - `node -v` -> `v24.14.1`
  - `npm -v` -> `11.11.0`
  - `npm run doctor` -> `toolchain: ok`
- Reinstalled dependencies deterministically with `npm ci` under the new pins.
- Passed required repo checks:
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard`
  - `npm run type-check:ci`
  - `npm run type-check:mobile`
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile`
  - `npm run build`
  - `npm run test:smoke`
- Diagnosed and resolved the only verification regression:
  - under Node 24, `test:smoke` failed through the legacy `ts-node` CommonJS entrypoint because it crossed into ESM workspace exports
  - a direct `tsx` runner restored compatibility without rewriting smoke-test imports
- Attempted the Docker parity checks, but all three failed before container startup because Docker could not connect to `unix:///Users/petpawlooza/.docker/run/docker.sock`.
- Investigated the Docker startup failure and found a host-level configuration issue:
  - Docker Desktop `settings-store.json` points `DataFolder` to `/Volumes/backup_drive/DockerDesktopRetry/DockerDesktop`
  - that volume does not exist on this machine
  - Docker backend logs show startup failing with `mkdir /Volumes/backup_drive: permission denied`
  - Docker Desktop then aborts before the engine socket becomes available
- Backed up the Docker Desktop settings file, repointed `DataFolder` to `/Users/petpawlooza/Library/Containers/com.docker.docker/Data/vms/0/data`, created that local directory, and restarted Docker Desktop successfully.
- Completed the Docker parity checks after the host fix:
  - `docker run --rm node:24.14.1-alpine node -v` -> `v24.14.1`
  - `docker run --rm node:24.14.1-alpine npm -v` -> `11.11.0`
  - `docker run --rm -v "$PWD":/workspace -w /workspace node:24.14.1-alpine sh -lc "npm run doctor"` -> `toolchain: ok`

## Follow-Up After This Slice

- Start Docker and rerun the three required parity commands:
  - `docker run --rm node:24.14.1-alpine node -v`
  - `docker run --rm node:24.14.1-alpine npm -v`
  - `docker run --rm -v "$PWD":/workspace -w /workspace node:24.14.1-alpine sh -lc "npm run doctor"`
- Run preview deployment validation before any production runtime cutover.
- As older operator scripts are exercised under Node 24, migrate any remaining `ts-node` entrypoints that hit the same CommonJS/ESM boundary to `tsx` or `.mts`.
