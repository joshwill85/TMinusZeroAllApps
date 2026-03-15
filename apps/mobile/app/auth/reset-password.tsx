import { useEffect, useRef, useState } from 'react';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { assertPasswordPolicy, PASSWORD_POLICY_HINT } from '@tminuszero/domain';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { recordMobileAuthContext } from '@/src/auth/authContext';
import { signOut, updatePassword, verifyOtpTokenHash } from '@/src/auth/supabaseAuth';
import { AppScreen } from '@/src/components/AppScreen';
import { ErrorStateCard, LoadingStateCard, SectionCard } from '@/src/components/SectionCard';
import { ScreenHeader } from '@/src/components/ScreenHeader';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? '';
  }
  return value ?? '';
}

export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{
    token_hash?: string | string[];
    type?: string | string[];
    error_description?: string | string[];
  }>();
  const { accessToken, clearSession, persistSession, theme } = useMobileBootstrap();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState<{
    mode: 'verifying' | 'ready' | 'submitting' | 'success' | 'error';
    message: string;
  }>({
    mode: 'verifying',
    message: 'Verifying reset token.'
  });
  const resolvedAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const errorDescription = readParam(params.error_description).trim();
    const tokenHash = readParam(params.token_hash).trim();
    const type = readParam(params.type).trim();
    const attemptKey = errorDescription ? `error:${errorDescription}` : `${type}:${tokenHash}`;
    if (!attemptKey) {
      return;
    }
    if (resolvedAttemptRef.current === attemptKey) {
      return;
    }
    resolvedAttemptRef.current = attemptKey;

    async function resolveResetSession() {
      if (errorDescription) {
        if (!cancelled) {
          setStatus({
            mode: 'error',
            message: errorDescription
          });
        }
        return;
      }
      if (!tokenHash || !type) {
        if (!cancelled) {
          setStatus({
            mode: 'error',
            message: 'The reset link did not include a valid verification payload. Mobile reset links must use the verified https callback with token_hash.'
          });
        }
        return;
      }

      try {
        if (accessToken) {
          if (!cancelled) {
            setStatus({
              mode: 'verifying',
              message: 'Replacing the current session before verifying the reset link.'
            });
          }
          await signOut(accessToken).catch(() => {});
          await clearSession();
        }
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
  }, [accessToken, clearSession, params.error_description, params.token_hash, params.type, persistSession]);

  async function handleSubmit() {
    if (!accessToken) {
      setStatus({
        mode: 'error',
        message: 'No authenticated reset session is available.'
      });
      return;
    }
    try {
      assertPasswordPolicy(password);
    } catch (error) {
      setStatus({
        mode: 'error',
        message: error instanceof Error ? error.message : 'Password does not meet the current policy.'
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
      await recordMobileAuthContext(accessToken, {
        provider: 'email_password',
        eventType: 'password_reset'
      }).catch(() => {});
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
    <AppScreen testID="auth-reset-screen" keyboardShouldPersistTaps="handled">
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
            <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 19 }}>{PASSWORD_POLICY_HINT}</Text>
            <TextInput
              testID="reset-password-input"
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
              testID="reset-password-confirm"
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
              testID="reset-password-submit"
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
