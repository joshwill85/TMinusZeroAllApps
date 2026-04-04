import { NextResponse } from 'next/server';
import { appleAuthCaptureSchemaV1 } from '@tminuszero/contracts';
import { captureAppleSignInTokenForUser, isApplePrivateRelayEmail } from '@/lib/server/appleAuth';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await resolveViewerSession(request);
  if (!session.userId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = appleAuthCaptureSchemaV1.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  try {
    const admin = createSupabaseAdminClient();
    const normalizedEmail = parsed.data.email?.trim() || session.email || null;
    const result = await captureAppleSignInTokenForUser(admin, {
      userId: session.userId,
      source: parsed.data.source,
      authorizationCode: parsed.data.authorizationCode,
      providerToken: parsed.data.providerToken,
      appleUserId: parsed.data.appleUserId ?? null,
      email: normalizedEmail,
      emailIsPrivateRelay: parsed.data.emailIsPrivateRelay === true || isApplePrivateRelayEmail(normalizedEmail)
    });

    return NextResponse.json(
      {
        ok: true,
        tokenKind: result.tokenKind,
        storedAt: result.storedAt
      },
      {
        headers: {
          'Cache-Control': 'private, no-store'
        }
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to store Apple sign-in token.';
    const normalized = message.toLowerCase();

    if (normalized.includes('not configured')) {
      return NextResponse.json({ error: 'apple_server_not_configured' }, { status: 503 });
    }
    if (normalized.includes('apple token exchange') || normalized.includes('revocable token')) {
      return NextResponse.json({ error: 'apple_token_exchange_failed' }, { status: 502 });
    }

    console.error('apple auth capture failed', error);
    return NextResponse.json({ error: 'failed_to_store' }, { status: 500 });
  }
}
