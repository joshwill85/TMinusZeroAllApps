type SearchParamsReader = {
  get: (key: string) => string | null;
};

export type AuthIntent = 'upgrade';

export function sanitizeReturnTo(value: string | null | undefined, fallback = '/') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return fallback;
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.startsWith('/\\')) {
    return fallback;
  }

  try {
    const parsed = new URL(trimmed, 'https://auth.local');
    if (parsed.origin !== 'https://auth.local') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function readReturnTo(searchParams: SearchParamsReader, fallback = '/') {
  const explicit = searchParams.get('return_to');
  if (explicit) return sanitizeReturnTo(explicit, fallback);
  return sanitizeReturnTo(searchParams.get('next'), fallback);
}

export function readAuthIntent(searchParams: SearchParamsReader): AuthIntent | null {
  const intent = String(searchParams.get('intent') || '')
    .trim()
    .toLowerCase();
  return intent === 'upgrade' ? 'upgrade' : null;
}

export function buildAuthQuery({
  returnTo,
  intent
}: {
  returnTo?: string | null;
  intent?: AuthIntent | null;
}) {
  const params = new URLSearchParams();
  const safeReturnTo = sanitizeReturnTo(returnTo, '/');
  if (safeReturnTo && safeReturnTo !== '/') {
    params.set('return_to', safeReturnTo);
  } else if (safeReturnTo === '/') {
    params.set('return_to', '/');
  }
  if (intent) {
    params.set('intent', intent);
  }
  return params.toString();
}

export function withAuthQuery(
  path: string,
  options: {
    returnTo?: string | null;
    intent?: AuthIntent | null;
  } = {}
) {
  const query = buildAuthQuery(options);
  return query ? `${path}?${query}` : path;
}
