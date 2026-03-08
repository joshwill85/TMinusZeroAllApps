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
