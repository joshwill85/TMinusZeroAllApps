import type { Metadata } from 'next';
import { BRAND_NAME } from '@/lib/brand';
import { MobileAuthChallengeClient } from '@/components/MobileAuthChallengeClient';
import { normalizeEnvText } from '@/lib/env/normalize';
import { buildPageMetadata } from '@/lib/server/seo';

function getCaptchaConfig() {
  const turnstile = normalizeEnvText(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
  );
  if (turnstile) {
    return {
      provider: 'turnstile' as const,
      siteKey: turnstile
    };
  }

  const hcaptcha = normalizeEnvText(process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY);
  if (hcaptcha) {
    return {
      provider: 'hcaptcha' as const,
      siteKey: hcaptcha
    };
  }

  return null;
}

export const dynamic = 'force-dynamic';

export const metadata: Metadata = buildPageMetadata({
  title: `Mobile Auth Verification | ${BRAND_NAME}`,
  description: 'CAPTCHA-protected mobile sign-in verification challenge.',
  canonical: '/mobile-auth/challenge',
  robots: { index: false, follow: false },
  includeSocial: false
});

export default function MobileAuthChallengePage({
  searchParams
}: {
  searchParams?: {
    risk_session?: string;
    mode?: string;
  };
}) {
  const params = searchParams ?? {};
  const riskSessionId =
    typeof params.risk_session === 'string' ? params.risk_session.trim() : '';
  const mode = params.mode === 'visible' ? 'visible' : 'silent';
  const captcha = getCaptchaConfig();

  if (!riskSessionId || !captcha) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-10 text-white">
        <div className="rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl shadow-black/30">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
            Mobile Auth
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Verification unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-300">
            This challenge session is missing required configuration. Return to
            the mobile app and try again.
          </p>
        </div>
      </main>
    );
  }

  return (
    <MobileAuthChallengeClient
      riskSessionId={riskSessionId}
      mode={mode}
      provider={captcha.provider}
      siteKey={captcha.siteKey}
    />
  );
}
