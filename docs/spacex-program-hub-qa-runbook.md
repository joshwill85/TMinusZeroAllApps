# SpaceX Program Hub QA Runbook

## Purpose
Validate `/spacex` after hub refactor + jump-rail rollout.

## Required Toolchain
- Node `24.14.1`
- npm `11.11.0`

Run with the pinned shell toolchain:

```bash
node -v && npm -v
npm run doctor
```

## Automated Checks
```bash
npm run type-check
npm run lint
npm run test:smoke
npm run test:spacex-hub
```

## Manual Checklist
1. Open `/spacex` desktop viewport.
2. Verify left jump rail is visible and sticky while scrolling.
3. Verify active jump rail state follows section in view.
4. Verify clicking each rail item scrolls to the matching section:
   - `mission`
   - `recovery`
   - `hardware`
   - `media`
   - `flights`
   - `contracts`
   - `finance`
   - `faq`
5. Open `/spacex` mobile viewport.
6. Verify top jump rail is sticky and horizontally scrollable.
7. Verify tap navigation works for all section chips.
8. Validate deep links land correctly:
   - `/spacex#flights`
   - `/spacex#contracts`
   - `/spacex#faq`
9. Verify `USASpending awards (SpaceX scope)` panel still loads and pagination buttons work.
10. Verify no empty or broken link behavior in hub sections.

## Acceptance Criteria
- Jump rail works on desktop and mobile.
- All section anchors are present and navigable.
- Core SpaceX hub data blocks remain visible and unchanged in scope.
- All automated checks above pass on pinned toolchain.
