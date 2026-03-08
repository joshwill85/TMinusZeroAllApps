# USASpending Hub Audit Runbook

Use the pinned toolchain first:

```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" node -v
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm -v
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run doctor
```

Generate an audit report for all three hubs:

```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run audit:usaspending:hubs
```

Useful flags:

```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" \
  ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
  scripts/usaspending-hub-audit.ts \
  --mode=report \
  --scope=blue-origin \
  --live-verify=flagged \
  --output=tmp/usaspending-blue-origin-audit
```

Write auto-tier decisions into `program_usaspending_scope_reviews` while preserving any existing manual `final_tier`, `review_status`, and `review_notes`:

```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run backfill:usaspending:hubs
```

Verdicts:

- `exact`: safe for the primary hub contract list.
- `candidate`: weak or text-only support; review, do not surface as a primary contract row.
- `excluded`: not a valid hub mapping.

Artemis policy:

- Primary Artemis procurement lists should only use `exact`.
- `candidate` Artemis rows are review artifacts and can be surfaced through discovery/research workflows instead of the main contracts list.

Regression check:

```bash
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run test:usaspending-hubs
```
