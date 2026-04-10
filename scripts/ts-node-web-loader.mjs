import {
  getFormat as tsNodeGetFormat,
  load as tsNodeLoad,
  resolve as tsNodeResolve,
  transformSource as tsNodeTransformSource
} from 'ts-node/esm';

const WEB_ALIAS_BASE_URLS = [
  ['@/app/', new URL('../apps/web/app/', import.meta.url)],
  ['@/components/', new URL('../apps/web/components/', import.meta.url)],
  ['@/lib/', new URL('../apps/web/lib/', import.meta.url)]
];

function mapWebAlias(specifier) {
  for (const [prefix, baseUrl] of WEB_ALIAS_BASE_URLS) {
    if (specifier.startsWith(prefix)) {
      return new URL(specifier.slice(prefix.length), baseUrl).href;
    }
  }

  return specifier;
}

export function resolve(specifier, context, defaultResolve) {
  return tsNodeResolve(mapWebAlias(specifier), context, defaultResolve);
}

export const load = tsNodeLoad;
export const getFormat = tsNodeGetFormat;
export const transformSource = tsNodeTransformSource;
