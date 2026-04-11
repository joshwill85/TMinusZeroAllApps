export const AUTH_SOURCE_PROVIDER_ORDER = ['email_password', 'google', 'apple'] as const;

export type AuthSourceProvider = (typeof AUTH_SOURCE_PROVIDER_ORDER)[number];

export type AuthSource =
  | 'email_only'
  | 'google_only'
  | 'apple_only'
  | 'email_google'
  | 'email_apple'
  | 'google_apple'
  | 'email_google_apple'
  | 'unknown';

export function normalizeAuthSourceProvider(value: unknown): AuthSourceProvider | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();

  if (normalized === 'email' || normalized === 'email_password') {
    return 'email_password';
  }
  if (normalized === 'google') {
    return 'google';
  }
  if (normalized === 'apple') {
    return 'apple';
  }

  return null;
}

export function collectAuthSourceProviders(input: {
  identityProviders?: Iterable<unknown> | null;
  appProviders?: Iterable<unknown> | null;
  primaryProvider?: unknown;
  fallbackEmail?: unknown;
}): AuthSourceProvider[] {
  const providers = new Set<AuthSourceProvider>();

  for (const value of input.identityProviders ?? []) {
    const normalized = normalizeAuthSourceProvider(value);
    if (normalized) {
      providers.add(normalized);
    }
  }

  const normalizedPrimary = normalizeAuthSourceProvider(input.primaryProvider);
  if (normalizedPrimary) {
    providers.add(normalizedPrimary);
  }

  for (const value of input.appProviders ?? []) {
    const normalized = normalizeAuthSourceProvider(value);
    if (normalized) {
      providers.add(normalized);
    }
  }

  const normalizedFallbackEmail = String(input.fallbackEmail || '').trim();
  if (normalizedFallbackEmail) {
    providers.add('email_password');
  }

  return AUTH_SOURCE_PROVIDER_ORDER.filter((provider) => providers.has(provider));
}

export function resolveAuthSource(providers: Iterable<unknown>): AuthSource {
  const normalizedProviders = AUTH_SOURCE_PROVIDER_ORDER.filter((provider) => {
    for (const value of providers) {
      if (normalizeAuthSourceProvider(value) === provider) {
        return true;
      }
    }
    return false;
  });

  const key = normalizedProviders.join('_');
  if (key === 'email_password') return 'email_only';
  if (key === 'google') return 'google_only';
  if (key === 'apple') return 'apple_only';
  if (key === 'email_password_google') return 'email_google';
  if (key === 'email_password_apple') return 'email_apple';
  if (key === 'google_apple') return 'google_apple';
  if (key === 'email_password_google_apple') return 'email_google_apple';
  return 'unknown';
}
