import { useMemo, useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { buildMobileRoute, readAuthIntent, readReturnTo, resolveMobileAuthRedirectPath } from '@tminuszero/navigation';
import { recordMobileAuthContext } from '@/src/auth/authContext';
import {
  continueWithOAuthProvider,
  getAvailableOAuthProviders,
  isSupabaseMobileAuthConfigured,
  signInWithPassword,
  signOut
} from '@/src/auth/supabaseAuth';
import { Card, MetaRow, ScreenShell } from '@/src/components/ScreenShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';
import { useMobilePush } from '@/src/providers/MobilePushProvider';

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default function SignInScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    return_to?: string | string[];
    next?: string | string[];
    intent?: string | string[];
  }>();
  const { accessToken, isAuthHydrated, persistSession, clearSession } = useMobileBootstrap();
  const { unregisterCurrentDevice } = useMobilePush();
  const oauthProviders = getAvailableOAuthProviders();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
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

  async function handleSignIn() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setStatus({ tone: 'error', text: 'Email and password are required.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const session = await signInWithPassword(normalizedEmail, password);
      await persistSession({
        accessToken: session.accessToken,
        refreshToken: session.refreshToken
      });
      await recordMobileAuthContext(session.accessToken, {
        provider: 'email_password',
        eventType: 'sign_in'
      }).catch(() => {});
      setPassword('');
      router.replace(redirectHref as Href);
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to sign in.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignOut() {
    setIsSubmitting(true);
    try {
      if (accessToken) {
        await recordMobileAuthContext(accessToken, {
          provider: 'unknown',
          eventType: 'sign_out'
        }).catch(() => {});
      }
      await unregisterCurrentDevice().catch(() => {});
      await signOut(accessToken);
      await clearSession();
      setStatus({
        tone: 'success',
        text: 'Signed out on this device.'
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to sign out.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOAuthSignIn(provider: 'apple' | 'google') {
    setIsSubmitting(true);
    try {
      const result = await continueWithOAuthProvider(provider);
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await recordMobileAuthContext(result.session.accessToken, {
        provider: result.provider,
        eventType: 'oauth_callback'
      }).catch(() => {});
      router.replace(redirectHref as Href);
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to continue with provider sign-in.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      eyebrow="Account"
      title="Sign in"
      subtitle="Use your T-Minus Zero account for signed-in filters, calendar access, one-off calendar adds, and shared mobile push alerts on this device."
    >
      <Card title="Account status">
        <MetaRow label="Ready" value={isAuthHydrated ? 'yes' : 'no'} />
        <MetaRow label="Signed in" value={accessToken ? 'yes' : 'no'} />
      </Card>

      {isSupabaseMobileAuthConfigured() ? (
        <Card title={accessToken ? 'Session actions' : 'Sign-in methods'}>
          {accessToken ? (
            <View style={styles.stack}>
              <Text style={styles.body}>This device already has a stored bearer token.</Text>
              <Pressable testID="sign-out-submit" style={styles.button} onPress={() => void handleSignOut()} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Sign out</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.stack}>
              {oauthProviders.length > 0 ? (
                <>
                  <Text style={styles.body}>Use the provider already configured for this device, or continue with email below.</Text>
                  {oauthProviders.map((provider) => (
                    <Pressable
                      key={provider}
                      testID={`sign-in-oauth-${provider}`}
                      style={styles.secondaryButton}
                      onPress={() => void handleOAuthSignIn(provider)}
                      disabled={isSubmitting}
                    >
                      <Text style={styles.secondaryButtonLabel}>Continue with {formatProviderLabel(provider)}</Text>
                    </Pressable>
                  ))}
                  <Text style={styles.divider}>or sign in with email</Text>
                </>
              ) : null}
              <TextInput
                testID="sign-in-email"
                value={email}
                onChangeText={setEmail}
                placeholder="Email"
                placeholderTextColor={mobileColorTokens.muted}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
              />
              <TextInput
                testID="sign-in-password"
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={mobileColorTokens.muted}
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable testID="sign-in-submit" style={styles.button} onPress={() => void handleSignIn()} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Sign in</Text>}
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Link href="/sign-up" asChild>
                  <Pressable style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonLabel}>Create account</Text>
                  </Pressable>
                </Link>
                <Link href="/forgot-password" asChild>
                  <Pressable style={styles.secondaryButton}>
                    <Text style={styles.secondaryButtonLabel}>Forgot password</Text>
                  </Pressable>
                </Link>
              </View>
            </View>
          )}
        </Card>
      ) : (
        <Card title="Sign-in unavailable">
          <Text style={styles.body}>This build is missing the account configuration needed to sign in.</Text>
        </Card>
      )}

      {status.tone ? (
        <Card title={status.tone === 'error' ? 'Auth error' : 'Auth status'}>
          <Text style={[styles.body, status.tone === 'error' ? styles.errorText : styles.successText]}>{status.text}</Text>
        </Card>
      ) : null}

      <Link href={buildMobileRoute('launchFeed') as Href} asChild>
        <Pressable testID="sign-in-return-shell" style={styles.button}>
          <Text style={styles.buttonLabel}>Back to feed</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 12
  },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: 'rgba(255,255,255,0.03)',
    color: mobileColorTokens.foreground,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 12
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: mobileColorTokens.accent
  },
  secondaryButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: 'rgba(255,255,255,0.03)'
  },
  buttonLabel: {
    color: mobileColorTokens.background,
    fontSize: 15,
    fontWeight: '700'
  },
  secondaryButtonLabel: {
    color: mobileColorTokens.foreground,
    fontSize: 14,
    fontWeight: '700'
  },
  divider: {
    color: mobileColorTokens.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    textTransform: 'uppercase'
  },
  body: {
    color: mobileColorTokens.muted,
    fontSize: 14,
    lineHeight: 21
  },
  errorText: {
    color: '#ff9087'
  },
  successText: {
    color: '#8de2b0'
  }
});

function formatProviderLabel(provider: 'apple' | 'google') {
  return provider === 'apple' ? 'Apple' : 'Google';
}
