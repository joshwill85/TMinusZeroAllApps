import { NextResponse } from 'next/server';
import { buildIcs } from '@/lib/calendar/ics';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { getUserAccessEntitlementById } from '@/lib/server/entitlements';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';
import { slugify } from '@/lib/utils/slug';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id;
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  let launch = null;

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const rateLimited = await enforceDurableRateLimit(request, {
    scope: 'api_launch_ics',
    limit: 30,
    windowSeconds: 60,
    tokenKey: id
  });
  if (rateLimited) {
    return rateLimited;
  }

  const supabase = createSupabaseServerClient();
  const admin = isSupabaseAdminConfigured() ? createSupabaseAdminClient() : null;
  const viewer = await getViewerTier({ request, reconcileStripe: false });
  const tokenAuthorized = admin ? await validateCalendarToken(admin, token) : false;

  if (viewer.isAuthed) {
    if (!viewer.isAdmin && !viewer.capabilities.canUseOneOffCalendar && !tokenAuthorized) {
      return NextResponse.json({ error: 'payment_required' }, { status: 402 });
    }
  } else if (!tokenAuthorized) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data } = await supabase.from('launches_public_cache').select('*').eq('launch_id', id).maybeSingle();
  if (data) launch = mapPublicCacheRow(data);

  if (!launch && admin) {
    const { data } = await admin.from('launches').select('*').eq('id', id).eq('hidden', false).maybeSingle();
    if (data) launch = mapLiveLaunchRow(data);
  }

  if (!launch) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const ics = buildIcs(launch, { siteUrl: getSiteUrl() });
  const filename = `${launch.slug || slugify(launch.name) || launch.id}.ics`;
  const userAgent = request.headers.get('user-agent') || '';
  const disposition = tokenAuthorized || /iphone|ipad|ipod/i.test(userAgent) ? 'inline' : 'attachment';
  return new NextResponse(ics, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `${disposition}; filename="${filename}"`,
      'Cache-Control': 'public, max-age=300',
      Vary: 'User-Agent'
    }
  });
}

async function validateCalendarToken(supabase: ReturnType<typeof createSupabaseAdminClient>, token: string | null) {
  if (!token) return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return false;

  const { data, error } = await supabase.from('profiles').select('user_id').eq('calendar_token', token).maybeSingle();
  if (error) {
    console.error('calendar token validation error', error);
    return false;
  }
  const userId = String((data as { user_id?: string } | null)?.user_id || '').trim();
  if (!userId) return false;

  const access = await getUserAccessEntitlementById({ userId, admin: supabase });
  return access.loadError == null && access.entitlement?.isPaid === true;
}
