import { calendarTokenSchemaV1 } from '@tminuszero/contracts';
import { getViewerEntitlement } from '@/lib/server/entitlements';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import {
  createSupabaseAccessTokenClient,
  createSupabaseAdminClient,
  createSupabaseServerClient
} from '@/lib/server/supabaseServer';
import type { ResolvedViewerSession } from '@/lib/server/viewerSession';

type CalendarTokenClient =
  | ReturnType<typeof createSupabaseAccessTokenClient>
  | ReturnType<typeof createSupabaseAdminClient>
  | ReturnType<typeof createSupabaseServerClient>;

export class CalendarTokenRouteError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message?: string) {
    super(message ?? code);
    this.name = 'CalendarTokenRouteError';
    this.status = status;
    this.code = code;
  }
}

function getCalendarTokenClient(session: ResolvedViewerSession): CalendarTokenClient | null {
  if (isSupabaseAdminConfigured()) {
    return createSupabaseAdminClient();
  }

  if (session.authMode === 'bearer' && session.accessToken) {
    return createSupabaseAccessTokenClient(session.accessToken);
  }

  if (session.authMode === 'cookie') {
    return createSupabaseServerClient();
  }

  return null;
}

export async function loadCalendarTokenPayload(session: ResolvedViewerSession) {
  if (!isSupabaseConfigured()) {
    return calendarTokenSchemaV1.parse({ token: null, source: 'stub' });
  }

  if (!session.userId) {
    throw new CalendarTokenRouteError(401, 'unauthorized');
  }

  const { entitlement } = await getViewerEntitlement({ session, reconcileStripe: false });
  if (!entitlement.isAuthed || !session.userId) {
    throw new CalendarTokenRouteError(401, 'unauthorized');
  }
  if (!entitlement.capabilities.canUseRecurringCalendarFeeds) {
    throw new CalendarTokenRouteError(402, 'payment_required');
  }

  const client = getCalendarTokenClient(session);
  if (!client) {
    throw new CalendarTokenRouteError(401, 'unauthorized');
  }

  const { data, error } = await client.from('profiles').select('calendar_token').eq('user_id', session.userId).maybeSingle();
  if (error) {
    console.error('calendar token fetch error', error);
    throw new CalendarTokenRouteError(500, 'failed_to_load');
  }

  const existing = typeof data?.calendar_token === 'string' ? data.calendar_token : null;
  if (existing) {
    return calendarTokenSchemaV1.parse({ token: existing, source: 'db' });
  }

  const next = crypto.randomUUID();
  const { data: updated, error: updateError } = await client
    .from('profiles')
    .update({ calendar_token: next })
    .eq('user_id', session.userId)
    .select('calendar_token')
    .single();
  if (updateError) {
    console.error('calendar token update error', updateError);
    throw new CalendarTokenRouteError(500, 'failed_to_save');
  }

  return calendarTokenSchemaV1.parse({
    token: typeof updated?.calendar_token === 'string' ? updated.calendar_token : next,
    source: 'generated'
  });
}
