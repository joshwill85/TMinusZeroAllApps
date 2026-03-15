import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const ALIAS_ROOTS = [
  ['@/lib/', path.join(ROOT, 'apps/web/lib')],
  ['@/components/', path.join(ROOT, 'apps/web/components')],
  ['@/app/', path.join(ROOT, 'apps/web/app')]
];

function resolveAliasPath(specifier) {
  for (const [prefix, targetRoot] of ALIAS_ROOTS) {
    if (!specifier.startsWith(prefix)) {
      continue;
    }

    const suffix = specifier.slice(prefix.length);
    const candidateRoot = path.join(targetRoot, suffix);
    const candidates = [
      candidateRoot,
      `${candidateRoot}.ts`,
      `${candidateRoot}.tsx`,
      `${candidateRoot}.js`,
      `${candidateRoot}.mjs`,
      path.join(candidateRoot, 'index.ts'),
      path.join(candidateRoot, 'index.tsx'),
      path.join(candidateRoot, 'index.js'),
      path.join(candidateRoot, 'index.mjs')
    ];

    const resolvedPath = candidates.find((candidate) => fs.existsSync(candidate));
    if (!resolvedPath) {
      throw new Error(`Unable to resolve path alias for ${specifier}`);
    }

    return resolvedPath;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const resolvedPath = resolveAliasPath(specifier);
  if (!resolvedPath) {
    return nextResolve(specifier, context);
  }

  return nextResolve(pathToFileURL(resolvedPath).href, context);
}
