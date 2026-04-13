import type { Metadata } from 'next';

import { DEFAULT_SITE_URL } from '@/lib/brand';
import { normalizeEnvText } from '@/lib/env/normalize';
import {
  isNonCanonicalVercelSiteUrl,
  resolveSiteUrlCandidate
} from '@/lib/server/env';

type IndexingEnvironment = {
  allowLocalIndexing?: boolean | null;
  nodeEnv?: string | null;
  siteUrl?: string | null;
  vercelEnv?: string | null;
  vercelProductionUrl?: string | null;
};

export function isNonProductionDeployment(
  environment: IndexingEnvironment = {}
) {
  const vercelEnv = normalizeEnvText(
    environment.vercelEnv ?? process.env.VERCEL_ENV
  )?.toLowerCase();
  if (vercelEnv) {
    return vercelEnv !== 'production';
  }

  const nodeEnv = normalizeEnvText(
    environment.nodeEnv ?? process.env.NODE_ENV
  )?.toLowerCase();
  return Boolean(nodeEnv && nodeEnv !== 'production');
}

export function isLocalIndexingEnabled(environment: IndexingEnvironment = {}) {
  const vercelEnv = normalizeEnvText(
    environment.vercelEnv ?? process.env.VERCEL_ENV
  )?.toLowerCase();
  if (vercelEnv) {
    return false;
  }

  if (typeof environment.allowLocalIndexing === 'boolean') {
    return environment.allowLocalIndexing;
  }

  const value = normalizeEnvText(
    process.env.TMZ_ALLOW_LOCAL_INDEXING
  )?.toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function getIndexingSiteUrl(environment: IndexingEnvironment = {}) {
  const explicitSiteUrl = resolveSiteUrlCandidate(
    environment.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL
  );
  const productionSiteUrl = resolveProductionSiteUrl(
    environment.vercelProductionUrl ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
  );

  if (isNonProductionDeployment(environment)) {
    if (isLocalIndexingEnabled(environment) && explicitSiteUrl) {
      return explicitSiteUrl;
    }
    return productionSiteUrl || DEFAULT_SITE_URL;
  }

  if (
    explicitSiteUrl &&
    (isLocalSiteUrl(explicitSiteUrl) ||
      !isNonCanonicalVercelSiteUrl(explicitSiteUrl))
  ) {
    return explicitSiteUrl;
  }

  return productionSiteUrl || DEFAULT_SITE_URL;
}

export function shouldAllowPublicIndexing(
  environment: IndexingEnvironment = {}
) {
  const vercelEnv = normalizeEnvText(
    environment.vercelEnv ?? process.env.VERCEL_ENV
  )?.toLowerCase();
  if (vercelEnv) {
    return vercelEnv === 'production' && !isLocalSiteUrl(getIndexingSiteUrl(environment));
  }

  const explicitSiteUrl = resolveSiteUrlCandidate(
    environment.siteUrl ?? process.env.NEXT_PUBLIC_SITE_URL
  );
  if (explicitSiteUrl && isLocalSiteUrl(explicitSiteUrl)) {
    return isLocalIndexingEnabled(environment);
  }

  if (isLocalIndexingEnabled(environment)) {
    return true;
  }

  if (isNonProductionDeployment(environment)) {
    return false;
  }

  return !isLocalSiteUrl(getIndexingSiteUrl(environment));
}

export function buildDeploymentNoIndexRobots(): Metadata['robots'] {
  return {
    index: false,
    follow: false
  };
}

export function buildIndexQualityNoIndexRobots(): Metadata['robots'] {
  return {
    index: false,
    follow: true
  };
}

function resolveProductionSiteUrl(value: string | null | undefined) {
  const resolved = resolveSiteUrlCandidate(value ?? undefined);
  if (!resolved || isNonCanonicalVercelSiteUrl(resolved)) {
    return null;
  }
  return resolved;
}

function isLocalSiteUrl(siteUrl: string) {
  try {
    const hostname = new URL(siteUrl).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0'
    );
  } catch {
    const normalized = siteUrl.trim().toLowerCase();
    return normalized.includes('localhost') || normalized.includes('127.0.0.1');
  }
}
