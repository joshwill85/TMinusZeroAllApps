import { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { verifyOtpTokenHash } from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

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

export default function AuthCallbackScreen() {
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    refresh_token?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
    error_description?: string | string[];
  }>();
  const { persistSession, theme } = useMobileBootstrap();
  const [status, setStatus] = useState<CallbackStatus>({
    state: 'loading',
    message: 'Resolving mobile auth callback.'
  });

  useEffect(() => {
    let cancelled = false;

    async function resolveCallback() {
      const errorDescription = readParam(params.error_description).trim();
      if (errorDescription) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: errorDescription
          });
        }
        return;
      }

      const directAccessToken = readParam(params.access_token).trim();
      const directRefreshToken = readParam(params.refresh_token).trim();
      if (directAccessToken) {
        await persistSession({
          accessToken: directAccessToken,
          refreshToken: directRefreshToken || null
        });
        if (!cancelled) {
          setStatus({ state: 'ready' });
        }
        return;
      }

      const tokenHash = readParam(params.token_hash).trim();
      const type = readParam(params.type).trim();
      if (!tokenHash || !type) {
        if (!cancelled) {
          setStatus({
            state: 'error',
            message: 'The callback did not include a token payload.'
          });
        }
        return;
      }

      try {
        const session = await verifyOtpTokenHash(tokenHash, type);
        await persistSession({
          accessToken: session.accessToken,
          refreshToken: session.refreshToken
        });
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
  }, [params.access_token, params.error_description, params.refresh_token, params.token_hash, params.type, persistSession]);

  if (status.state === 'ready') {
    return <Redirect href="/(tabs)/profile" />;
  }

  return (
    <AppScreen>
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
