import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { assertPasswordPolicy, PASSWORD_POLICY_HINT } from '@tminuszero/domain';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { recordMobileAuthContext } from '@/src/auth/authContext';
import {
  continueWithOAuthProvider,
  getAvailableOAuthProviders,
  resendSignupVerification,
  signUpWithPassword
} from '@/src/auth/supabaseAuth';
import { Card, MetaRow, ScreenShell } from '@/src/components/ScreenShell';
import { getPublicSiteUrl } from '@/src/config/api';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

export default function SignUpScreen() {
  const { persistSession } = useMobileBootstrap();
  const oauthProviders = getAvailableOAuthProviders();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const callbackUrl = useMemo(() => `${getPublicSiteUrl()}/auth/callback`, []);

  async function handleSignUp() {
    const normalizedEmail = email.trim();
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
      const result = await signUpWithPassword(normalizedEmail, password, callbackUrl);
      if (result.session) {
        await persistSession({
          accessToken: result.session.accessToken,
          refreshToken: result.session.refreshToken
        });
        await recordMobileAuthContext(result.session.accessToken, {
          provider: 'email_password',
          eventType: 'sign_up'
        }).catch(() => {});
        setStatus({
          tone: 'success',
          text: result.user.email ? `Account created and signed in as ${result.user.email}.` : 'Account created.'
        });
        setPassword('');
        setConfirmPassword('');
        return;
      }

      setVerificationEmail(result.user.email ?? normalizedEmail);
      setPassword('');
      setConfirmPassword('');
      setStatus({
        tone: 'success',
        text: 'Account created. Check your email and open the verification link on this device to finish sign-in.'
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to create your account.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendVerification() {
    if (!verificationEmail) return;
    setIsSubmitting(true);
    try {
      await resendSignupVerification(verificationEmail, callbackUrl);
      setStatus({
        tone: 'success',
        text: `Verification email resent to ${verificationEmail}.`
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to resend verification email.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleOAuthSignup(provider: 'apple' | 'google') {
    if (!acceptedTerms) {
      setStatus({ tone: 'error', text: 'You must accept the Terms and Privacy Policy to continue with provider sign-in.' });
      return;
    }

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
      setStatus({
        tone: 'success',
        text: result.session.email ? `Signed in as ${result.session.email}.` : `Signed in with ${formatProviderLabel(provider)}.`
      });
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
      title="Create account"
      subtitle="Free accounts unlock signed-in filters, the calendar tab, one-off calendar adds, faster refreshes, and basic mobile push alerts. Premium stays optional."
    >
      <Card title="What you unlock">
        <MetaRow label="Anon" value="Public browsing" />
        <MetaRow label="Free" value="Filters, calendar, one-off adds, and faster refreshes" />
        <MetaRow label="Premium" value="Saved items, follows, live tools, and advanced alerts" />
      </Card>

      <Card title="Account setup">
        <View style={styles.stack}>
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
            <Pressable
              onPress={() => {
                void Linking.openURL(`${getPublicSiteUrl()}/legal/terms`);
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>Terms</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                void Linking.openURL(`${getPublicSiteUrl()}/legal/privacy`);
              }}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryButtonLabel}>Privacy</Text>
            </Pressable>
          </View>

          {oauthProviders.length > 0 ? (
            <>
              <Text style={styles.body}>Continue with the provider supported on this device, or finish the email form below.</Text>
              {oauthProviders.map((provider) => (
                <Pressable
                  key={provider}
                  testID={`sign-up-oauth-${provider}`}
                  onPress={() => void handleOAuthSignup(provider)}
                  style={styles.secondaryButton}
                  disabled={isSubmitting}
                >
                  <Text style={styles.secondaryButtonLabel}>Continue with {formatProviderLabel(provider)}</Text>
                </Pressable>
              ))}
              <Text style={styles.divider}>or create an email account</Text>
            </>
          ) : null}

          <Pressable testID="sign-up-submit" style={styles.button} onPress={() => void handleSignUp()} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Create account</Text>}
          </Pressable>

          {verificationEmail ? (
            <Pressable style={styles.secondaryButton} onPress={() => void handleResendVerification()} disabled={isSubmitting}>
              <Text style={styles.secondaryButtonLabel}>Resend verification email</Text>
            </Pressable>
          ) : null}
        </View>
      </Card>

      {status.tone ? (
        <Card title={status.tone === 'error' ? 'Sign-up error' : 'Sign-up status'}>
          <Text style={[styles.body, status.tone === 'error' ? styles.errorText : styles.successText]}>{status.text}</Text>
        </Card>
      ) : null}

      <Link href="/sign-in" asChild>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonLabel}>Already have an account?</Text>
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

function formatProviderLabel(provider: 'apple' | 'google') {
  return provider === 'apple' ? 'Apple' : 'Google';
}
