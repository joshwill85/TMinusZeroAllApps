import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  DATA_ATTRIBUTION_AUDIT_DATE,
  DATA_ATTRIBUTION_CLAIMS,
  DATA_SOURCE_REGISTRY,
  type ComplianceStatus,
  type DataSourceRecord
} from '@/lib/constants/dataAttribution';

type SummaryCounts = {
  totalSources: number;
  activeSources: number;
  dormantSources: number;
  totalClaims: number;
  byCompliance: Record<ComplianceStatus, number>;
  byRequirement: Record<'required' | 'recommended' | 'optional' | 'unknown', number>;
};

async function main() {
  const generatedAt = new Date().toISOString();
  const artifactsDir = path.resolve(process.cwd(), '.artifacts', 'data-attribution');
  const docsDir = path.resolve(process.cwd(), 'docs');
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });

  const summary = summarize();
  const inventoryPath = path.join(artifactsDir, 'source-inventory.json');
  const claimsPath = path.join(artifactsDir, 'attribution-claims.json');
  const matrixPath = path.join(artifactsDir, 'compliance-matrix.csv');
  const auditDocPath = path.join(docsDir, `data-attribution-audit-${DATA_ATTRIBUTION_AUDIT_DATE}.md`);
  const remediationDocPath = path.join(docsDir, `data-attribution-remediation-plan-${DATA_ATTRIBUTION_AUDIT_DATE}.md`);

  writeFileSync(
    inventoryPath,
    `${JSON.stringify(
      {
        generatedAt,
        auditDate: DATA_ATTRIBUTION_AUDIT_DATE,
        summary,
        sources: DATA_SOURCE_REGISTRY
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  writeFileSync(
    claimsPath,
    `${JSON.stringify(
      {
        generatedAt,
        auditDate: DATA_ATTRIBUTION_AUDIT_DATE,
        summary: {
          totalClaims: DATA_ATTRIBUTION_CLAIMS.length,
          uniqueSourceKeys: Array.from(new Set(DATA_ATTRIBUTION_CLAIMS.map((claim) => claim.sourceKey))).length
        },
        claims: DATA_ATTRIBUTION_CLAIMS
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  writeFileSync(matrixPath, renderComplianceCsv(), 'utf8');
  writeFileSync(auditDocPath, renderAuditMarkdown(summary, generatedAt), 'utf8');
  writeFileSync(remediationDocPath, renderRemediationMarkdown(generatedAt), 'utf8');

  console.log(`Data attribution audit complete (${DATA_ATTRIBUTION_AUDIT_DATE})`);
  console.log(`- ${inventoryPath}`);
  console.log(`- ${claimsPath}`);
  console.log(`- ${matrixPath}`);
  console.log(`- ${auditDocPath}`);
  console.log(`- ${remediationDocPath}`);
}

function summarize(): SummaryCounts {
  const byCompliance: Record<ComplianceStatus, number> = {
    compliant: 0,
    missing: 0,
    over_attributed: 0,
    unclear: 0
  };
  const byRequirement: Record<'required' | 'recommended' | 'optional' | 'unknown', number> = {
    required: 0,
    recommended: 0,
    optional: 0,
    unknown: 0
  };

  for (const source of DATA_SOURCE_REGISTRY) {
    byCompliance[source.complianceStatus] += 1;
    byRequirement[source.attributionRequirement] += 1;
  }

  return {
    totalSources: DATA_SOURCE_REGISTRY.length,
    activeSources: DATA_SOURCE_REGISTRY.filter((source) => source.mode === 'active').length,
    dormantSources: DATA_SOURCE_REGISTRY.filter((source) => source.mode === 'dormant').length,
    totalClaims: DATA_ATTRIBUTION_CLAIMS.length,
    byCompliance,
    byRequirement
  };
}

function renderComplianceCsv() {
  const header = [
    'source_key',
    'provider_name',
    'source_label',
    'mode',
    'scope',
    'attribution_requirement',
    'compliance_status',
    'remediation_priority',
    'public_claim_count',
    'user_surface_count',
    'policy_reference_urls',
    'remediation_action'
  ];

  const rows = DATA_SOURCE_REGISTRY.map((source) => [
    source.key,
    source.providerName,
    source.sourceLabel,
    source.mode,
    source.scope,
    source.attributionRequirement,
    source.complianceStatus,
    source.remediationPriority,
    String(source.publicClaimSurfaces.length),
    String(source.userFacingSurfaces.length),
    source.policyReferences.map((ref) => ref.url).join(' | '),
    source.remediationAction
  ]);

  return `${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function renderAuditMarkdown(summary: SummaryCounts, generatedAt: string) {
  const openFindings = DATA_SOURCE_REGISTRY.filter((source) => source.complianceStatus === 'missing' || source.complianceStatus === 'unclear');
  const policyWord = (source: DataSourceRecord) =>
    source.policyReferences
      .map((ref) => `[${ref.label}](${ref.url})`)
      .join(', ');

  const sourceRows = DATA_SOURCE_REGISTRY.map(
    (source) =>
      `| ${source.key} | ${source.mode} | ${source.scope} | ${source.attributionRequirement} | ${source.complianceStatus} | ${source.remediationPriority} | ${source.rationale} |`
  ).join('\n');

  const claimRows = DATA_ATTRIBUTION_CLAIMS.map(
    (claim) => `| ${claim.sourceKey} | \`${claim.file}\` | ${claim.claim} |`
  ).join('\n');

  const findingRows = openFindings.length
    ? openFindings.map((source) => `- **${source.sourceLabel}** (${source.key}): ${source.remediationAction}`).join('\n')
    : '- No open attribution/compliance findings.';

  return `# Data Attribution Audit (${DATA_ATTRIBUTION_AUDIT_DATE})

Generated at: ${generatedAt}

## Scope
- Active and dormant data-source integrations.
- Public attribution/disclosure statements in legal/docs/UI copy.
- Policy baseline: provider terms + internal attribution policy.

## Summary
- Total sources: **${summary.totalSources}**
- Active sources: **${summary.activeSources}**
- Dormant sources: **${summary.dormantSources}**
- Attribution claims mapped: **${summary.totalClaims}**
- Compliance: compliant **${summary.byCompliance.compliant}**, missing **${summary.byCompliance.missing}**, over-attributed **${summary.byCompliance.over_attributed}**, unclear **${summary.byCompliance.unclear}**

## Source Matrix
| Source key | Mode | Scope | Requirement | Compliance | Priority | Notes |
|---|---|---|---|---|---|---|
${sourceRows}

## Claim Inventory
| Source key | Surface | Claim |
|---|---|---|
${claimRows}

## Open Findings (Non-Blocking)
${findingRows}

## Policy Evidence
${DATA_SOURCE_REGISTRY.map((source) => `- **${source.sourceLabel}**: ${policyWord(source)}`).join('\n')}

## Enforcement Policy
- Findings marked \`missing\` or \`unclear\` are tracked in internal remediation artifacts and do not block release by default.
- Source labeling and attribution disclosures remain required on user-facing surfaces.

## Assumptions
- Requirement classifications are best-effort based on publicly available provider policy pages.
- When policy language is not explicit, classification remains explicit (\`unknown\` or \`recommended\`) and is tracked as an internal follow-up item.
`;
}

function renderRemediationMarkdown(generatedAt: string) {
  const actionable = DATA_SOURCE_REGISTRY.filter((source) => source.remediationPriority !== 'none');
  const riskRegister = DATA_SOURCE_REGISTRY.filter(
    (source) => source.attributionRequirement === 'unknown' || source.complianceStatus === 'unclear'
  );
  const sorted = actionable.sort((a, b) => priorityWeight(a.remediationPriority) - priorityWeight(b.remediationPriority));
  const rows = sorted
    .map(
      (source) =>
        `| ${source.remediationPriority} | ${source.sourceLabel} | ${source.complianceStatus} | ${source.remediationAction} | ${source.publicClaimSurfaces.join('<br/>') || 'None'} |`
    )
    .join('\n');
  const riskRows = riskRegister
    .map(
      (source) =>
        `| ${source.key} | ${source.attributionRequirement} | ${source.complianceStatus} | ${source.remediationAction} | internal-compliance-owner | next audit cycle | non_blocking_follow_up |`
    )
    .join('\n');

  return `# Data Attribution Remediation Plan (${DATA_ATTRIBUTION_AUDIT_DATE})

Generated at: ${generatedAt}

## Objectives
- Remove attribution gaps for active feature-specific data sources.
- Ensure legal/disclosure copy tracks real ingestion and display behavior.
- Preserve explicit distinctions between active and dormant integrations.
- Keep \`unknown\` / \`unclear\` requirement follow-up non-blocking and tracked internally.

## Prioritized Actions
| Priority | Source | Gap | Action | Current claim surfaces |
|---|---|---|---|---|
${rows || '| none | n/a | n/a | No open remediation actions. | n/a |'}

## Implementation Checklist
- [x] Centralize source registry and claim inventory in code.
- [x] Generate machine-readable audit artifacts (JSON + CSV).
- [x] Update legal data page with active feature-specific sources.
- [x] Align FAQ/footer copy with primary-source wording (avoid LL2-only overstatement).
- [x] Keep detailed requirement notes and unknown/unclear handling in internal docs/artifacts (not public legal copy).
- [ ] Maintain the internal risk register for sources marked \`unknown\` / \`unclear\`.

## Internal Risk Register
| Source key | Requirement | Compliance | Follow-up action | Owner | Next review | Disposition |
|---|---|---|---|---|---|---|
${riskRows || '| n/a | n/a | n/a | No open internal risk items. | n/a | n/a | n/a |'}

## Non-Blocking Enforcement Policy
- Unknown/unclear items are tracked for follow-up and do not block releases by default.
- Any blocking gate must be introduced via an explicit, separate policy decision.

## Roll-Forward Guardrail
- Run \`npm run audit:data-attribution\` on any PR that changes ingestion sources or attribution copy.
`;
}

function priorityWeight(priority: DataSourceRecord['remediationPriority']) {
  if (priority === 'P0') return 0;
  if (priority === 'P1') return 1;
  if (priority === 'P2') return 2;
  return 3;
}

function csvCell(value: string) {
  const safe = String(value ?? '');
  if (!safe.includes(',') && !safe.includes('"') && !safe.includes('\n')) return safe;
  return `"${safe.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error('Data attribution audit failed', error);
  process.exitCode = 1;
});
