import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function safeRedirect(url: URL, origin: string) {
  const response = NextResponse.redirect(url, 302);
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  response.headers.set('Access-Control-Allow-Origin', origin);
  return response;
}

function safeErrorRedirect(origin: string, code: string) {
  const url = new URL('/auth/sign-in', origin);
  url.searchParams.set('error', code);
  return safeRedirect(url, origin);
}

function getSupabaseHost(): string | null {
  const raw = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw).host;
  } catch {
    return null;
  }
}

function isAllowedSupabaseVerifyUrl(url: URL, supabaseHost: string) {
  if (url.protocol !== 'https:') return false;
  if (url.host !== supabaseHost) return false;
  return url.pathname === '/auth/v1/verify';
}

function isAllowedFinalRedirect(url: URL, origin: string) {
  const host = url.host.toLowerCase();
  if (host === 'www.tminuszero.app') return true;
  if (host === 'tminuszero.app') return true;
  if (url.origin === origin) return true;
  return false;
}

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const search = new URL(request.url).searchParams;
  const confirmationUrlParam = (search.get('confirmation_url') || '').trim();
  if (!confirmationUrlParam) return safeErrorRedirect(origin, 'missing_confirmation_url');

  const supabaseHost = getSupabaseHost();
  if (!supabaseHost) return safeErrorRedirect(origin, 'supabase_not_configured');

  let confirmationUrl: URL;
  try {
    confirmationUrl = new URL(confirmationUrlParam);
  } catch {
    return safeErrorRedirect(origin, 'invalid_confirmation_url');
  }

  if (!isAllowedSupabaseVerifyUrl(confirmationUrl, supabaseHost)) {
    return safeErrorRedirect(origin, 'invalid_confirmation_url');
  }

  const tokenHash = (confirmationUrl.searchParams.get('token_hash') || confirmationUrl.searchParams.get('token') || '').trim();
  const type = (confirmationUrl.searchParams.get('type') || '').trim();
  if (!tokenHash || !type) return safeErrorRedirect(origin, 'invalid_confirmation_url');

  const redirectToParam = (confirmationUrl.searchParams.get('redirect_to') || '').trim();
  let redirectTo: URL;
  try {
    redirectTo = redirectToParam ? new URL(redirectToParam, origin) : new URL('/auth/callback', origin);
  } catch {
    return safeErrorRedirect(origin, 'invalid_confirmation_redirect');
  }
  if (!isAllowedFinalRedirect(redirectTo, origin)) return safeErrorRedirect(origin, 'invalid_confirmation_redirect');

  try {
    redirectTo.searchParams.set('token_hash', tokenHash);
    redirectTo.searchParams.set('type', type);
    return safeRedirect(redirectTo, origin);
  } catch {
    return safeErrorRedirect(origin, 'confirmation_failed');
  }
}
