import { NextResponse } from 'next/server';
import { createAlertRulePayload, loadAlertRulesPayload, MobileApiRouteError } from '@/lib/server/v1/mobileApi';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadAlertRulesPayload(session);
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    console.error('v1 alert rules failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await createAlertRulePayload(session, request);
    if (!payload) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(payload, {
      status: 201,
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof MobileApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 alert rule create failed', error);
    return NextResponse.json({ error: 'failed_to_save' }, { status: 500 });
  }
}
