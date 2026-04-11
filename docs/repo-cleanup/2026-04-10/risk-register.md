# Risk Register

Date: `2026-04-10`

## Current Risks

| Risk | Evidence | Impact if cleanup is sloppy | Audit stance |
| --- | --- | --- | --- |
| Dirty worktree already exists in active product areas | current uncommitted changes in web, mobile, packages, docs, and Supabase | easy to mix cleanup with feature work or overwrite user changes | do not touch active product files in cleanup batch 1 |
| Auth / billing / premium onboarding is live work | modified files under account/auth/billing/premium onboarding paths | regression risk is high and rollback reasoning is complex | human approval required before any cleanup in these areas |
| `/api/v1` contract surface is large and central | many `apps/web/app/api/v1/**` routes and shared package consumers | “cleanup” can silently become API breakage | no route deletion in early batches |
| Supabase migration history is large and churn-heavy | `323` migrations, repeated policy/cron/function rewrites | migration rewrite without baseline validation can break local reset and production parity | documentation-only strategy first |
| Tracked evidence files may still be referenced by docs | `.artifacts/**`, `docs/evidence/**`, active plan docs | deleting evidence before updating references creates broken runbooks | archive/migrate references first |
| `docs/three-platform-overhaul-plan.md` is both active and historical | living plan contains missing refs and long changelog history | blind trimming can remove active context that people still rely on | split, do not blindly shorten |
| `scripts/` imports app internals | many scripts use `@/lib/...` and `../apps/web/...` | moving or deleting scripts can break ops tasks that are not CI-wired | quarantine/manual review, not blind deletion |
| `shared/` is used by runtime code | imported from both `apps/web` and `supabase/functions` | moving without coordinated import updates breaks both surfaces | move only in a dedicated batch with full type-check |
| Launch-detail surface is duplicated across web/mobile | same component family names appear in both trees | large refactor can become UI behavior change fast | defer until after residue/docs cleanup |
| Oversized server modules hide duplicated logic | `apps/web/lib/server/v1/mobileApi.ts` is a god-module | broad split can create subtle behavior drift | do later, with targeted validation |

## False-Positive Risks

| Signal | Why it can lie | Rule for this cleanup |
| --- | --- | --- |
| “Script has zero references” | it may still be run manually from shell history/runbooks | quarantine or archive before deletion unless proof is overwhelming |
| “Doc is old” | old docs can still be the only rollback/runbook source | archive with replacement pointer, do not just delete |
| “Duplicate helper” | similar helpers can hide platform-specific behavior | consolidate only after diffing semantics |
| “Legacy route” | compatibility entrypoints may still be active | require call-site and analytics review before removal |
| “Migration looks superseded” | historical migrations still define the reset path | never rewrite without a validated baseline branch |

## Areas Requiring Human Approval Before Execution

- any cleanup in currently dirty product files
- any deletion or rewrite of `/api/v1` routes
- any billing/auth/premium-onboarding cleanup outside docs
- any Supabase migration rewrite, squash, or reorder
- any change to mobile release config, EAS, native bundle IDs, or app-store-facing metadata
- any deletion of tracked evidence that a current release, compliance, or rollback doc still cites

## Safe-Now Areas

- root temp files and session residue
- tracked local Supabase branch marker
- root doc/archive cleanup for obviously stale one-off guides and session logs
- broken markdown references
- inventory and archive planning for `.artifacts/` and `docs/evidence/`

