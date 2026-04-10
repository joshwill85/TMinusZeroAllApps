import { useMemo, useState } from 'react';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { requestPasswordReset } from '@/src/auth/supabaseAuth';
import { Card, ScreenShell } from '@/src/components/ScreenShell';
import { getPublicSiteUrl } from '@/src/config/api';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const resetUrl = useMemo(() => {
    const url = new URL('/auth/reset-password', getPublicSiteUrl());
    url.searchParams.set('recovery', '1');
    return url.toString();
  }, []);

  async function handleRequestReset() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setStatus({ tone: 'error', text: 'Email is required.' });
      return;
    }

    setIsSubmitting(true);
    try {
      await requestPasswordReset(normalizedEmail, resetUrl);
      setStatus({
        tone: 'success',
        text: `Password reset email sent to ${normalizedEmail}. Open the reset link on this device to finish recovery.`
      });
    } catch (error) {
      setStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to send reset email.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScreenShell
      eyebrow="Account"
      title="Reset password"
      subtitle="Send a recovery email to this account, then open the reset link on this device to finish the password change."
    >
      <Card title="Recovery email">
        <View style={styles.stack}>
          <TextInput
            testID="forgot-password-email"
            value={email}
            onChangeText={setEmail}
            placeholder="Email"
            placeholderTextColor={mobileColorTokens.muted}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <Pressable testID="forgot-password-submit" style={styles.button} onPress={() => void handleRequestReset()} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Send reset email</Text>}
          </Pressable>
        </View>
      </Card>

      {status.tone ? (
        <Card title={status.tone === 'error' ? 'Recovery error' : 'Recovery status'}>
          <Text style={[styles.body, status.tone === 'error' ? styles.errorText : styles.successText]}>{status.text}</Text>
        </Card>
      ) : null}

      <Link href="/sign-in" asChild>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonLabel}>Back to sign in</Text>
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
  errorText: {
    color: '#ff9087'
  },
  successText: {
    color: '#8de2b0'
  }
});
