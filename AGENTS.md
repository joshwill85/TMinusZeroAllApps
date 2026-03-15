# Agent Notes

## 1) Scope & Safety (non-negotiable)

- If you say “do not change/implement,” then do analysis only (no edits, no `apply_patch`, no “quick fixes”).
- Never delete, revert, “clean up”, or otherwise modify unrelated working-tree changes or untracked files unless you explicitly request it.
- Before any destructive action (delete/rename/revert/mass refactor), ask for confirmation and explain the exact blast radius.
- When you provide explicit constraints, treat them as higher priority than “best practices.”

## 2) Planning & Execution Style

- For anything non-trivial: start with a phased plan (small, verifiable steps) and confirm before moving into risky steps.
- Prefer incremental changes over “big bang” refactors; prioritize “won’t break future enhancements.”
- If you ask for “industry standard,” default to the most common mainstream pattern unless you tell me to innovate.

## 3) Progress Visibility (avoid the “background mystery”)

- Don’t go quiet while doing long work; post checkpoints: “what I checked”, “what I’m doing next”, “what I need from you”.
- If there’s a risk of hitting context limits (huge prompts/logs/json), force chunking:
  - Ask for a file path, or
  - Ask permission to write/read it from disk, or
  - Request only the minimal relevant excerpt.

## 5) Quality Bar: “Industry Standard” Means

- Optimize for maintainability + predictable behavior over cleverness.
- Use robust patterns: explicit typing, centralized helpers where repeated, and regression-minded changes.
- When you request it, run the most relevant checks (typecheck/lint/tests), but don’t run heavyweight commands if you told me not to change anything.

## Toolchain Standardization (non-negotiable)

- **Pinned versions** (no deviation for verification/CI parity):
  - Node: **20.19.6**
  - npm: **10.8.2**
  - TypeScript: **5.9.3**
  - ESLint: **8.57.1** (and `eslint-config-next` **14.2.35**)
  - Prettier: **3.1.1**
- **Enforcement**:
  - Installs are enforced via `engine-strict=true` and a `preinstall` toolchain check.
  - CI uses `.nvmrc`; Docker uses a pinned Node image tag.
  - Vercel only allows selecting the **Node major** (20.x); the toolchain check is strict locally/CI/Docker but permits Node 20.x on Vercel builds.
- **Rules**:
  - Do not run `npm/next/tsc/eslint` under a different Node/npm when validating changes.
  - Do not change `.nvmrc`, `.node-version`, `Dockerfile` `FROM node:…`, `package.json` `volta/engines`, or lockfiles unless explicitly requested.
  - Prefer `npm ci` for deterministic installs; run `npm run doctor` when diagnosing.
- **Override (local-only)**:
  - `ALLOW_TOOLCHAIN_MISMATCH=1` is allowed only for temporary local experiments; never use it for CI or final verification.
- **Every-time workflow (required)**:
  - **Local shell must match pins before installs/checks**:
    - Run: `node -v && npm -v`
    - Run: `npm run doctor`
    - If mismatch: switch to pinned toolchain first (prefer Volta: `volta install node@20.19.6 npm@10.8.2 && volta pin node@20.19.6 npm@10.8.2`).
  - **Deterministic install + validation**:
    - Use `npm ci` (not `npm install`) for reproducibility.
    - Run only with pinned Node/npm: `npm run type-check`, `npm run lint`, relevant tests (for this repo, at minimum `npm run test:smoke` when touching AR trajectory logic).
  - **Docker parity check**:
    - Quick check: `docker run --rm node:20.19.6-alpine node -v && docker run --rm node:20.19.6-alpine npm -v`
    - Repo parity: `docker run --rm -v "$PWD":/workspace -w /workspace node:20.19.6-alpine sh -lc "npm run doctor"`
  - **When upgrading Node/npm (only if explicitly requested)**:
    - Update all pins together in one change: `.nvmrc`, `.node-version`, `package.json` (`volta` + `engines`), Dockerfile `FROM node:...`.
    - Re-run local and Docker parity checks before considering the upgrade complete.

## Rule: When to use sub-agents (CLI)

Use sub-agents **only when it materially improves quality, safety, or speed** vs. doing the work in a single thread.

### ✅ Spawn sub-agents when any of the following are true
- **Decomposable workstreams:** The task can be split into 2+ largely independent parts (e.g., backend + frontend, schema + migration, docs + tests, refactor + verification).
- **Specialized expertise needed:** The work touches a domain where mistakes are costly or subtle (security/auth, payments, infra, data migrations, concurrency, cryptography, build tooling, compliance).
- **High-risk changes:** Changes affect production-critical paths, permissions, data integrity, or require careful rollback plans.
- **Significant unknowns / research required:** You need to consult docs, inspect repo patterns, or compare multiple approaches before coding.
- **Verification is essential:** You want an independent check (code review agent) or a dedicated test-writing agent to validate behavior and edge cases.
- **Large context / multi-file work:** The change spans multiple modules or systems and benefits from focused, scoped analysis per area.

### ❌ Do NOT use sub-agents for
- Small, straightforward edits (single-file tweaks, simple bug fixes, formatting, renames).
- Tasks where coordination overhead exceeds the work itself.
- Situations where a single coherent implementation is more important than parallelization.

### How to use sub-agents (best practice)
- **Define roles explicitly** (e.g., `Research`, `Implementation`, `Tests`, `Review/Security`).
- Give each sub-agent a **tight brief**: goal, constraints, relevant files/paths, and expected deliverable format.
- Keep context **minimal and scoped** (avoid dumping the whole repo state).
- Require **actionable outputs**: recommended approach, risks, exact file-level changes, test plan, or diff-ready edits.
- The main agent must **merge results**, resolve conflicts, ensure consistency, and run/verify checks before finalizing.
- Default to **2–4 agents max**; add more only if the workstreams are truly independent.

## 6) Three-Platform Product Scope (non-negotiable)

### Repo truth

- This repository contains all three customer surfaces plus the shared backend and shared packages.
- `apps/web` is the web surface. It includes the public site, SEO/share surfaces, admin/internal surfaces, and the Next.js BFF/API layer.
- `apps/mobile` is the single Expo/React Native native client for both iOS and Android.
- `packages/*` is the shared layer for domain logic, contracts, API client, query policy, navigation intents, and design tokens.
- `supabase/*` is the shared backend, schema, jobs, and operations layer.
- Do not describe this repo as having separate iOS and Android source trees unless the task explicitly involves generated native projects.

### Required platform matrix before non-trivial product work

- For non-trivial product or engineering work, explicitly determine and state:
  - `Web: included / not included`
  - `iOS: included / not included`
  - `Android: included / not included`
  - `Admin/internal impact: yes / no`
  - `Shared API/backend impact: yes / no`
- If any surface is excluded, say why.
- Also state whether the request is customer-facing or admin/internal.

### Default scoping rules

- If the user explicitly names a surface, scope analysis, planning, and implementation strictly to that surface unless they explicitly ask for more.
- If the request is admin/internal, default to web-only.
- If the request is customer-facing and clearly inside the current three-platform core, treat it as web + iOS + Android unless the user narrows scope.
- If the request is customer-facing but outside the current three-platform core, do not silently expand it to all three; state the proposed platform matrix first.
- Never silently widen a single-platform request into multiple surfaces.
- Never silently narrow an unspecified request to one surface unless it is clearly web-only by policy or by browser/platform constraints.

### Current three-platform core

- The current cross-platform core is: launch feed, search, launch detail, auth/session and deep-link callback handling, saved items, watchlists, filter presets, preferences, notification settings, profile/account basics, entitlement reads, premium state, and push device registration.
- For these flows, prefer aligned business rules and shared contracts across web, iOS, and Android.

### Web-only by default

- Keep these web-only unless the user explicitly overrides the rule:
  - admin, moderation, ops, support, data-management, sponsorship, billing override, and business tooling
  - SEO/distribution surfaces such as `robots`, `sitemaps`, OG image routes, web share redirect pages, and similar browser discovery surfaces
  - tokenized/export-style web integrations and their management UIs, including RSS feeds, embed widgets, ICS/calendar-feed links, and similar copy/share artifacts
  - Stripe checkout, billing portal, tip-jar flows, and other browser-first web payment flows
  - browser-only capability surfaces such as service-worker flows, web push subscription UX, Add to Home Screen prompts, and the current web AR runtime
  - internal/debug/revalidation/manual job trigger surfaces

### Web-first unless explicitly requested for mobile parity

- Default these to web-first rather than guaranteed three-platform parity:
  - long-form docs, FAQ, roadmap, and editorial/program content
  - provider/program/catalog encyclopedia-style pages and similar browsing-heavy reference surfaces
  - advanced integrations management screens that are mostly token/link management

### No silent scope drift

- If a request would be awkward, non-standard, or clearly different across web, iOS, and Android, explain the split by surface before implementing.
- Prefer platform-appropriate UX, navigation, links, gestures, permissions, billing flows, and notification behavior rather than forcing identical UI.
- If Apple App Store or Google Play norms conflict with a web pattern, do not copy the web pattern blindly; explain the constraint and use the native approach.

## 7) Shared Architecture & API Rules

- Follow the repo’s domain-first sharing strategy, not UI-first sharing.
- For mobile-critical or shared customer flows, prefer `packages/contracts`, `packages/api-client`, `packages/query`, `packages/navigation`, `packages/domain`, and additive `/api/v1` routes over new web-only ad hoc shapes.
- Do not make breaking `/api/v1` contract changes without explicit approval and a compatibility plan.
- Keep product behavior, business rules, naming, permissions, entitlement interpretation, and analytics semantics aligned across surfaces where practical.
- Preserve the three-platform boundary rules: shared packages and `apps/mobile` must not depend on `next/*`, `apps/web/*`, `lib/server/*`, or browser/service-worker-only APIs.
- Mobile-critical APIs must avoid sync-on-read, warm-on-read, or admin retry fallback behavior on the hot path.
- Do not port web Stripe checkout or browser-notification patterns into native apps; use native billing, native links, native permissions, and native notification flows instead.
- Treat AR as platform-specific. The current shipped/runtime AR experience is web-only unless the task explicitly concerns the later native AR architecture.

## 8) Planning & Verification For Multi-Surface Work

- For work that changes shared APIs plus two or more client surfaces, create or update a dated plan doc in `docs/` before major implementation.
- Use `docs/three-platform-overhaul-plan.md` as the main architecture source of truth when the change affects the three-platform migration or shared foundations.
- The plan should capture the platform matrix, contract/API changes, rollout order, rollback notes, unresolved decisions, and the verification set.
- Keep refactors additive and slice by feature or contract where possible; avoid broad cross-surface rewrites without a written plan.
- When touching `packages/*`, `apps/mobile`, or shared `/api/v1` flows, run the relevant checks under the pinned toolchain:
  - `npm run doctor`
  - `npm run check:three-platform:boundaries`
  - `npm run test:v1-contracts`
  - `npm run test:mobile-query-guard` when mobile query/shared client behavior changes
  - `npm run type-check:ci`
  - `npm run type-check:mobile` when mobile code changes
  - `npm run lint`
  - `npm run lint --workspace @tminuszero/mobile` when mobile code changes
  - relevant Detox/mobile E2E when core mobile journeys or routing change and the environment supports it
- If only one surface is touched, do not force unrelated platform work or unrelated verification unless the underlying shared contract changed.

## 9) T-Minus Zero Product Boundary

- Treat launch browsing, countdowns, launch detail, watchlists, alerts, personalization, saved views/presets, subscriptions/entitlements, and user-facing notification settings as likely cross-platform product areas.
- Treat internal launch curation, data-source controls, moderation, sponsorship management, manual sync/backfill control, billing overrides, support tooling, observability, and ops dashboards as web-only admin areas by default.
- If an unspecified request falls inside the current three-platform core, default to a three-surface platform matrix.
- If an unspecified request falls outside the current three-platform core, propose the matrix first instead of silently assuming parity everywhere.
