import { NextResponse } from 'next/server';
import { buildIcs } from '@/lib/calendar/ics';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { mapLiveLaunchRow, mapPublicCacheRow } from '@/lib/server/transformers';
import { getSiteUrl, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { slugify } from '@/lib/utils/slug';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const id = params.id;
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
  const disposition = /iphone|ipad|ipod/i.test(userAgent) ? 'inline' : 'attachment';
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
