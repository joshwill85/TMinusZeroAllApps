import assert from 'node:assert/strict';

import { DEFAULT_SITE_URL } from '@/lib/brand';
import { getSiteUrl } from '@/lib/server/env';
import {
  buildDeploymentNoIndexRobots,
  buildIndexQualityNoIndexRobots,
  getIndexingSiteUrl,
  shouldAllowPublicIndexing
} from '@/lib/server/indexing';
import { buildCatalogCanonicalAliasPath } from '@/lib/server/seoAliases';

function main() {
  assert.equal(
    shouldAllowPublicIndexing({
      siteUrl: 'https://www.tminuszero.com',
      vercelEnv: 'production',
      nodeEnv: 'production'
    }),
    true,
    'production should remain indexable'
  );

  assert.equal(
    shouldAllowPublicIndexing({
      siteUrl: 'https://preview.tminuszero.com',
      vercelEnv: 'preview',
      nodeEnv: 'production'
    }),
    false,
    'preview deployments should be blocked from indexing'
  );

  assert.deepEqual(buildDeploymentNoIndexRobots(), {
    index: false,
    follow: false
  });
  assert.deepEqual(buildIndexQualityNoIndexRobots(), {
    index: false,
    follow: true
  });

  withManagedEnv(
    {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'https://tminuszero-mobile-staging.vercel.app'
    },
    () => {
      assert.equal(
        getSiteUrl(),
        DEFAULT_SITE_URL,
        'production-style builds should not emit preview hosts'
      );
      assert.equal(
        getIndexingSiteUrl(),
        DEFAULT_SITE_URL,
        'indexing URLs should fall back to the canonical production host'
      );
    }
  );

  withManagedEnv(
    {
      NODE_ENV: 'production',
      VERCEL_ENV: 'preview',
      NEXT_PUBLIC_SITE_URL: 'https://tminuszero-mobile-staging.vercel.app'
    },
    () => {
      assert.equal(
        getSiteUrl(),
        'https://tminuszero-mobile-staging.vercel.app',
        'preview deployments should keep their preview host for runtime links'
      );
      assert.equal(
        getIndexingSiteUrl(),
        DEFAULT_SITE_URL,
        'preview deployments should still canonicalize SEO output to production'
      );
      assert.equal(
        shouldAllowPublicIndexing(),
        false,
        'preview deployments should remain non-indexable'
      );
    }
  );

  withManagedEnv(
    {
      NODE_ENV: 'production',
      NEXT_PUBLIC_SITE_URL: 'http://localhost:3100',
      TMZ_ALLOW_LOCAL_INDEXING: '1'
    },
    () => {
      assert.equal(
        getSiteUrl(),
        'http://localhost:3100',
        'explicit localhost should remain available for local verification'
      );
      assert.equal(
        getIndexingSiteUrl(),
        'http://localhost:3100',
        'local indexing overrides should preserve localhost canonicals'
      );
      assert.equal(
        shouldAllowPublicIndexing(),
        true,
        'local indexing override should allow public indexing in local tests'
      );
    }
  );

  assert.equal(
    buildCatalogCanonicalAliasPath({
      entityType: 'launcher_configurations',
      entityId: '164',
      name: 'Falcon 9'
    }),
    '/rockets/falcon-9-164',
    'launcher configuration aliases should resolve to rocket hubs'
  );

  assert.equal(
    buildCatalogCanonicalAliasPath(
      {
        entityType: 'agencies',
        entityId: '121',
        name: 'SpaceX'
      },
      new Set(['spacex'])
    ),
    '/launch-providers/spacex',
    'provider agencies should resolve to canonical provider hubs'
  );

  assert.equal(
    buildCatalogCanonicalAliasPath(
      {
        entityType: 'agencies',
        entityId: '777',
        name: 'Axiom Space'
      },
      new Set(['spacex'])
    ),
    null,
    'non-provider agencies should remain on catalog detail routes'
  );

  console.log('seo-phase1-audit: ok');
}

function withManagedEnv(
  values: Partial<Record<ManagedEnvKey, string>>,
  callback: () => void
) {
  const previous = new Map(
    MANAGED_ENV_KEYS.map((key) => [key, process.env[key]] as const)
  );

  for (const key of MANAGED_ENV_KEYS) {
    const nextValue = values[key];
    if (typeof nextValue === 'string') {
      process.env[key] = nextValue;
    } else {
      delete process.env[key];
    }
  }

  try {
    callback();
  } finally {
    for (const key of MANAGED_ENV_KEYS) {
      const original = previous.get(key);
      if (typeof original === 'string') {
        process.env[key] = original;
      } else {
        delete process.env[key];
      }
    }
  }
}

const MANAGED_ENV_KEYS = [
  'NEXT_PUBLIC_SITE_URL',
  'VERCEL_URL',
  'VERCEL_ENV',
  'NODE_ENV',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'TMZ_ALLOW_LOCAL_INDEXING'
] as const;

type ManagedEnvKey = (typeof MANAGED_ENV_KEYS)[number];

main();
