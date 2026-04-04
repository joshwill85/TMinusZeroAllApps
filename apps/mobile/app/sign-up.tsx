import { useMemo, useState } from 'react';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiClientError } from '@tminuszero/api-client';
import { assertPasswordPolicy, PASSWORD_POLICY_HINT } from '@tminuszero/domain';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { buildMobileRoute, resolveMobileAuthRedirectPath } from '@tminuszero/navigation';
import { recordMobileAuthContext } from '@/src/auth/authContext';
import { createPremiumAccountFromClaim } from '@/src/auth/supabaseAuth';
import { Card, ScreenShell } from '@/src/components/ScreenShell';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default function SignUpScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    return_to?: string | string[];
    claim_token?: string | string[];
  }>();
  const { persistSession } = useMobileBootstrap();
  const claimToken = readParam(params.claim_token);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [status, setStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const redirectHref = useMemo(
    () =>
      resolveMobileAuthRedirectPath({
        returnTo: readParam(params.return_to),
        intent: 'upgrade',
        fallback: buildMobileRoute('profile')
      }),
    [params.return_to]
  );

  async function handleSignUp() {
    const normalizedEmail = email.trim();
    if (!claimToken) {
      setStatus({ tone: 'error', text: 'Premium purchase verification is required before creating an account.' });
      return;
    }
    if (!normalizedEmail) {
      setStatus({ tone: 'error', text: 'Email is required.' });
      return;
    }
    try {
      assertPasswordPolicy(password);
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Password does not meet the current policy.'
      });
      return;
    }
    if (password !== confirmPassword) {
      setStatus({ tone: 'error', text: 'Passwords do not match.' });
      return;
    }
    if (!acceptedTerms) {
      setStatus({ tone: 'error', text: 'You must accept the Terms and Privacy Policy to create an account.' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await createPremiumAccountFromClaim(claimToken, normalizedEmail, password);
      await persistSession({
        accessToken: result.session.accessToken,
        refreshToken: result.session.refreshToken
      });
      await recordMobileAuthContext(result.session.accessToken, {
        provider: 'email_password',
        eventType: 'sign_up'
      }).catch(() => {});
      setPassword('');
      setConfirmPassword('');
      router.replace(
        resolveMobileAuthRedirectPath({
          returnTo: result.returnTo,
          intent: 'upgrade',
          fallback: redirectHref
        }) as Href
      );
    } catch (error) {
      setStatus({
        tone: 'error',
        text: getClaimSignUpMessage(error)
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      eyebrow="Account"
      title="Create account"
      subtitle={
        claimToken
          ? 'Create an account from a verified Premium purchase.'
          : 'Account creation now requires a verified Premium purchase. Buy Premium first, then create or link an account.'
      }
    >
      {!claimToken ? (
        <Card title="Premium required">
          <View style={styles.stack}>
            <Text style={styles.body}>
              New accounts are created only after Premium purchase verification. Existing accounts can still sign in for account ownership, recovery, and purchase restore.
            </Text>
            <Pressable style={styles.button} onPress={() => router.push('/profile')}>
              <Text style={styles.buttonLabel}>Open account</Text>
            </Pressable>
            <Link href="/sign-in" asChild>
              <Pressable style={styles.secondaryButton}>
                <Text style={styles.secondaryButtonLabel}>Sign in to existing account</Text>
              </Pressable>
            </Link>
          </View>
        </Card>
      ) : null}

      {claimToken ? (
        <Card title="Set up account">
          <View style={styles.stack}>
            <Text style={styles.body}>This account will be created from a verified Premium purchase and signed in on this device immediately.</Text>
            <TextInput
              testID="sign-up-email"
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={mobileColorTokens.muted}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Text style={styles.policy}>{PASSWORD_POLICY_HINT}</Text>
            <TextInput
              testID="sign-up-password"
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={mobileColorTokens.muted}
              style={styles.input}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              testID="sign-up-confirm-password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm password"
              placeholderTextColor={mobileColorTokens.muted}
              style={styles.input}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Pressable
              testID="sign-up-accept-terms"
              onPress={() => setAcceptedTerms((current) => !current)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: 10,
                opacity: pressed ? 0.86 : 1
              })}
            >
              <View style={[styles.checkbox, acceptedTerms ? styles.checkboxChecked : null]}>
                {acceptedTerms ? <Text style={styles.checkboxMark}>✓</Text> : null}
              </View>
              <Text style={styles.body}>I agree to the Terms and Privacy Policy.</Text>
            </Pressable>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Link href={'/legal/terms' as Href} asChild>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Terms</Text>
                </Pressable>
              </Link>
              <Link href={'/legal/privacy' as Href} asChild>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Privacy</Text>
                </Pressable>
              </Link>
            </View>

            <Pressable testID="sign-up-submit" style={styles.button} onPress={() => void handleSignUp()} disabled={isSubmitting}>
              {isSubmitting ? (
                <ActivityIndicator color={mobileColorTokens.background} />
              ) : (
                <Text style={styles.buttonLabel}>Create account to claim Premium</Text>
              )}
            </Pressable>
          </View>
        </Card>
      ) : null}

      {status.tone ? (
        <Card title={status.tone === 'error' ? 'Account setup error' : 'Account setup status'}>
          <Text style={[styles.body, status.tone === 'error' ? styles.errorText : styles.successText]}>{status.text}</Text>
        </Card>
      ) : null}

      <Link href={claimToken ? `/sign-in?claim_token=${encodeURIComponent(claimToken)}&return_to=${encodeURIComponent(readParam(params.return_to) || '/profile')}` : '/sign-in'} asChild>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonLabel}>Already have an account? Sign in</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: 'rgba(255,255,255,0.03)'
  },
  buttonLabel: {
    color: mobileColorTokens.background,
    fontSize: 15,
    fontWeight: '700'
  },
  secondaryButtonLabel: {
    color: mobileColorTokens.foreground,
    fontSize: 15,
    fontWeight: '700'
  },
  body: {
    color: mobileColorTokens.muted,
    fontSize: 14,
    lineHeight: 21
  },
  policy: {
    color: mobileColorTokens.muted,
    fontSize: 13,
    lineHeight: 19
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1
  },
  checkboxChecked: {
    backgroundColor: mobileColorTokens.accent,
    borderColor: mobileColorTokens.accent
  },
  checkboxMark: {
    color: mobileColorTokens.background,
    fontSize: 12,
    fontWeight: '700'
  },
  errorText: {
    color: '#ff9087'
  },
  successText: {
    color: '#8de2b0'
  }
});

function getClaimSignUpMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.code === 'account_exists') {
      return 'An account with this email already exists. Sign in to claim Premium instead.';
    }
    if (error.code === 'claim_pending') {
      return 'Your Premium purchase is still being verified. Return to account and try again in a moment.';
    }
    if (error.code === 'claim_email_mismatch') {
      return 'Use the same email address that was attached to this Premium purchase.';
    }
    if (error.code === 'claim_already_claimed') {
      return 'This Premium purchase is already linked to an account. Sign in to manage it.';
    }
  }

  return error instanceof Error ? error.message : 'Unable to create your account.';
}
