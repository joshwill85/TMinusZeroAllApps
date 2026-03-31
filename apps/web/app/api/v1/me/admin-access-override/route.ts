import { NextResponse } from 'next/server';
import {
  loadAdminAccessOverridePayload,
  MobileApiRouteError,
  updateAdminAccessOverridePayload
} from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadAdminAccessOverridePayload(session);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobileApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 admin access override failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await updateAdminAccessOverridePayload(session, request);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobileApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 admin access override update failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}
