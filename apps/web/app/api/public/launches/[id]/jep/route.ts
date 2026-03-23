import { NextResponse } from 'next/server';
import { z } from 'zod';
import { enforceDurableRateLimit } from '@/lib/server/apiRateLimit';
import { canAttemptTransientJepPersonalization, fetchLaunchJepScore } from '@/lib/server/jep';
import {
  resolveJepObserverFromBody,
  resolveJepObserverFromHeaders,
  resolveJepObserverFromUrl
} from '@/lib/server/jepObserver';
import { parseLaunchParam } from '@/lib/utils/launchParams';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_BODY_BYTES = 1_024;
const bodySchema = z.object({}).passthrough();

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const parsed = parseLaunchParam(params.id);
  if (!parsed) return NextResponse.json({ error: 'invalid_launch_id' }, { status: 400 });

  try {
    const url = new URL(request.url);
    const explicitObserver = resolveJepObserverFromUrl(url);
    const observer = explicitObserver || resolveJepObserverFromHeaders(request.headers);
    const allowTransientCompute = await canAttemptTransientJepPersonalization(explicitObserver);
    if (allowTransientCompute) {
      const rateLimited = await enforceDurableRateLimit(request, {
        scope: 'launch_jep_transient_get',
        limit: 4,
        windowSeconds: 300,
        tokenKey: `${parsed.launchId}:${explicitObserver!.locationHash}`
      });
      if (rateLimited) return rateLimited;
    }

    const score = await fetchLaunchJepScore(parsed.launchId, { observer, allowTransientCompute });
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
    const raw = await readJsonLimited(request);
    if (!raw.ok) {
      return NextResponse.json(
        { error: raw.error },
        { status: raw.error === 'body_too_large' ? 413 : 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const parsedBody = bodySchema.safeParse(raw.json);
    if (!parsedBody.success) {
      return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    const explicitObserver = resolveJepObserverFromBody(parsedBody.data);
    const observer = explicitObserver || resolveJepObserverFromHeaders(request.headers);
    const allowTransientCompute = await canAttemptTransientJepPersonalization(explicitObserver);
    if (allowTransientCompute) {
      const rateLimited = await enforceDurableRateLimit(request, {
        scope: 'launch_jep_transient_post',
        limit: 6,
        windowSeconds: 300,
        tokenKey: `${parsed.launchId}:${explicitObserver!.locationHash}`
      });
      if (rateLimited) return rateLimited;
    }

    const score = await fetchLaunchJepScore(parsed.launchId, { observer, allowTransientCompute });
    if (!score) {
      return NextResponse.json({ error: 'jep_not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json(score, {
      headers: {
        'Cache-Control': 'no-store'
      }
    });
  } catch (error) {
    console.error('launch jep api post error', error);
    return NextResponse.json({ error: 'jep_fetch_failed' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function readJsonLimited(request: Request) {
  const contentLength = request.headers.get('content-length');
  if (contentLength) {
    const n = Number(contentLength);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) return { ok: false as const, error: 'body_too_large' as const };
  }

  const text = await request.text().catch(() => '');
  if (!text) return { ok: true as const, json: {} };
  const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  if (bytes > MAX_BODY_BYTES) return { ok: false as const, error: 'body_too_large' as const };

  try {
    return { ok: true as const, json: JSON.parse(text) };
  } catch {
    return { ok: false as const, error: 'invalid_body' as const };
  }
}
