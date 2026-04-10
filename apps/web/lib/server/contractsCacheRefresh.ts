import { revalidatePath } from 'next/cache';
import {
  refreshCanonicalContractsCache,
  type CanonicalContractSummary
} from '@/lib/server/contracts';

const BASE_REVALIDATE_PATHS = [
  '/contracts',
  '/spacex',
  '/spacex/contracts',
  '/blue-origin',
  '/blue-origin/contracts',
  '/artemis',
  '/artemis/contracts',
  '/sitemap.xml',
  '/sitemap-entities.xml'
] as const;

const MAX_DETAIL_REVALIDATE_PATHS = 600;

export type CanonicalContractsCacheRefreshSummary = {
  contractRows: number;
  revalidatedPaths: number;
  skippedDetailPaths: number;
};

export async function refreshCanonicalContractsCacheAndRevalidate(): Promise<CanonicalContractsCacheRefreshSummary> {
  const rows = await refreshCanonicalContractsCache();
  const revalidatePaths = new Set<string>(BASE_REVALIDATE_PATHS);
  const detailPaths = collectDetailRevalidatePaths(rows);

  for (const path of detailPaths.slice(0, MAX_DETAIL_REVALIDATE_PATHS)) {
    revalidatePaths.add(path);
  }

  for (const path of revalidatePaths) {
    revalidatePath(path);
  }

  return {
    contractRows: rows.length,
    revalidatedPaths: revalidatePaths.size,
    skippedDetailPaths: Math.max(0, detailPaths.length - MAX_DETAIL_REVALIDATE_PATHS)
  };
}

function collectDetailRevalidatePaths(rows: CanonicalContractSummary[]) {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const row of rows) {
    for (const value of [row.canonicalPath, row.programPath]) {
      const path = normalizePath(value);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      paths.push(path);
    }
  }

  return paths;
}

function normalizePath(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized.startsWith('/')) return null;
  return normalized;
}
