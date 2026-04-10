Agent Instructions

1. Do not commit anything automatically.
2. Do not push anything to production automatically.
3. If asked to plan, do not implement anything; only respond with the plan.
4. Run Node tooling (npm/next/tsc/eslint) under the pinned toolchain: Node 24.14.1 + npm 11.11.0 (see `.nvmrc`, `.node-version`, and `package.json` `volta/engines`). Validate with `npm run doctor`.
