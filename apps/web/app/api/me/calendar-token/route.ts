import { NextResponse } from 'next/server';
import { CalendarTokenRouteError, loadCalendarTokenPayload } from '@/lib/server/calendarTokens';
import { resolveViewerSession } from '@/lib/server/viewerSession';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const session = await resolveViewerSession(request);
    const payload = await loadCalendarTokenPayload(session);
    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'private, no-store'
      }
    });
  } catch (error) {
    if (error instanceof CalendarTokenRouteError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('calendar token route failed', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}
