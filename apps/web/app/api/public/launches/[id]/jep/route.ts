import { NextResponse } from 'next/server';
import { fetchLaunchJepScore } from '@/lib/server/jep';
import {
  resolveJepObserverFromBody,
  resolveJepObserverFromHeaders,
  resolveJepObserverFromUrl
} from '@/lib/server/jepObserver';
import { parseLaunchParam } from '@/lib/utils/launchParams';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  try {
    const url = new URL(request.url);
    const observer = resolveJepObserverFromUrl(url) || resolveJepObserverFromHeaders(request.headers);
    const score = await fetchLaunchJepScore(parsed.launchId, { observer });
    if (!score) {
      return NextResponse.json({ error: 'jep_not_found' }, { status: 404 });
    }

    return NextResponse.json(score, {
      headers: {
        'Cache-Control': observer ? 'no-store' : 'public, s-maxage=60, stale-while-revalidate=240, stale-if-error=3600'
      }
    });
  } catch (error) {
    console.error('launch jep api error', error);
    return NextResponse.json({ error: 'jep_fetch_failed' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  try {
    const body = await request.json().catch(() => null);
    const observer = resolveJepObserverFromBody(body) || resolveJepObserverFromHeaders(request.headers);
    const score = await fetchLaunchJepScore(parsed.launchId, { observer });
    if (!score) {
      return NextResponse.json({ error: 'jep_not_found' }, { status: 404 });
    }

    return NextResponse.json(score, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('launch jep api post error', error);
    return NextResponse.json({ error: 'jep_fetch_failed' }, { status: 500 });
  }
}
