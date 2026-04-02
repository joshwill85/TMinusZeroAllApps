import { NextResponse } from 'next/server';
import { z } from 'zod';
import { loadDiscountCampaigns, summarizeDiscountCampaigns } from '@/lib/server/discountCampaigns';
import { isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';

export const dynamic = 'force-dynamic';

const campaignStatusSchema = z.enum(['draft', 'active', 'paused', 'ended', 'sync_error']);
const campaignKindSchema = z.enum(['promo_code', 'store_offer']);
const targetingKindSchema = z.enum(['all_users', 'new_subscribers', 'lapsed_subscribers', 'specific_users']);
const providerSchema = z.enum(['stripe', 'apple_app_store', 'google_play']);
const artifactKindSchema = z.enum([
  'stripe_coupon',
  'stripe_promotion_code',
  'apple_offer_code',
  'apple_promotional_offer',
  'apple_win_back_offer',
  'google_offer',
  'google_promo_code'
]);

const createCampaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  productKey: z.literal('premium_monthly').default('premium_monthly'),
  campaignKind: campaignKindSchema,
  targetingKind: targetingKindSchema,
  status: campaignStatusSchema.default('draft'),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  headline: z.string().trim().max(120).optional(),
  body: z.string().trim().max(400).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
  targetEmails: z.array(z.string().trim().email()).max(200).optional(),
  targetUserIds: z.array(z.string().uuid()).max(200).optional()
});

const patchSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_status'),
    campaignId: z.string().uuid(),
    status: campaignStatusSchema
  }),
  z.object({
    action: z.literal('attach_artifact'),
    campaignId: z.string().uuid(),
    provider: providerSchema,
    artifactKind: artifactKindSchema,
    status: campaignStatusSchema.default('draft'),
    externalId: z.string().trim().min(1).max(200).optional(),
    externalCode: z.string().trim().min(1).max(200).optional(),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
    label: z.string().trim().max(120).optional(),
    eligibilityHint: z.string().trim().max(120).optional(),
    offerIdentifier: z.string().trim().max(200).optional(),
    redemptionUrl: z.string().url().optional(),
    basePlanId: z.string().trim().max(200).optional(),
    offerId: z.string().trim().max(200).optional(),
    offerToken: z.string().trim().max(400).optional(),
    promotionCode: z.string().trim().max(200).optional()
  })
]);

function normalizeNullableString(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  return normalized || null;
}

function normalizeIsoDate(value: string | null | undefined) {
  const normalized = normalizeNullableString(value);
  if (!normalized) return null;
  return new Date(normalized).toISOString();
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function artifactMatchesProvider(provider: z.infer<typeof providerSchema>, artifactKind: z.infer<typeof artifactKindSchema>) {
  if (provider === 'stripe') return artifactKind === 'stripe_coupon' || artifactKind === 'stripe_promotion_code';
  if (provider === 'apple_app_store') return artifactKind.startsWith('apple_');
  return artifactKind.startsWith('google_');
}

function buildArtifactPayload(parsed: z.infer<typeof patchSchema> & { action: 'attach_artifact' }) {
  return Object.fromEntries(
    Object.entries({
      label: normalizeNullableString(parsed.label),
      eligibilityHint: normalizeNullableString(parsed.eligibilityHint),
      offerIdentifier: normalizeNullableString(parsed.offerIdentifier),
      redemptionUrl: normalizeNullableString(parsed.redemptionUrl),
      basePlanId: normalizeNullableString(parsed.basePlanId),
      offerId: normalizeNullableString(parsed.offerId),
      offerToken: normalizeNullableString(parsed.offerToken),
      promotionCode: normalizeNullableString(parsed.promotionCode)
    }).filter(([, value]) => value !== null)
  );
}

async function requireAdmin() {
  if (!isSupabaseConfigured() || !isSupabaseAdminConfigured()) {
    return { error: NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 }), admin: null, userId: null as string | null };
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), admin: null, userId: null as string | null };
  }

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') {
    return { error: NextResponse.json({ error: 'forbidden' }, { status: 403 }), admin: null, userId: null as string | null };
  }

  return { error: null, admin: createSupabaseAdminClient(), userId: user.id };
}

export async function GET() {
  const auth = await requireAdmin();
  if (auth.error || !auth.admin) {
    return auth.error!;
  }

  const { campaigns, loadError } = await loadDiscountCampaigns(auth.admin);
  if (loadError) {
    return NextResponse.json({ error: loadError }, { status: 500 });
  }

  return NextResponse.json(
    {
      campaigns,
      summary: summarizeDiscountCampaigns(campaigns)
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (auth.error || !auth.admin || !auth.userId) {
    return auth.error!;
  }

  const json = await request.json().catch(() => ({}));
  const parsed = createCampaignSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });
  }

  const slug = normalizeNullableString(parsed.data.slug) ?? slugify(parsed.data.name);
  if (!slug) {
    return NextResponse.json({ error: 'invalid_slug' }, { status: 400 });
  }

  const targetEmails = Array.from(new Set((parsed.data.targetEmails ?? []).map((email) => email.trim().toLowerCase())));
  const targetUserIds = Array.from(new Set(parsed.data.targetUserIds ?? []));
  if (parsed.data.targetingKind === 'specific_users' && targetEmails.length === 0 && targetUserIds.length === 0) {
    return NextResponse.json({ error: 'specific_targets_required' }, { status: 400 });
  }

  const insertResult = await auth.admin
    .from('discount_campaigns')
    .insert({
      slug,
      name: parsed.data.name.trim(),
      product_key: parsed.data.productKey,
      campaign_kind: parsed.data.campaignKind,
      targeting_kind: parsed.data.targetingKind,
      status: parsed.data.status,
      starts_at: normalizeIsoDate(parsed.data.startsAt),
      ends_at: normalizeIsoDate(parsed.data.endsAt),
      display_copy: {
        headline: normalizeNullableString(parsed.data.headline),
        body: normalizeNullableString(parsed.data.body)
      },
      internal_notes: normalizeNullableString(parsed.data.internalNotes),
      created_by: auth.userId,
      updated_by: auth.userId,
      updated_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (insertResult.error) {
    console.error('discount campaign create error', insertResult.error);
    const message = String(insertResult.error.message || '').toLowerCase();
    if (message.includes('duplicate') || message.includes('unique')) {
      return NextResponse.json({ error: 'slug_already_exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'failed_to_create_campaign' }, { status: 500 });
  }

  const campaignId = insertResult.data.id;
  const targetRows = [
    ...targetUserIds.map((userId) => ({
      campaign_id: campaignId,
      user_id: userId,
      email: null,
      updated_at: new Date().toISOString()
    })),
    ...targetEmails.map((email) => ({
      campaign_id: campaignId,
      user_id: null,
      email,
      updated_at: new Date().toISOString()
    }))
  ];

  if (targetRows.length > 0) {
    const targetInsert = await auth.admin.from('discount_campaign_targets').insert(targetRows);
    if (targetInsert.error) {
      console.error('discount campaign targets create error', targetInsert.error);
      return NextResponse.json({ error: 'failed_to_create_targets' }, { status: 500 });
    }
  }

  const { campaigns } = await loadDiscountCampaigns(auth.admin);
  const campaign = campaigns.find((entry) => entry.id === campaignId) ?? null;

  return NextResponse.json({ campaign }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function PATCH(request: Request) {
  const auth = await requireAdmin();
  if (auth.error || !auth.admin || !auth.userId) {
    return auth.error!;
  }

  const json = await request.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });
  }

  if (parsed.data.action === 'set_status') {
    const updateResult = await auth.admin
      .from('discount_campaigns')
      .update({
        status: parsed.data.status,
        updated_by: auth.userId,
        updated_at: new Date().toISOString()
      })
      .eq('id', parsed.data.campaignId);

    if (updateResult.error) {
      console.error('discount campaign status update error', updateResult.error);
      return NextResponse.json({ error: 'failed_to_update_campaign' }, { status: 500 });
    }

    const { campaigns } = await loadDiscountCampaigns(auth.admin);
    return NextResponse.json({
      campaign: campaigns.find((entry) => entry.id === parsed.data.campaignId) ?? null
    });
  }

  if (!artifactMatchesProvider(parsed.data.provider, parsed.data.artifactKind)) {
    return NextResponse.json({ error: 'provider_artifact_mismatch' }, { status: 400 });
  }

  if (!normalizeNullableString(parsed.data.externalId) && !normalizeNullableString(parsed.data.externalCode)) {
    return NextResponse.json({ error: 'external_reference_required' }, { status: 400 });
  }

  const upsertResult = await auth.admin.from('discount_campaign_provider_artifacts').upsert(
    {
      campaign_id: parsed.data.campaignId,
      provider: parsed.data.provider,
      artifact_kind: parsed.data.artifactKind,
      status: parsed.data.status,
      external_id: normalizeNullableString(parsed.data.externalId),
      external_code: normalizeNullableString(parsed.data.externalCode),
      payload: buildArtifactPayload(parsed.data),
      starts_at: normalizeIsoDate(parsed.data.startsAt),
      ends_at: normalizeIsoDate(parsed.data.endsAt),
      updated_at: new Date().toISOString()
    },
    { onConflict: 'campaign_id,provider,artifact_kind' }
  );

  if (upsertResult.error) {
    console.error('discount campaign artifact upsert error', upsertResult.error);
    return NextResponse.json({ error: 'failed_to_attach_artifact' }, { status: 500 });
  }

  const campaignTouchResult = await auth.admin
    .from('discount_campaigns')
    .update({
      updated_by: auth.userId,
      updated_at: new Date().toISOString()
    })
    .eq('id', parsed.data.campaignId);

  if (campaignTouchResult.error) {
    console.error('discount campaign touch error', campaignTouchResult.error);
  }

  const { campaigns } = await loadDiscountCampaigns(auth.admin);
  return NextResponse.json({
    campaign: campaigns.find((entry) => entry.id === parsed.data.campaignId) ?? null
  });
}
