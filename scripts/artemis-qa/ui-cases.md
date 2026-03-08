# Artemis UI Duplicate QA Cases

## Scope
- `/artemis?view=intel`
- `/artemis?view=budget`
- `/artemis?view=timeline`
- `/artemis/content`

## Preconditions
- Use the same data window as `scripts/artemis-qa-scan.ts` (default: 30 days).
- Open browser devtools and preserve network logs.
- Record URL query params for each reproduction.

## Case 1: Intel card duplication
1. Open `/artemis?view=intel`.
2. Keep Tier as `All` and Type as `All`.
3. Scan first 2 columns of cards for repeated title + source + published date.
4. Confirm repeated URLs by opening both cards in new tabs.
5. Capture screenshot and card metadata (title, URL, source label, tier, mission label).

Expected:
- No repeated canonical URL cards on the same view state.

## Case 2: Intel filtered duplication
1. In Intel view, toggle `Tier 1 only`.
2. Set type filter to each of `Article`, `Photo`, `Social`, `Data`.
3. For each filter state, verify repeated cards do not appear after filter change.

Expected:
- No duplicate cards after filter transitions.

## Case 3: Budget line duplication
1. Open `/artemis?view=budget`.
2. Set Fiscal Year filter to each available year.
3. Search by repeated line-item fragments (for example, `Exploration Ground Systems`, `SLS`, `Orion`).
4. Validate duplicate line-item rows with identical FY/amount tuples are not rendered multiple times.

Expected:
- No visually duplicated budget rows for the same natural key.

## Case 4: Procurement duplication
1. In Budget view, inspect the procurement table sorted by amount descending.
2. Look for repeated rows with same title/recipient/amount/awarded date.
3. Toggle fiscal year and mission filters; verify duplicates do not reappear in sub-filters.

Expected:
- No duplicate procurement rows for same semantic award identity.

## Case 5: Timeline event duplication
1. Open `/artemis?view=timeline`.
2. Ensure `includeSuperseded` is off (default).
3. Confirm no repeated event titles for same mission and same date bucket in visible list.
4. Toggle source type filters and mission mode transitions; verify duplicates are not introduced.

Expected:
- No semantic event duplicates in non-superseded timeline projection.

## Case 6: Content feed pagination duplication
1. Open `/artemis/content` with default filters.
2. Record first page items (title + URL).
3. Click `Older`, then `Newer`; ensure first page items are stable and not repeated unexpectedly.
4. Repeat with `kind=article`, `kind=photo`, and `tier=tier1`.

Expected:
- No repeated items across adjacent cursor pages for the same filter set.

## Evidence format
- Screenshot file name: `artemis-dup-{surface}-{timestamp}.png`
- Attach:
  - URL
  - Filter state
  - Repeated item keys (URL/title/date)
  - Related finding id from QA report
