import { useState } from 'react';
import { Link } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { buildMobileRoute } from '@tminuszero/navigation';
import { signInWithPassword, signOut, isSupabaseMobileAuthConfigured } from '@/src/auth/supabaseAuth';
import { Card, MetaRow, ScreenShell } from '@/src/components/ScreenShell';
import { useMobileBootstrap } from '@/src/providers/AppProviders';
import { getApiBaseUrl, getSupabaseUrl } from '@/src/config/api';

export default function SignInScreen() {
  const { accessToken, isAuthHydrated, persistSession, clearSession } = useMobileBootstrap();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<{ tone: 'error' | 'success' | null; text: string }>({
    tone: null,
    text: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      setPassword('');
      setStatus({
        tone: 'success',
        text: session.email ? `Signed in as ${session.email}.` : 'Signed in.'
      });
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

  return (
    <ScreenShell
      eyebrow="Mobile auth"
      title="Native bearer auth"
      subtitle="This shell now signs in directly against Supabase auth and stores bearer credentials for the shared /api/v1 client."
    >
      <Card title="Current mobile auth state">
        <MetaRow label="Hydrated" value={isAuthHydrated ? 'yes' : 'no'} />
        <MetaRow label="Access token" value={accessToken ? 'present' : 'missing'} />
        <MetaRow label="API base URL" value={getApiBaseUrl()} />
        <MetaRow label="Supabase URL" value={getSupabaseUrl() || 'missing'} />
      </Card>

      {isSupabaseMobileAuthConfigured() ? (
        <Card title={accessToken ? 'Session actions' : 'Email sign-in'}>
          {accessToken ? (
            <View style={styles.stack}>
              <Text style={styles.body}>This device already has a stored bearer token.</Text>
              <Pressable style={styles.button} onPress={() => void handleSignOut()} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Sign out</Text>}
              </Pressable>
            </View>
          ) : (
            <View style={styles.stack}>
              <TextInput
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
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={mobileColorTokens.muted}
                style={styles.input}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable style={styles.button} onPress={() => void handleSignIn()} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color={mobileColorTokens.background} /> : <Text style={styles.buttonLabel}>Sign in</Text>}
              </Pressable>
            </View>
          )}
        </Card>
      ) : (
        <Card title="Auth config missing">
          <Text style={styles.body}>Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` to enable native auth in the mobile app.</Text>
        </Card>
      )}

      {status.tone ? (
        <Card title={status.tone === 'error' ? 'Auth error' : 'Auth status'}>
          <Text style={[styles.body, status.tone === 'error' ? styles.errorText : styles.successText]}>{status.text}</Text>
        </Card>
      ) : null}

      <Card title="Deep-link routes">
        <Text style={styles.body}>`tminuszero://auth/callback`</Text>
        <Text style={styles.body}>`tminuszero://auth/reset-password`</Text>
      </Card>

      <Link href={buildMobileRoute('home')} asChild>
        <Pressable style={styles.button}>
          <Text style={styles.buttonLabel}>Return to shell</Text>
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
  buttonLabel: {
    color: mobileColorTokens.background,
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
