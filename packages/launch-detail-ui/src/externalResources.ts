import type { LaunchDetailV1 } from '@tminuszero/contracts';

type LaunchExternalContentItem = NonNullable<LaunchDetailV1['enrichment']>['externalContent'][number];
type LaunchExternalContentResource = LaunchExternalContentItem['resources'][number];

export type ResponsiveResourcePreference = 'desktop' | 'mobile';

type ResponsiveVariant = 'desktop' | 'mobile';

const RESPONSIVE_RESOURCE_ID_RE = /(image|video|infographic)(Desktop|Mobile):/i;
const RESPONSIVE_RESOURCE_LABEL_RE = /\s+\((mobile|desktop)\)$/i;

export function selectPreferredResponsiveLaunchExternalContent(
  items: LaunchExternalContentItem[],
  preferredVariant: ResponsiveResourcePreference
): LaunchExternalContentItem[] {
  return items.map((item) => ({
    ...item,
    resources: selectPreferredResponsiveLaunchExternalResources(item.resources, preferredVariant)
  }));
}

export function selectPreferredResponsiveLaunchExternalResources(
  resources: LaunchExternalContentResource[],
  preferredVariant: ResponsiveResourcePreference
): LaunchExternalContentResource[] {
  const groups = new Map<
    string,
    {
      desktop: LaunchExternalContentResource | null;
      mobile: LaunchExternalContentResource | null;
    }
  >();
  const ordered: Array<{ type: 'raw'; resource: LaunchExternalContentResource } | { type: 'group'; key: string }> = [];

  for (const resource of resources) {
    const signature = getResponsiveResourceSignature(resource);
    if (!signature) {
      ordered.push({ type: 'raw', resource });
      continue;
    }

    if (!groups.has(signature.groupKey)) {
      groups.set(signature.groupKey, { desktop: null, mobile: null });
      ordered.push({ type: 'group', key: signature.groupKey });
    }

    const group = groups.get(signature.groupKey);
    if (!group) continue;
    if (!group[signature.variant]) {
      group[signature.variant] = resource;
    }
  }

  return ordered
    .map((entry) => {
      if (entry.type === 'raw') return entry.resource;
      const group = groups.get(entry.key);
      if (!group) return null;
      const selected = preferredVariant === 'mobile' ? group.mobile || group.desktop : group.desktop || group.mobile;
      if (!selected) return null;
      return normalizeResponsiveResourceLabel(selected);
    })
    .filter((resource): resource is LaunchExternalContentResource => Boolean(resource));
}

function getResponsiveResourceSignature(
  resource: LaunchExternalContentResource
): { groupKey: string; variant: ResponsiveVariant } | null {
  if (resource.source !== 'spacex_content') return null;

  const id = normalizeText(resource.id);
  if (id) {
    const match = id.match(RESPONSIVE_RESOURCE_ID_RE);
    if (match?.[1] && match?.[2]) {
      const variant = match[2].toLowerCase() as ResponsiveVariant;
      return {
        groupKey: `id:${id.replace(RESPONSIVE_RESOURCE_ID_RE, `${match[1]}:`).toLowerCase()}`,
        variant
      };
    }
  }

  const label = normalizeText(resource.label);
  const labelMatch = label.match(RESPONSIVE_RESOURCE_LABEL_RE);
  const sourceId = normalizeText(resource.sourceId);
  if (!labelMatch || !sourceId || !resource.kind) return null;

  const variant = labelMatch[1].toLowerCase() as ResponsiveVariant;
  const baseLabel = label.replace(RESPONSIVE_RESOURCE_LABEL_RE, '').trim().toLowerCase();
  if (!baseLabel) return null;

  return {
    groupKey: `label:${resource.kind}:${sourceId.toLowerCase()}:${baseLabel}`,
    variant
  };
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeResponsiveResourceLabel(resource: LaunchExternalContentResource): LaunchExternalContentResource {
  const normalizedLabel = normalizeText(resource.label).replace(RESPONSIVE_RESOURCE_LABEL_RE, '');
  if (!normalizedLabel || normalizedLabel === resource.label) return resource;
  return {
    ...resource,
    label: normalizedLabel
  };
}
