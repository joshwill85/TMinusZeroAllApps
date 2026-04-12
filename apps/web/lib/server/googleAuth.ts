import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSupabaseAuthClient } from '@/lib/server/supabaseServer';
import { getGoogleAuthClientId, getGoogleAuthClientSecret, getSiteUrl, isGoogleAuthServerConfigured } from '@/lib/server/env';
import { PremiumOnboardingRouteError, preflightPremiumOnboardingProvider } from '@/lib/server/premiumOnboarding';
import { sanitizeReturnToPath } from '@/lib/billing/shared';

const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_STATE_TTL_MS = 10 * 60 * 1000;

type GoogleAuthPlatform = 'web' | 'ios' | 'android';

type GoogleAuthState = {
  platform: GoogleAuthPlatform;
  returnTo: string;
  intent: 'upgrade' | null;
  onboardingIntentId: string | null;
  claimToken: string | null;
  exp: number;
};

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type GoogleIdTokenPayload = {
  email?: unknown;
  email_verified?: unknown;
};

export class GoogleAuthRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.name = 'GoogleAuthRouteError';
    this.status = status;
    this.code = code;
  }
}

function getGoogleAuthStateSecret() {
  const seed = process.env.GOOGLE_AUTH_STATE_SECRET?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET?.trim();
  if (!seed) {
    throw new GoogleAuthRouteError(500, 'google_auth_not_configured');
  }
  return crypto.createHash('sha256').update(`tmz-google-auth:${seed}`).digest();
}

function encodeState(payload: GoogleAuthState) {
  const json = JSON.stringify(payload);
  const data = Buffer.from(json, 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', getGoogleAuthStateSecret()).update(data).digest('base64url');
  return `${data}.${signature}`;
}

function decodeState(value: string) {
  const [data, signature] = String(value || '').split('.');
  if (!data || !signature) {
    throw new GoogleAuthRouteError(400, 'invalid_google_state');
  }

  const expected = crypto.createHmac('sha256', getGoogleAuthStateSecret()).update(data).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new GoogleAuthRouteError(400, 'invalid_google_state');
  }

  const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as Partial<GoogleAuthState>;
  if (
    (parsed.platform !== 'web' && parsed.platform !== 'ios' && parsed.platform !== 'android') ||
    typeof parsed.returnTo !== 'string' ||
    typeof parsed.exp !== 'number'
  ) {
    throw new GoogleAuthRouteError(400, 'invalid_google_state');
  }
  if (parsed.exp < Date.now()) {
    throw new GoogleAuthRouteError(400, 'expired_google_state');
  }

  return {
    platform: parsed.platform,
    returnTo: parsed.returnTo,
    intent: parsed.intent === 'upgrade' ? 'upgrade' : null,
    onboardingIntentId: typeof parsed.onboardingIntentId === 'string' && parsed.onboardingIntentId.trim() ? parsed.onboardingIntentId.trim() : null,
    claimToken: typeof parsed.claimToken === 'string' && parsed.claimToken.trim() ? parsed.claimToken.trim() : null,
    exp: parsed.exp
  } satisfies GoogleAuthState;
}

function decodeJwtPayload(token: string) {
  const segments = token.split('.');
  if (segments.length < 2) {
    throw new GoogleAuthRouteError(400, 'invalid_google_id_token');
  }

  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8')) as GoogleIdTokenPayload;
  } catch {
    throw new GoogleAuthRouteError(400, 'invalid_google_id_token');
  }
}

function buildBaseCallbackUrl(platform: GoogleAuthPlatform) {
  if (platform === 'web') {
    return `${getSiteUrl()}/auth/callback`;
  }
  return 'tminuszero://auth/callback';
}

function buildAuthRedirectUrl({
  platform,
  returnTo,
  intent,
  accessToken,
  refreshToken,
  error
}: {
  platform: GoogleAuthPlatform;
  returnTo: string;
  intent: 'upgrade' | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  error?: string | null;
}) {
  const url = new URL(buildBaseCallbackUrl(platform));
  url.searchParams.set('provider', 'google');
  url.searchParams.set('return_to', returnTo);
  if (intent) {
    url.searchParams.set('intent', intent);
  }

  if (error) {
    url.searchParams.set('error', 'google_auth_failed');
    url.searchParams.set('error_description', error);
    return url.toString();
  }

  const hash = new URLSearchParams();
  if (accessToken) {
    hash.set('access_token', accessToken);
  }
  if (refreshToken) {
    hash.set('refresh_token', refreshToken);
  }
  url.hash = hash.toString();
  return url.toString();
}

async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string) {
  const clientId = getGoogleAuthClientId();
  const clientSecret = getGoogleAuthClientSecret();

  if (!clientId || !clientSecret) {
    throw new GoogleAuthRouteError(500, 'google_auth_not_configured');
  }

  const body = new URLSearchParams();
  body.set('code', code);
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('redirect_uri', redirectUri);
  body.set('grant_type', 'authorization_code');

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });

  const payload = (await response.json().catch(() => null)) as GoogleTokenResponse | null;
  if (!response.ok) {
    throw new GoogleAuthRouteError(502, 'google_token_exchange_failed', payload?.error_description || payload?.error || 'Google token exchange failed.');
  }

  const idToken = typeof payload?.id_token === 'string' ? payload.id_token.trim() : '';
  if (!idToken) {
    throw new GoogleAuthRouteError(502, 'google_token_exchange_failed', 'Google did not return an ID token.');
  }

  return {
    idToken
  };
}

function readGoogleIdTokenEmail(idToken: string) {
  const payload = decodeJwtPayload(idToken);
  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email) {
    throw new GoogleAuthRouteError(400, 'google_email_missing', 'Google did not return an email address.');
  }
  if (payload.email_verified === false) {
    throw new GoogleAuthRouteError(403, 'google_email_not_verified', 'Use a Google account with a verified email address.');
  }
  return email;
}

function buildGoogleAuthorizeUrl(state: GoogleAuthState) {
  if (!isGoogleAuthServerConfigured()) {
    throw new GoogleAuthRouteError(500, 'google_auth_not_configured');
  }

  const clientId = getGoogleAuthClientId();
  if (!clientId) {
    throw new GoogleAuthRouteError(500, 'google_auth_not_configured');
  }

  const redirectUri = `${getSiteUrl()}/api/auth/google/callback`;
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('prompt', 'select_account');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', encodeState(state));
  return url.toString();
}

export function startGoogleAuthFlow({
  platform,
  returnTo,
  intent,
  onboardingIntentId,
  claimToken
}: {
  platform: GoogleAuthPlatform;
  returnTo?: string | null;
  intent?: string | null;
  onboardingIntentId?: string | null;
  claimToken?: string | null;
}) {
  const state: GoogleAuthState = {
    platform,
    returnTo: sanitizeReturnToPath(returnTo, platform === 'web' ? '/account' : '/profile'),
    intent: intent === 'upgrade' ? 'upgrade' : null,
    onboardingIntentId: typeof onboardingIntentId === 'string' && onboardingIntentId.trim() ? onboardingIntentId.trim() : null,
    claimToken: typeof claimToken === 'string' && claimToken.trim() ? claimToken.trim() : null,
    exp: Date.now() + GOOGLE_AUTH_STATE_TTL_MS
  };

  return buildGoogleAuthorizeUrl(state);
}

export async function handleGoogleAuthCallback(request: Request) {
  const url = new URL(request.url);
  const state = decodeState(url.searchParams.get('state') || '');
  const redirectUri = `${getSiteUrl()}/api/auth/google/callback`;

  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (error) {
    return NextResponse.redirect(buildAuthRedirectUrl({
      platform: state.platform,
      returnTo: state.returnTo,
      intent: state.intent,
      error
    }));
  }

  const code = url.searchParams.get('code') || '';
  if (!code.trim()) {
    return NextResponse.redirect(buildAuthRedirectUrl({
      platform: state.platform,
      returnTo: state.returnTo,
      intent: state.intent,
      error: 'Google did not return an authorization code.'
    }));
  }

  try {
    const exchanged = await exchangeGoogleAuthorizationCode(code, redirectUri);
    const email = readGoogleIdTokenEmail(exchanged.idToken);
    const preflight = await preflightPremiumOnboardingProvider({
      intentId: state.onboardingIntentId,
      claimToken: state.claimToken,
      provider: 'google',
      email
    });

    if (preflight.mode === 'create' && !preflight.createAllowed) {
      throw new PremiumOnboardingRouteError(
        403,
        'premium_onboarding_required',
        'Complete Premium purchase verification before creating a new account.'
      );
    }

    const supabase = createSupabaseAuthClient();
    const { data, error: signInError } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: exchanged.idToken
    });

    if (signInError || !data.session) {
      const lowerMessage = String(signInError?.message || '').toLowerCase();
      if (lowerMessage.includes('premium_onboarding_required')) {
        throw new PremiumOnboardingRouteError(
          403,
          'premium_onboarding_required',
          'Complete Premium purchase verification before creating a new account.'
        );
      }
      throw new GoogleAuthRouteError(502, 'google_supabase_sign_in_failed', signInError?.message || 'Unable to finish Google sign-in.');
    }

    return NextResponse.redirect(buildAuthRedirectUrl({
      platform: state.platform,
      returnTo: state.returnTo,
      intent: state.intent,
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token
    }));
  } catch (callbackError) {
    const message =
      callbackError instanceof PremiumOnboardingRouteError || callbackError instanceof GoogleAuthRouteError
        ? callbackError.message
        : callbackError instanceof Error
          ? callbackError.message
          : 'Unable to finish Google sign-in.';

    return NextResponse.redirect(buildAuthRedirectUrl({
      platform: state.platform,
      returnTo: state.returnTo,
      intent: state.intent,
      error: message
    }));
  }
}
