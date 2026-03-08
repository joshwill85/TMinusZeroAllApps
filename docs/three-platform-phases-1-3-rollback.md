# Three-Platform Rollback Guide for Phases 1-3

Last updated: 2026-03-07

This guide defines the rollback path for the monorepo move, `/api/v1` rollout, and web decoupling work.

## Restore Anchors

- Git backup branch: `backup/pre-mobilechanges3-7-26`
- Git backup tag: `pre-mobilechanges3-7-26`
- Schema restore anchor: `pre-mobilechanges3-7-26-schema`

If a rollback needs to restore the full pre-overhaul baseline, create a fresh recovery branch from the backup tag instead of reconstructing files by hand:

```bash
git switch -c rollback/pre-mobilechanges3-7-26 pre-mobilechanges3-7-26
```

Use the schema backup associated with `pre-mobilechanges3-7-26-schema` for any environment that also needs database rollback.

## Entry Requirements Before Each Phase

- Keep each phase in an isolated commit range or PR slice.
- Do not mix the repo move, auth model changes, and web data-client migration into the same commit range.
- Keep legacy routes/paths live until the replacement path is verified.
- Record the smoke checks and rollback trigger for the slice before merging it.

## Phase 1 Rollback: Monorepo Extraction

Use this if the `apps/web` move or workspace wiring causes build, routing, auth, or deploy regression.

### Expected blast radius

- Repo layout
- CI / Docker wiring
- import resolution

### Rollback path

1. Revert the dedicated phase-1 commit range rather than manually moving files back:

```bash
git revert --no-edit <phase1-start>^..<phase1-end>
```

2. If the move is too tangled to revert safely, branch from `pre-mobilechanges3-7-26` and replay only the non-structural fixes that should survive.
3. No schema rollback is required for phase 1.

## Phase 2 Rollback: Contracts and Auth Hardening

Use this if `/api/v1`, bearer auth, or the shared viewer-session path causes login failures, broken protected routes, or native auth instability.

### Expected blast radius

- session resolution
- protected API routes
- auth callback / reset flows

### Rollback path

1. Halt any mobile release or dogfood build that depends on `/api/v1`.
2. Keep web on legacy cookie-auth paths and legacy `app/api/me/*` / `app/api/public/*` routes.
3. Revert the phase-2 commit range in one slice if possible:

```bash
git revert --no-edit <phase2-start>^..<phase2-end>
```

4. If code rollback is not enough, redeploy from the latest stable commit before phase 2 and restore only additive schema objects that are still safe to leave in place.
5. Use `pre-mobilechanges3-7-26-schema` only if additive auth/API schema changes themselves are causing operational issues.

## Phase 3 Rollback: Web Decoupling

Use this if the shared API client, query layer, extracted launch-detail loaders, or centralized ticker regress web feed/search/account behavior.

### Expected blast radius

- feed and search fetching
- account and saved-items flows
- launch detail data assembly
- countdown behavior

### Rollback path

1. Revert feature slices independently instead of reverting all of phase 3 at once.
2. Restore legacy raw-fetch paths for feed/search/account surfaces before removing the shared client.
3. Keep `/api/v1` available even if web falls back to legacy routes; phase-3 rollback must not undo stable phase-2 auth/contracts work unless phase 2 is also compromised.
4. Revert the centralized ticker separately from data-client migration if the only regression is countdown behavior.

## Smoke Checks After Any Rollback

- Web home feed loads and paginates.
- Search returns results without warm-on-read failures.
- Sign-in, sign-out, callback, and reset-password flows work on web.
- Account/profile, saved items, and notification preferences load correctly.
- Legacy `app/api/public/*` and `app/api/me/*` routes still respond as expected.
- CI, Docker build, and pinned-toolchain doctor pass on the recovered revision.
