import { useMemo, useState } from 'react';
import { Link, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { PREMIUM_PRIVACY_LAST_UPDATED_LABEL, PREMIUM_TERMS_LAST_UPDATED_LABEL } from '@tminuszero/domain';
import { resolveMobileAuthRedirectPath, sanitizeReturnTo } from '@tminuszero/navigation';
import { buildMobilePremiumLegalHref, buildMobilePremiumUpgradeAuthHref } from '@/src/auth/premiumOnboarding';
import { recordPremiumOnboardingLegalAcceptance } from '@/src/auth/supabaseAuth';
import { Card, ScreenShell } from '@/src/components/ScreenShell';
import { mobileColorTokens } from '@tminuszero/design-tokens';
import { useMobileBootstrap } from '@/src/providers/mobileBootstrapContext';

function readParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

export default function PremiumOnboardingLegalScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    return_to?: string | string[];
    intent_id?: string | string[];
  }>();
  const { accessToken } = useMobileBootstrap();
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const returnTo = useMemo(() => sanitizeReturnTo(readParam(params.return_to), '/account/membership'), [params.return_to]);
  const intentId = useMemo(() => readParam(params.intent_id), [params.intent_id]);
  const signInHref = useMemo(
    () =>
      buildMobilePremiumUpgradeAuthHref('sign-in', {
        returnTo: buildMobilePremiumLegalHref({
          returnTo,
          intentId
        })
      }),
    [intentId, returnTo]
  );

  async function handleContinue() {
    if (!accepted || submitting || !accessToken) {
      return;
    }

    setSubmitting(true);
    setMessage(null);
    try {
      const payload = await recordPremiumOnboardingLegalAcceptance({
        accessToken,
        intentId,
        returnTo
      });
      router.replace(
        resolveMobileAuthRedirectPath({
          returnTo: payload.returnTo,
          intent: 'upgrade',
          fallback: '/account/membership'
        }) as Href
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to record legal acceptance.');
      setSubmitting(false);
    }
  }

  return (
    <ScreenShell
      eyebrow="Premium"
      title="Review terms before checkout"
      subtitle="Premium checkout starts only after you confirm the current Terms of Service and Privacy Notice for this account."
    >
      {!accessToken ? (
        <Card title="Sign in required">
          <View style={styles.stack}>
            <Text style={styles.body}>Sign in or create your account before reviewing the Premium legal step.</Text>
            <Link href={signInHref as Href} asChild>
              <Pressable style={styles.button}>
                <Text style={styles.buttonLabel}>Sign in to continue</Text>
              </Pressable>
            </Link>
          </View>
        </Card>
      ) : (
        <>
          <Card title="Terms of Service">
            <View style={styles.stack}>
              <Text style={styles.meta}>Last updated: {PREMIUM_TERMS_LAST_UPDATED_LABEL}</Text>
              <Text style={styles.body}>Subscription terms, account obligations, acceptable use, and billing expectations.</Text>
              <Link href={'/legal/terms' as Href} asChild>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Open Terms</Text>
                </Pressable>
              </Link>
            </View>
          </Card>

          <Card title="Privacy Notice">
            <View style={styles.stack}>
              <Text style={styles.meta}>Last updated: {PREMIUM_PRIVACY_LAST_UPDATED_LABEL}</Text>
              <Text style={styles.body}>How account, billing, auth, notification, and support data are collected and used.</Text>
              <Link href={'/legal/privacy' as Href} asChild>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Open Privacy Notice</Text>
                </Pressable>
              </Link>
            </View>
          </Card>

          <Card title="Acceptance">
            <View style={styles.stack}>
              <Pressable
                testID="premium-legal-accept"
                onPress={() => setAccepted((current) => !current)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  gap: 10,
                  opacity: pressed ? 0.86 : 1
                })}
              >
                <View style={[styles.checkbox, accepted ? styles.checkboxChecked : null]}>
                  {accepted ? <Text style={styles.checkboxMark}>✓</Text> : null}
                </View>
                <Text style={styles.body}>
                  I have reviewed and agree to the current Terms of Service and acknowledge the current Privacy Notice for Premium access.
                </Text>
              </Pressable>

              <Pressable testID="premium-legal-continue" style={styles.button} disabled={!accepted || submitting} onPress={() => void handleContinue()}>
                {submitting ? (
                  <ActivityIndicator color={mobileColorTokens.background} />
                ) : (
                  <Text style={styles.buttonLabel}>Continue to Premium</Text>
                )}
              </Pressable>

              <Link href={returnTo as Href} asChild>
                <Pressable style={styles.secondaryButton}>
                  <Text style={styles.secondaryButtonLabel}>Not now</Text>
                </Pressable>
              </Link>
            </View>
          </Card>
        </>
      )}

      {message ? (
        <Card title="Premium onboarding error">
          <Text style={[styles.body, styles.errorText]}>{message}</Text>
        </Card>
      ) : null}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: 12
  },
  body: {
    color: mobileColorTokens.muted,
    fontSize: 14,
    lineHeight: 21
  },
  meta: {
    color: mobileColorTokens.muted,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase'
  },
  button: {
    alignItems: 'center',
    borderRadius: 14,
    backgroundColor: mobileColorTokens.accent,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  buttonLabel: {
    color: mobileColorTokens.background,
    fontSize: 15,
    fontWeight: '700'
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: mobileColorTokens.surface,
    paddingHorizontal: 16,
    paddingVertical: 14
  },
  secondaryButtonLabel: {
    color: mobileColorTokens.foreground,
    fontSize: 15,
    fontWeight: '600'
  },
  checkbox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: mobileColorTokens.stroke,
    backgroundColor: mobileColorTokens.surface
  },
  checkboxChecked: {
    borderColor: mobileColorTokens.accent,
    backgroundColor: mobileColorTokens.accent
  },
  checkboxMark: {
    color: mobileColorTokens.background,
    fontSize: 12,
    fontWeight: '800'
  },
  errorText: {
    color: '#ff9087'
  }
});
