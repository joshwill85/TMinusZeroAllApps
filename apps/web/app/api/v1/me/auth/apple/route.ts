import { NextResponse } from 'next/server';
import { successResponseSchemaV1 } from '@tminuszero/contracts';
import { deleteStoredAppleSignInToken } from '@/lib/server/appleAuth';
import { createSupabaseAdminClient } from '@/lib/server/supabaseServer';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function DELETE(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    if (!session.userId) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    await deleteStoredAppleSignInToken(createSupabaseAdminClient(), session.userId);

    return NextResponse.json(successResponseSchemaV1.parse({ ok: true }), {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 apple auth cleanup failed', error);
    return NextResponse.json({ error: 'failed_to_clear' }, { status: 500 });
  }
}
