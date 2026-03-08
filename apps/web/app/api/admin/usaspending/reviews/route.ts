import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdminRequest } from '@/app/api/admin/_lib/auth';
import {
  listAdminUsaspendingReviews,
  promoteAdminUsaspendingReview
} from '@/lib/server/adminUsaspendingReviews';
import {
  ADMIN_USASPENDING_REVIEW_TIERS,
  ADMIN_USASPENDING_SCOPES,
  type AdminUsaspendingReviewTier,
  type AdminUsaspendingScope
} from '@/lib/types/adminUsaspending';

export const dynamic = 'force-dynamic';

const scopeSchema = z.enum(ADMIN_USASPENDING_SCOPES);
const tierSchema = z.enum(ADMIN_USASPENDING_REVIEW_TIERS);

const promoteSchema = z.object({
  action: z.literal('promote'),
  awardIdentityKey: z.string().min(1),
  programScope: scopeSchema
});

export async function GET(request: Request) {
  const auth = await requireAdminRequest({ requireServiceRole: true });
  if (!auth.ok) return auth.response;
  if (!auth.context.admin) {
    return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });
  }

  const { searchParams } = new URL(request.url);
  const scope = parseScope(searchParams.get('scope'));
  const tier = parseTier(searchParams.get('tier'));
  const offset = clampInt(searchParams.get('offset'), 0, 0, 100_000);
  const limit = clampInt(searchParams.get('limit'), 100, 1, 250);
  const query = readQuery(searchParams.get('query'));

  try {
    const response = await listAdminUsaspendingReviews(auth.context.admin, {
      scope,
      tier,
      offset,
      limit,
      query
    });

    return NextResponse.json(response, {
      headers: { 'Cache-Control': 'private, no-store' }
    });
  } catch (error) {
    console.error('admin usaspending reviews GET error', error);
    return NextResponse.json({ error: 'failed_to_load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRequest({ requireServiceRole: true });
  if (!auth.ok) return auth.response;
  if (!auth.context.admin) {
    return NextResponse.json({ error: 'supabase_admin_not_configured' }, { status: 501 });
  }

  const json = await request.json().catch(() => ({}));
  const parsed = promoteSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const promoted = await promoteAdminUsaspendingReview(auth.context.admin, parsed.data);
    if (!promoted) {
      return NextResponse.json({ error: 'review_not_found' }, { status: 404 });
    }

    return NextResponse.json(
      { ok: true, promoted },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    console.error('admin usaspending reviews POST error', error);
    return NextResponse.json({ error: 'failed_to_update' }, { status: 500 });
  }
}

function parseScope(value: string | null): AdminUsaspendingScope {
  const parsed = scopeSchema.safeParse(value);
  return parsed.success ? parsed.data : 'blue-origin';
}

function parseTier(value: string | null): AdminUsaspendingReviewTier {
  const parsed = tierSchema.safeParse(value);
  return parsed.success ? parsed.data : 'candidate';
}

function readQuery(value: string | null) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function clampInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}
