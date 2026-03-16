'use client';

import { useEffect, useMemo, useState } from 'react';
import { CaptchaWidget } from './CaptchaWidget';

type CaptchaProvider = 'turnstile' | 'hcaptcha';

type MobileAuthChallengeClientProps = {
  riskSessionId: string;
  mode: 'silent' | 'visible';
  provider: CaptchaProvider;
  siteKey: string;
};

function buildCallbackUrl(riskSessionId: string, challengeCode: string) {
  const params = new URLSearchParams();
  params.set('risk_session', riskSessionId);
  params.set('challenge_code', challengeCode);
  return `tminuszero://auth/challenge?${params.toString()}`;
}

export function MobileAuthChallengeClient({
  riskSessionId,
  mode,
  provider,
  siteKey
}: MobileAuthChallengeClientProps) {
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  const description = useMemo(() => {
    if (mode === 'silent') {
      return 'Verifying this device before continuing to the mobile app.';
    }
    return 'Complete the short verification step to continue to the mobile app.';
  }, [mode]);

  useEffect(() => {
    if (!captchaToken || isSubmitting) {
      return;
    }

    let cancelled = false;

    async function completeChallenge() {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await fetch('/api/v1/mobile-auth/challenge/complete', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: JSON.stringify({
            riskSessionId,
            captchaToken
          })
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            typeof json?.message === 'string'
              ? json.message
              : typeof json?.error === 'string'
                ? json.error
                : 'Unable to complete the verification step.';
          throw new Error(message);
        }
        const nextRiskSessionId = typeof json?.riskSessionId === 'string' ? json.riskSessionId : '';
        const challengeCode = typeof json?.challengeCode === 'string' ? json.challengeCode : '';
        if (!nextRiskSessionId || !challengeCode) {
          throw new Error('Verification completed, but the challenge payload was invalid.');
        }
        if (cancelled) {
          return;
        }
        window.location.assign(buildCallbackUrl(nextRiskSessionId, challengeCode));
      } catch (nextError) {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : 'Unable to complete the verification step.');
          setCaptchaToken(null);
          setResetKey((value) => value + 1);
        }
      } finally {
        if (!cancelled) {
          setIsSubmitting(false);
        }
      }
    }

    void completeChallenge();
    return () => {
      cancelled = true;
    };
  }, [captchaToken, isSubmitting, riskSessionId]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10 text-white">
      <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">Mobile Auth</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">Confirm it&apos;s really you</h1>
        <p className="mt-3 text-sm leading-6 text-slate-300">{description}</p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-900/70 p-4">
          <CaptchaWidget
            provider={provider}
            siteKey={siteKey}
            onToken={setCaptchaToken}
            resetKey={resetKey}
            mode={provider === 'turnstile' && mode === 'silent' ? 'interaction-only' : 'visible'}
          />
        </div>

        <div className="mt-4 text-sm text-slate-400">
          {isSubmitting ? 'Continuing to the app…' : mode === 'silent' ? 'This should usually finish automatically.' : 'You will return to the app automatically after verification.'}
        </div>

        {error ? <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</div> : null}

        <button
          type="button"
          onClick={() => {
            setError(null);
            setCaptchaToken(null);
            setResetKey((value) => value + 1);
          }}
          className="mt-5 inline-flex w-full items-center justify-center rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
        >
          Retry verification
        </button>
      </div>
    </div>
  );
}
