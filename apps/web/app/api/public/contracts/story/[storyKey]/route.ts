import { NextResponse } from 'next/server';
import { fetchContractStoryDetailByStoryKey } from '@/lib/server/programContractStories';

export const dynamic = 'force-dynamic';

type Params = {
  storyKey: string;
};

export async function GET(_request: Request, { params }: { params: Params }) {
  const storyKey = normalizeStoryKey(params.storyKey);
  if (!storyKey) {
    return NextResponse.json({ error: 'invalid_story_key' }, { status: 400 });
  }

  try {
    const payload = await fetchContractStoryDetailByStoryKey(storyKey);
    if (!payload) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=21600, stale-if-error=86400'
      }
    });
  } catch (error) {
    console.error('contract story detail api error', error);
    return NextResponse.json({ error: 'contract_story_detail_failed' }, { status: 500 });
  }
}

function normalizeStoryKey(value: string | null | undefined) {
  if (!value) return null;
  try {
    const decoded = decodeURIComponent(value);
    const trimmed = decoded.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}
