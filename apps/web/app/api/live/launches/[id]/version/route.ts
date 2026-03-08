import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';
import { getViewerTier } from '@/lib/server/viewerTier';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const viewer = await getViewerTier();
  if (!viewer.isAuthed) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (viewer.tier !== 'premium') {
    return NextResponse.json({ error: 'payment_required' }, { status: 402 });
  }

  const launchId = params.id;
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('launches')
    .select('id, last_updated_source')
    .eq('id', launchId)
    .maybeSingle();

  if (error) {
    console.error('launch version fetch error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }

  return NextResponse.json(
    {
      launchId,
      lastUpdated: data?.last_updated_source ?? null
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
