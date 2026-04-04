# 2026-04-04 Profile Account IA Refresh Plan

## Scope

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: not required for the first pass

## Goal

Reduce the account/profile surfaces to a smaller set of clearly owned sections, remove duplicated membership state, and align web plus mobile around the same account taxonomy while preserving platform-specific billing and alert flows.

## Current problems

- The current root account screens repeat access and membership state across hero, overview, billing, and utility blocks.
- Mobile uses equal-weight action buttons where a settings-style row model is more appropriate.
- Web uses a long account page as a dumping ground for unrelated cards.
- Privacy and account-data actions are fragmented between the account surface and privacy-choices.
- Notifications are represented both as account content and as a separate mobile-only destination.

## Target taxonomy

The top-level account IA should use these section owners:

1. Identity & Security
2. Membership & Billing
3. Communications & Alerts
4. Launch Tools
5. Privacy & Data
6. Support & Legal

## Mobile target

- Rename the tab label from `Profile` to `Account`.
- Rename the tab label from `Settings` to `Alerts`.
- Keep the root account screen summary-first.
- Keep one summary block for name, access, and current renewal state.
- Move editable profile fields off the root screen into a dedicated account detail screen.
- Move billing and membership actions off the root screen into a dedicated membership screen.
- Keep login methods on the existing dedicated screen.
- Keep alerts on the existing dedicated mobile push screen.
- Point privacy/data requests to the existing privacy-choices screen.
- Keep admin testing separate from the customer account navigation.

### Mobile root block order

1. Account hero
2. Account summary
3. Manage account rows
4. Admin access testing when applicable
5. Sign out

## Web target

- Rename the primary page concept from `Profile` to `Account`.
- Use the root `/account` page as an account hub rather than a scrolling pile of cards.
- Keep one summary card that combines identity and membership status.
- Keep the profile edit form but make it one owned section instead of part of a mixed overview.
- Keep billing in one owned section.
- Move destructive account-data actions to privacy-choices and link to them from the hub.
- Demote tip jar management below the primary account sections.
- Replace generic `Open` link labels with specific management verbs.

### Web root block order

1. Account header
2. Account summary
3. Identity & Security
4. Membership & Billing
5. Communications & Alerts
6. Launch Tools
7. Privacy & Data
8. Support & Extras

## Platform-specific rules

- Billing remains platform-specific.
  - Web: Stripe and tip jar
  - Mobile: App Store and Google Play
- Alerts remain mobile-first.
- Integrations remain web-first, but mobile keeps its existing destination for parity.
- Shared terminology should remain aligned for account status, deletion, and marketing-email copy.

## Rollout order

1. Update mobile account IA and navigation labels.
2. Add dedicated mobile account detail and membership screens.
3. Refactor the web account hub around the same taxonomy.
4. Update web account subpage copy to use `Account` terminology.
5. Run targeted verification and fix accessibility regressions.

## Verification

- `node -v && npm -v`
- `npm run doctor`
- `npm run type-check:ci`
- `npm run type-check:mobile`
- `npm run lint`
- `npm run lint --workspace @tminuszero/mobile`

## Risks

- Route-label changes can confuse existing copy or tests if the old `Profile` and `Settings` labels are asserted.
- Mobile and web billing need separate copy paths; do not force one shared billing UI.
- Deletion must remain easy to find on mobile to stay aligned with Apple guidance.
