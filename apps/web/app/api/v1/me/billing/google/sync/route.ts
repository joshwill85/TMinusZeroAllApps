import { NextResponse } from 'next/server';
import { googleBillingSyncRequestSchemaV1 } from '@tminuszero/contracts';
import { BillingApiRouteError, syncGoogleBilling } from '@/lib/server/billingCore';
import { resolveViewerSession } from '@/lib/server/viewerSession';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = googleBillingSyncRequestSchemaV1.parse(await request.json());
    const response = await syncGoogleBilling(session, payload, request);
    if (!response) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof BillingApiRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('v1 google billing sync failed', error);
    return NextResponse.json({ error: 'failed_to_sync' }, { status: 500 });
  }
}
