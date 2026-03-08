import { useEffect, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { updatePassword, verifyOtpTokenHash } from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useMobileBootstrap } from '@/src/providers/AppProviders';

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    access_token?: string | string[];
    refresh_token?: string | string[];
    token_hash?: string | string[];
    type?: string | string[];
    error_description?: string | string[];
  }>();
  const { accessToken, persistSession, theme } = useMobileBootstrap();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<{
    mode: 'verifying' | 'ready' | 'submitting' | 'success' | 'error';
    message: string;
  }>({
    mode: 'verifying',
    message: 'Verifying reset token.'
  });

  useEffect(() => {
    let cancelled = false;

    async function resolveResetSession() {
      const errorDescription = readParam(params.error_description).trim();
      if (errorDescription) {
        if (!cancelled) {
          setStatus({
            mode: 'error',
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
          setStatus({
            mode: 'ready',
            message: 'Choose a new password for this account.'
          });
        }
        return;
      }

      if (accessToken) {
        if (!cancelled) {
          setStatus({
            mode: 'ready',
            message: 'Choose a new password for this account.'
          });
        }
        return;
      }

      const tokenHash = readParam(params.token_hash).trim();
      const type = readParam(params.type).trim();
      if (!tokenHash || !type) {
        if (!cancelled) {
          setStatus({
            mode: 'error',
            message: 'The reset link did not include a usable token.'
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
          setStatus({
            mode: 'ready',
            message: 'Choose a new password for this account.'
          });
        }
      } catch (error) {
        if (!cancelled) {
          setStatus({
            mode: 'error',
            message: error instanceof Error ? error.message : 'Unable to verify the reset link.'
          });
        }
      }
    }

    void resolveResetSession();
    return () => {
      cancelled = true;
    };
  }, [accessToken, params.access_token, params.error_description, params.refresh_token, params.token_hash, params.type, persistSession]);

  async function handleSubmit() {
    if (!accessToken) {
      setStatus({
        mode: 'error',
        message: 'No authenticated reset session is available.'
      });
      return;
    }
    if (password.length < 8) {
      setStatus({
        mode: 'error',
        message: 'Password must be at least 8 characters.'
      });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({
        mode: 'error',
        message: 'Passwords do not match.'
      });
      return;
    }

    setStatus({
      mode: 'submitting',
      message: 'Saving your new password.'
    });
    try {
      await updatePassword(accessToken, password);
      setPassword('');
      setConfirmPassword('');
      setStatus({
        mode: 'success',
        message: 'Password updated.'
      });
    } catch (error) {
      setStatus({
        mode: 'error',
        message: error instanceof Error ? error.message : 'Unable to update the password.'
      });
    }
  }

  if (status.mode === 'success') {
    return <Redirect href="/(tabs)/profile" />;
  }

  return (
    <AppScreen keyboardShouldPersistTaps="handled">
      <ScreenHeader
        eyebrow="Reset password"
        title="Finish recovery"
        description="This route verifies the deep-link token, restores a mobile session, and updates the password natively."
      />

      {status.mode === 'verifying' ? <LoadingStateCard title="Verifying link" body={status.message} /> : null}
      {status.mode === 'error' ? <ErrorStateCard title="Reset failed" body={status.message} /> : null}

      {status.mode === 'ready' || status.mode === 'submitting' ? (
        <SectionCard title="New password" description={status.message}>
          <View style={{ gap: 12 }}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="New password"
              placeholderTextColor={theme.muted}
              secureTextEntry
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: theme.background,
                color: theme.foreground,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16
              }}
            />
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor={theme.muted}
              secureTextEntry
              style={{
                borderRadius: 16,
                borderWidth: 1,
                borderColor: theme.stroke,
                backgroundColor: theme.background,
                color: theme.foreground,
                paddingHorizontal: 16,
                paddingVertical: 14,
                fontSize: 16
              }}
            />
            <Pressable
              onPress={() => void handleSubmit()}
              disabled={status.mode === 'submitting'}
              style={{
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 999,
                backgroundColor: theme.accent,
                paddingHorizontal: 18,
                paddingVertical: 14
              }}
            >
              {status.mode === 'submitting' ? (
                <ActivityIndicator color={mobileColorTokens.background} />
              ) : (
                <Text style={{ color: mobileColorTokens.background, fontSize: 15, fontWeight: '700' }}>Save password</Text>
              )}
            </Pressable>
          </View>
        </SectionCard>
      ) : null}
    </AppScreen>
  );
}
