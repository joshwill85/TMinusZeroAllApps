import { useEffect, useMemo, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import type { Href } from 'expo-router';
import { Text } from 'react-native';
import { buildMobileRoute, readAuthIntent, readReturnTo, resolveMobileAuthRedirectPath } from '@tminuszero/navigation';
import { recordMobileAuthContext } from '@/src/auth/authContext';
import { completeMobileAuthCallbackUrl } from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

type CallbackStatus =
  | { state: 'loading'; message: string }
  | { state: 'error'; message: string }
  | { state: 'ready' };

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

function buildCallbackUrl(params: {
  code?: string | string[];
  token_hash?: string | string[];
  type?: string | string[];
  provider?: string | string[];
  error_description?: string | string[];
  error?: string | string[];
}) {
  const searchParams = new URLSearchParams();
  const entries = [
    ['code', readParam(params.code)],
    ['token_hash', readParam(params.token_hash)],
    ['type', readParam(params.type)],
    ['provider', readParam(params.provider)],
    ['error_description', readParam(params.error_description)],
    ['error', readParam(params.error)]
  ] as const;

  for (const [key, value] of entries) {
    if (value.trim()) {
      searchParams.set(key, value.trim());
    }
  }

  const serialized = searchParams.toString();
  return serialized ? `tminuszero://auth/callback?${serialized}` : 'tminuszero://auth/callback';
}

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    code?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
    provider?: string | string[];
    error_description?: string | string[];
    error?: string | string[];
    return_to?: string | string[];
    next?: string | string[];
    intent?: string | string[];
  }>();
  const { persistSession, theme } = useMobileBootstrap();
  const code = readParam(params.code);
  const tokenHash = readParam(params.token_hash);
  const type = readParam(params.type);
  const provider = readParam(params.provider);
  const errorDescription = readParam(params.error_description);
  const error = readParam(params.error);
  const callbackUrl = useMemo(
    () =>
      buildCallbackUrl({
        code,
        token_hash: tokenHash,
        type,
        provider,
        error_description: errorDescription,
        error
      }),
    [code, tokenHash, type, provider, errorDescription, error]
  );
  const redirectHref = useMemo(() => {
    const queryReader = {
      get(key: string) {
        if (key === 'return_to') return readParam(params.return_to);
        if (key === 'next') return readParam(params.next);
        if (key === 'intent') return readParam(params.intent);
        return null;
      }
    };

    return resolveMobileAuthRedirectPath({
      returnTo: readReturnTo(queryReader, ''),
      intent: readAuthIntent(queryReader),
      fallback: buildMobileRoute('profile')
    });
  }, [params.intent, params.next, params.return_to]);
  const [status, setStatus] = useState<CallbackStatus>({
    state: 'loading',
    message: 'Resolving mobile auth callback.'
  });

  useEffect(() => {
    let cancelled = false;

    async function resolveCallback() {
      try {
        const result = await completeMobileAuthCallbackUrl(callbackUrl);
        await persistSession({
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken
        });
        await recordMobileAuthContext(result.session.accessToken, {
          provider: result.provider,
          eventType: 'oauth_callback'
        }).catch(() => {});
        if (!cancelled) {
          setStatus({ state: 'ready' });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: error instanceof Error ? error.message : 'Unable to complete the auth callback.'
          });
        }
      }
    }

    void resolveCallback();
    return () => {
      cancelled = true;
    };
  }, [callbackUrl, persistSession]);

  if (status.state === 'ready') {
    return <Redirect href={redirectHref as Href} />;
  }

  return (
    <AppScreen testID="auth-callback-screen">
      <ScreenHeader
        eyebrow="Auth callback"
        title="Completing sign-in"
        description="This native route finalizes bearer auth and returns you to the shared profile flow."
      />

      {status.state === 'loading' ? (
        <LoadingStateCard title="Completing callback" body={status.message} />
      ) : (
        <>
          <ErrorStateCard title="Callback failed" body={status.message} />
          <SectionCard title="Next step">
            <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 21 }}>
              Re-open sign-in and try again. The mobile shell only accepts callbacks that resolve into a bearer session.
            </Text>
          </SectionCard>
        </>
      )}
    </AppScreen>
  );
}
