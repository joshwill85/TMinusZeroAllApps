import { toProviderSlug } from '@/lib/utils/launchLinks';
import { buildSlugId } from '@/lib/utils/slug';

type CatalogAliasCandidate = {
  entityId: string;
  entityType: string;
  name: string;
};

// Phase 1 keeps only one indexable entity URL when a dedicated hub already exists.
export function buildCatalogCanonicalAliasPath(
  candidate: CatalogAliasCandidate,
  providerSlugs: ReadonlySet<string> = new Set()
) {
  if (candidate.entityType === 'launcher_configurations') {
    return `/rockets/${encodeURIComponent(
      buildSlugId(candidate.name, candidate.entityId)
    )}`;
  }

  if (candidate.entityType === 'agencies') {
    const providerSlug = toProviderSlug(candidate.name);
    if (providerSlug && providerSlugs.has(providerSlug)) {
      return `/launch-providers/${encodeURIComponent(providerSlug)}`;
    }
  }

  return null;
}
