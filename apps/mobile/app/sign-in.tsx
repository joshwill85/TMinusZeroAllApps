import { useEffect, useMemo, useState } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import * as AppleAuthentication from 'expo-apple-authentication';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { buildMobileRoute, readAuthIntent, readReturnTo, resolveMobileAuthRedirectPath } from '@tminuszero/navigation';
import { isNativeAppleSignInAvailable } from '@/src/auth/appleAuth';
import { recordMobileAuthContext } from '@/src/auth/authContext';
import {
  attachPremiumClaimToSession,
  continueWithOAuthProvider,
  createOrResumePremiumOnboardingIntent,
  getAvailableOAuthProviders,
  isSupabaseMobileAuthConfigured,
  signInWithPassword,
  signOut
} from '@/src/auth/supabaseAuth';
import { Card, ScreenShell } from '@/src/components/ScreenShell';
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
    claim_token?: string | string[];
  }>();
  const { accessToken, persistSession, clearSession } = useMobileBootstrap();
  const { unregisterCurrentDevice } = useMobilePush();
  const claimToken = readParam(params.claim_token);
  const authIntent = useMemo(() => {
    const queryReader = {
      get(key: string) {
        if (key === 'intent') return readParam(params.intent);
        return null;
      }
    };
    return readAuthIntent(queryReader);
  }, [params.intent]);
  const [appleSignInAvailable, setAppleSignInAvailable] = useState(false);
  const [googleSignInAvailable, setGoogleSignInAvailable] = useState(false);
  const [premiumOnboardingIntentId, setPremiumOnboardingIntentId] = useState<string | null>(null);
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

  useEffect(() => {
    if (claimToken || authIntent !== 'upgrade') {
      setPremiumOnboardingIntentId(null);
      return;
    }

    let cancelled = false;
    void createOrResumePremiumOnboardingIntent({
      returnTo: redirectHref
    })
      .then((payload) => {
        if (!cancelled) {
          setPremiumOnboardingIntentId(payload.intent.intentId);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPremiumOnboardingIntentId(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authIntent, claimToken, redirectHref]);

  useEffect(() => {
    let cancelled = false;
    const oauthProviders = getAvailableOAuthProviders();
    setGoogleSignInAvailable(oauthProviders.includes('google'));

    void isNativeAppleSignInAvailable()
      .then((available) => {
        if (!cancelled) {
          setAppleSignInAvailable(available);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppleSignInAvailable(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSignIn() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password) {
      setStatus({ tone: 'error', text: 'Email and password are required.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await signInWithPassword(normalizedEmail, password);
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await recordMobileAuthContext(result.session.accessToken, {
        provider: 'email_password',
        eventType: 'sign_in',
        riskSessionId: result.riskSessionId
      }).catch(() => {});
      setPassword('');
      if (claimToken) {
        const attachResult = await attachPremiumClaimToSession(result.session.accessToken, claimToken);
        router.replace(
          resolveMobileAuthRedirectPath({
            returnTo: attachResult.returnTo,
            intent: 'upgrade',
            fallback: redirectHref
          }) as Href
        );
        return;
      }
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

  async function handleAppleSignIn() {
    if (isSubmitting) {
      return;
    }

    if (!appleSignInAvailable) {
      setStatus({ tone: 'error', text: 'Sign in with Apple is not available in this build.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await continueWithOAuthProvider('apple', {
        intent: authIntent,
        returnTo: redirectHref,
        onboardingIntentId: premiumOnboardingIntentId
      });
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await recordMobileAuthContext(result.session.accessToken, {
        provider: result.provider,
        eventType: 'sign_in',
        displayName: result.displayName ?? null,
        emailIsPrivateRelay: result.emailIsPrivateRelay === true
      }).catch(() => {});
      if (claimToken) {
        const attachResult = await attachPremiumClaimToSession(result.session.accessToken, claimToken);
        router.replace(
          resolveMobileAuthRedirectPath({
            returnTo: attachResult.returnTo,
            intent: 'upgrade',
            fallback: redirectHref
          }) as Href
        );
        return;
      }
      router.replace(redirectHref as Href);
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to sign in with Apple.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (isSubmitting) {
      return;
    }

    if (!googleSignInAvailable) {
      setStatus({ tone: 'error', text: 'Google sign-in is not available in this build.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await continueWithOAuthProvider('google', {
        intent: authIntent,
        returnTo: redirectHref,
        onboardingIntentId: premiumOnboardingIntentId
      });
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await recordMobileAuthContext(result.session.accessToken, {
        provider: result.provider,
        eventType: 'sign_in',
        displayName: result.displayName ?? null,
        emailIsPrivateRelay: result.emailIsPrivateRelay === true
      }).catch(() => {});
      if (claimToken) {
        const attachResult = await attachPremiumClaimToSession(result.session.accessToken, claimToken);
        router.replace(
          resolveMobileAuthRedirectPath({
            returnTo: attachResult.returnTo,
            intent: 'upgrade',
            fallback: redirectHref
          }) as Href
        );
        return;
      }
      router.replace(redirectHref as Href);
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to sign in with Google.'
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

  async function handleAttachPremium() {
    if (!accessToken || !claimToken) {
      return;
    }

    setIsSubmitting(true);
    try {
      const attachResult = await attachPremiumClaimToSession(accessToken, claimToken);
      setStatus({
        tone: 'success',
        text: 'Premium attached to this account.'
      });
      router.replace(
        resolveMobileAuthRedirectPath({
          returnTo: attachResult.returnTo,
          intent: 'upgrade',
          fallback: redirectHref
        }) as Href
      );
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to attach Premium.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      eyebrow="Account"
      title="Sign in"
      subtitle={
        claimToken
          ? 'Sign in to attach this verified Premium purchase to an existing account.'
          : authIntent === 'upgrade'
            ? 'Sign in to an existing account or create a new one for Premium onboarding on this device.'
            : 'Use your T-Minus Zero account for account management, purchase restore, and Premium ownership on this device.'
      }
    >
      {isSupabaseMobileAuthConfigured() ? (
        <Card title={accessToken ? 'Session actions' : 'Sign-in methods'}>
          {accessToken ? (
            <View style={styles.stack}>
              <Text style={styles.body}>
                {claimToken ? 'This device already has a stored bearer token. Attach the verified Premium purchase or sign out first.' : 'This device already has a stored bearer token.'}
              </Text>
              {claimToken ? (
                <Pressable testID="sign-in-attach-claim" style={styles.button} onPress={() => void handleAttachPremium()} disabled={isSubmitting}>
                  {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Attach Premium</Text>}
                </Pressable>
              ) : null}
              <Pressable testID="sign-out-submit" style={styles.button} onPress={() => void handleSignOut()} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Sign out</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.stack}>
              {googleSignInAvailable ? (
                <Pressable testID="sign-in-google" style={styles.oauthButton} onPress={() => void handleGoogleSignIn()} disabled={isSubmitting}>
                  {isSubmitting ? (
                    <ActivityIndicator color="#05060A" />
                  ) : (
                    <Text style={styles.oauthButtonLabel}>Continue with Google</Text>
                  )}
                </Pressable>
              ) : null}
              {appleSignInAvailable ? (
                <>
                  {isSubmitting ? (
                    <View style={styles.appleButtonLoading}>
                      <ActivityIndicator color="#05060A" />
                    </View>
                  ) : (
                    <AppleAuthentication.AppleAuthenticationButton
                      testID="sign-in-apple"
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                      cornerRadius={24}
                      style={styles.appleButton}
                      onPress={() => void handleAppleSignIn()}
                    />
                  )}
                  <Text style={styles.helperText}>
                    Existing account with a different email or Apple private relay? Sign in first, then link Apple in Login Methods.
                  </Text>
                </>
              ) : null}
              {googleSignInAvailable || appleSignInAvailable ? <Text style={styles.oauthDivider}>or continue with email</Text> : null}
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
              <Link href="/forgot-password" asChild>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Forgot password</Text>
                </Pressable>
              </Link>
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

      {claimToken ? (
        <Link href={`/sign-up?claim_token=${encodeURIComponent(claimToken)}&return_to=${encodeURIComponent(readParam(params.return_to) || '/profile')}`} asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Need a new account? Create one to claim Premium</Text>
          </Pressable>
        </Link>
      ) : authIntent === 'upgrade' ? (
        <Link href={`/sign-up?intent=upgrade&return_to=${encodeURIComponent(readParam(params.return_to) || redirectHref)}`} asChild>
          <Pressable style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonLabel}>Need a new account? Create one for Premium</Text>
          </Pressable>
        </Link>
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
  appleButton: {
    width: '100%',
    height: 50
  },
  oauthButton: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: '#f5f5f7'
  },
  oauthButtonLabel: {
    color: '#05060A',
    fontSize: 15,
    fontWeight: '700'
  },
  appleButtonLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    width: '100%',
    height: 50,
    backgroundColor: '#f5f5f7'
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
  oauthDivider: {
    color: mobileColorTokens.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center'
  },
  helperText: {
    color: mobileColorTokens.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center'
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
