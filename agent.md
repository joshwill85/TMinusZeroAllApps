Agent Instructions

1. Do not commit anything automatically.
2. Do not push anything to production automatically.
3. If asked to plan, do not implement anything; only respond with the plan.
4. Run Node tooling (npm/next/tsc/eslint) under the pinned toolchain: Node 20.19.6 + npm 10.8.2 (see `.nvmrc`, `.node-version`, and `package.json` `volta/engines`). On macOS Homebrew: `export PATH="/opt/homebrew/opt/node@20/bin:$PATH"`. Validate with `npm run doctor`.
