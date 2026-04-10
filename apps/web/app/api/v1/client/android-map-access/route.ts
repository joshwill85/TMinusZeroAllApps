import { NextResponse } from 'next/server';
import {
  androidGoogleMapsAccessRequestSchemaV1,
  androidGoogleMapsAccessResponseSchemaV1
} from '@tminuszero/contracts';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { getAntiIngestionTokenSecret } from '@/lib/server/env';
import { consumeGoogleMapsBudget, readGoogleMapsBudgetSnapshot } from '@/lib/server/mapBudget';
import {
  APP_CLIENT_HEADER_NAME,
  APP_GUEST_TOKEN_HEADER_NAME,
  parseAppClientContext,
  verifyAppGuestToken
} from '@/lib/security/firstPartyAccess';

export const dynamic = 'force-dynamic';

const ACCESS_CACHE_TTL_MS = 15 * 60 * 1000;

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const parsed = androidGoogleMapsAccessRequestSchemaV1.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return jsonError('invalid_body', 400);
  }

  const clientContext = parseAppClientContext(request.headers.get(APP_CLIENT_HEADER_NAME));
  if (!clientContext || clientContext.platform !== 'android') {
    return jsonError('android_native_client_required', 403);
  }

  const secret = getAntiIngestionTokenSecret();
  if (!secret) {
    return jsonError('token_secret_missing', 503);
  }

  const guestToken = request.headers.get(APP_GUEST_TOKEN_HEADER_NAME);
  const verifiedGuest = await verifyAppGuestToken(guestToken, secret, clientContext);
  if (!verifiedGuest) {
    return jsonError('invalid_guest_token', 401);
  }

  const rateLimited = await enforceDurableRateLimit(request, {
    scope: 'client_android_map_access',
    limit: 6,
    windowSeconds: 60,
    tokenKey: `${clientContext.installationId}:${parsed.data.surface}:${parsed.data.launchId || 'none'}`
  });
  if (rateLimited) {
    return rateLimited;
  }

  const currentBudget = await readGoogleMapsBudgetSnapshot('google_android_maps');
  if (!currentBudget.enabled) {
    const payload = androidGoogleMapsAccessResponseSchemaV1.parse({
      ...currentBudget,
      surface: parsed.data.surface
    });
    return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
  }

  // Inline previews only need a policy check. The explicit fullscreen path is the budgeted Android map open.
  const shouldConsumeBudget = parsed.data.surface === 'faa_fullscreen';
  const consumed = shouldConsumeBudget ? await consumeGoogleMapsBudget('google_android_maps') : true;
  const checkedAt = new Date();
  const expiresAt = new Date(checkedAt.getTime() + ACCESS_CACHE_TTL_MS);
  const payload = androidGoogleMapsAccessResponseSchemaV1.parse({
    enabled: consumed,
    reason: consumed ? null : 'Google Maps budget exhausted for Android launch maps.',
    checkedAt: checkedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    dailyLimit: currentBudget.dailyLimit,
    monthlyLimit: currentBudget.monthlyLimit,
    surface: parsed.data.surface
  });

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'private, no-store' } });
}
