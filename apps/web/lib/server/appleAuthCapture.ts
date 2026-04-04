import { appleAuthCaptureResponseSchemaV1, appleAuthCaptureSchemaV1 } from '@tminuszero/contracts';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';
import {
  exchangeAppleAuthorizationCode,
  getAppleMobileClientId,
  getAppleWebClientId,
  isApplePrivateRelayEmail,
  isAppleSignInServerConfigured,
  upsertAppleSignInToken
} from '@/lib/server/appleAuth';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';

export class AppleAuthCaptureError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message?: string) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

export async function captureAppleAuthPayload(session: ResolvedViewerSession, request: Request) {
  if (!session.userId) {
    throw new AppleAuthCaptureError(401, 'unauthorized');
  }
  if (!isAppleSignInServerConfigured()) {
    throw new AppleAuthCaptureError(503, 'apple_sign_in_not_configured');
  }

  const parsed = appleAuthCaptureSchemaV1.parse(await request.json().catch(() => undefined));
  const admin = createSupabaseAdminClient();
  const normalizedEmail = parsed.email?.trim() || session.email || null;
  const emailIsPrivateRelay = parsed.emailIsPrivateRelay === true || isApplePrivateRelayEmail(normalizedEmail);

  if (parsed.source === 'ios_native_code') {
    const tokenResult = await exchangeAppleAuthorizationCode({
      authorizationCode: parsed.authorizationCode!,
      clientId: getAppleMobileClientId()
    });
    const tokenKind = tokenResult.refreshToken ? 'refresh_token' : 'access_token';
    const tokenValue = tokenResult.refreshToken || tokenResult.accessToken;
    if (!tokenValue) {
      throw new AppleAuthCaptureError(502, 'apple_token_exchange_failed');
    }

    const storedAt = await upsertAppleSignInToken(admin, {
      userId: session.userId,
      clientId: getAppleMobileClientId(),
      tokenKind,
      tokenValue,
      captureSource: parsed.source,
      appleUserId: parsed.appleUserId ?? null,
      email: normalizedEmail,
      emailIsPrivateRelay
    });

    return appleAuthCaptureResponseSchemaV1.parse({
      ok: true,
      tokenKind,
      storedAt
    });
  }

  const tokenKind = parsed.source === 'web_provider_refresh' ? 'refresh_token' : 'access_token';
  const storedAt = await upsertAppleSignInToken(admin, {
    userId: session.userId,
    clientId: getAppleWebClientId(),
    tokenKind,
    tokenValue: parsed.providerToken!,
    captureSource: parsed.source,
    appleUserId: parsed.appleUserId ?? null,
    email: normalizedEmail,
    emailIsPrivateRelay
  });

  return appleAuthCaptureResponseSchemaV1.parse({
    ok: true,
    tokenKind,
    storedAt
  });
}
