import { NextResponse } from 'next/server';
import { clientBootstrapRequestSchemaV1, clientBootstrapResponseSchemaV1 } from '@tminuszero/contracts';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { getAntiIngestionTokenSecret } from '@/lib/server/env';
import { issueAppGuestToken } from '@/lib/security/firstPartyAccess';

export const dynamic = 'force-dynamic';

function looksLikeNativeBootstrapRequest(request: Request) {
  const userAgent = request.headers.get('user-agent') || '';
  if (!userAgent) return false;
  if (request.headers.get('sec-fetch-site') || request.headers.get('sec-fetch-mode')) {
    return false;
  }

  return /okhttp|cfnetwork|darwin|expo|tminuszero/i.test(userAgent);
}

export async function POST(request: Request) {
  if (!looksLikeNativeBootstrapRequest(request)) {
    return NextResponse.json({ error: 'native_client_required' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const parsed = clientBootstrapRequestSchemaV1.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const rateLimited = await enforceDurableRateLimit(request, {
    scope: 'client_bootstrap',
    limit: 40,
    windowSeconds: 60,
    tokenKey: parsed.data.installationId
  });
  if (rateLimited) {
    return rateLimited;
  }

  const secret = getAntiIngestionTokenSecret();
  if (!secret) {
    return NextResponse.json({ error: 'token_secret_missing' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const guestToken = await issueAppGuestToken(secret, {
    installationId: parsed.data.installationId,
    platform: parsed.data.platform,
    appVersion: parsed.data.appVersion ?? null,
    buildProfile: parsed.data.buildProfile ?? null
  });

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const payload = clientBootstrapResponseSchemaV1.parse({
    guestToken,
    expiresAt,
    tokenType: 'app_guest'
  });

  return NextResponse.json(payload, {
    headers: {
      'Cache-Control': 'private, no-store'
    }
  });
}
