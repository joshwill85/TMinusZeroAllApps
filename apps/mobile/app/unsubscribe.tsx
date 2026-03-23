import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { Href } from 'expo-router';
import { AppScreen } from '@/src/components/AppScreen';
import {
  CustomerShellActionButton,
  CustomerShellBadge,
  CustomerShellHero,
  CustomerShellPanel
} from '@/src/components/CustomerShell';
import { getApiBaseUrl } from '@/src/config/api';

type UnsubscribeStatus = 'confirm' | 'missing' | 'invalid' | 'unsubscribed' | 'failed' | 'not-configured' | 'submitting';

function getSingleParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function resolveInitialStatus(token: string, rawStatus: string): Exclude<UnsubscribeStatus, 'submitting'> {
  if (!token) return 'missing';
  if (!isUuid(token)) return 'invalid';
  if (rawStatus === 'unsubscribed') return 'unsubscribed';
  if (rawStatus === 'failed') return 'failed';
  if (rawStatus === 'invalid') return 'invalid';
  return 'confirm';
}

export default function UnsubscribeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string | string[]; status?: string | string[] }>();
  const token = getSingleParam(params.token).trim();
  const requestedStatus = getSingleParam(params.status).trim().toLowerCase();
  const initialStatus = useMemo(() => resolveInitialStatus(token, requestedStatus), [requestedStatus, token]);
  const [status, setStatus] = useState<UnsubscribeStatus>(initialStatus);

  useEffect(() => {
    setStatus(initialStatus);
  }, [initialStatus]);

  const submit = async () => {
    if (!token) {
      setStatus('missing');
      return;
    }
    if (!isUuid(token)) {
      setStatus('invalid');
      return;
    }

    let baseUrl: string;
    try {
      baseUrl = getApiBaseUrl();
    } catch {
      setStatus('not-configured');
      return;
    }

    setStatus('submitting');

    try {
      const response = await fetch(`${baseUrl}/api/unsubscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ token })
      });

      if (response.ok) {
        setStatus('unsubscribed');
        return;
      }

      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 400 || response.status === 404 || payload?.error === 'invalid_token') {
        setStatus('invalid');
        return;
      }
      if (response.status === 503 || payload?.error === 'supabase_not_configured') {
        setStatus('not-configured');
        return;
      }
      setStatus('failed');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <AppScreen testID="unsubscribe-screen">
      <CustomerShellHero
        eyebrow="Email"
        title="Unsubscribe"
        description="This route turns off optional marketing emails. Security notices, billing receipts, and required account messages can still be sent when needed."
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <CustomerShellBadge label="Native route" tone="accent" />
          <CustomerShellBadge label="Email deep link" />
        </View>
      </CustomerShellHero>

      {status === 'confirm' || status === 'submitting' ? (
        <CustomerShellPanel
          title="Confirm unsubscribe"
          description="This only affects optional marketing emails like product updates and occasional offers."
        >
          <View style={{ gap: 12 }}>
            <Text style={{ color: '#94a3b8', fontSize: 14, lineHeight: 21 }}>
              Essential account emails such as password resets, receipts, and security notices will still be sent when needed.
            </Text>
            <CustomerShellActionButton
              testID="unsubscribe-confirm"
              label={status === 'submitting' ? 'Submitting...' : 'Confirm unsubscribe'}
              onPress={() => {
                void submit();
              }}
              disabled={status === 'submitting'}
            />
          </View>
        </CustomerShellPanel>
      ) : null}

      {status === 'unsubscribed' ? (
        <CustomerShellPanel
          title="You are unsubscribed"
          description="Marketing emails are now off. You can opt back in anytime from your account settings."
        />
      ) : null}

      {status === 'missing' ? (
        <CustomerShellPanel title="Missing token" description="The unsubscribe link is missing its token." />
      ) : null}

      {status === 'invalid' ? (
        <CustomerShellPanel title="Invalid link" description="This unsubscribe link is invalid or expired." />
      ) : null}

      {status === 'not-configured' ? (
        <CustomerShellPanel title="Unavailable" description="Unsubscribe is not available right now." />
      ) : null}

      {status === 'failed' ? (
        <CustomerShellPanel title="Try again later" description="Something went wrong while processing the unsubscribe request." />
      ) : null}

      <CustomerShellPanel title="Next steps" description="You can keep browsing or open your account settings.">
        <View style={{ gap: 10 }}>
          <CustomerShellActionButton
            label="Open account"
            variant="secondary"
            onPress={() => {
              router.replace('/profile' as Href);
            }}
          />
          <CustomerShellActionButton
            label="Go to feed"
            variant="secondary"
            onPress={() => {
              router.replace('/feed' as Href);
            }}
          />
        </View>
      </CustomerShellPanel>
    </AppScreen>
  );
}
