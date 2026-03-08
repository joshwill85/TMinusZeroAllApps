import { createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { stripe } from '@/lib/api/stripe';
import { createSupabaseAdminClient, createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isStripeConfigured, isSupabaseAdminConfigured, isSupabaseConfigured } from '@/lib/server/env';
export const dynamic = 'force-dynamic';

const createSchema = z.object({
  code: z.string().trim().min(3).max(32),
  percentOff: z.number().int().min(1).max(100).optional(),
  amountOff: z.number().int().min(1).optional(),
  currency: z.string().length(3).optional(),
  duration: z.enum(['once', 'repeating', 'forever']),
  durationInMonths: z.number().int().min(1).max(36).optional(),
  maxRedemptions: z.number().int().min(1).max(100000).optional(),
  restrictedUserEmail: z.string().trim().email().optional(),
  restrictedUserId: z.string().uuid().optional()
});

const updateSchema = z.object({
  promotionCodeId: z.string().min(1),
  active: z.boolean()
});

const CODE_PATTERN = /^[A-Z0-9_-]+$/;

function normalizeCode(raw: string) {
  const trimmed = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

function buildIdempotencyKey(prefix: string, payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload, Object.keys(payload).sort());
  const hash = createHash('sha256').update(raw).digest('hex').slice(0, 32);
  return `${prefix}_${hash}`;
}

function mapCoupon(coupon: { id: string; name: string | null; percent_off: number | null; amount_off: number | null; currency: string | null; duration: string; duration_in_months: number | null; valid: boolean; max_redemptions: number | null; times_redeemed: number | null }) {
  return {
    id: coupon.id,
    name: coupon.name,
    percent_off: coupon.percent_off,
    amount_off: coupon.amount_off,
    currency: coupon.currency,
    duration: coupon.duration,
    duration_in_months: coupon.duration_in_months,
    valid: coupon.valid,
    max_redemptions: coupon.max_redemptions,
    times_redeemed: coupon.times_redeemed
  };
}

function mapPromotionCode(promo: {
  id: string;
  code: string | null;
  active: boolean;
  max_redemptions: number | null;
  times_redeemed: number | null;
  customer: string | { id: string } | null;
  metadata?: Record<string, string> | null;
  restrictions?: unknown | null;
  coupon: string | { id: string; name: string | null };
}) {
  const coupon = typeof promo.coupon === 'string' ? { id: promo.coupon, name: null } : { id: promo.coupon.id, name: promo.coupon.name ?? null };
  const customer = typeof promo.customer === 'string' ? promo.customer : promo.customer?.id ?? null;
  return {
    id: promo.id,
    code: promo.code,
    active: promo.active,
    max_redemptions: promo.max_redemptions,
    times_redeemed: promo.times_redeemed,
    customer,
    metadata: promo.metadata ?? null,
    restrictions: promo.restrictions ?? null,
    coupon
  };
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const [coupons, promotionCodes] = await Promise.all([
    stripe.coupons.list({ limit: 50 }),
    stripe.promotionCodes.list({ limit: 50 })
  ]);

  return NextResponse.json(
    {
      coupons: coupons.data.map((c) => mapCoupon(c)),
      promotionCodes: promotionCodes.data.map((p) => mapPromotionCode(p))
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const json = await request.json().catch(() => ({}));
  const parsed = createSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });

  const { percentOff, amountOff, currency, duration, durationInMonths, maxRedemptions } = parsed.data;
  const code = normalizeCode(parsed.data.code);
  if (!code) {
    return NextResponse.json({ error: 'invalid_code' }, { status: 400 });
  }
  if (!percentOff && !amountOff) {
    return NextResponse.json({ error: 'missing_discount' }, { status: 400 });
  }
  if (percentOff && amountOff) {
    return NextResponse.json({ error: 'choose_one_discount' }, { status: 400 });
  }
  if (duration === 'repeating' && !durationInMonths) {
    return NextResponse.json({ error: 'duration_in_months_required' }, { status: 400 });
  }

  const existingPromo = await stripe.promotionCodes.list({ code, limit: 1 });
  if (existingPromo.data.length > 0) {
    const promo = existingPromo.data[0];
    const coupon = typeof promo.coupon === 'string' ? await stripe.coupons.retrieve(promo.coupon) : promo.coupon;
    return NextResponse.json(
      {
        error: 'code_already_exists',
        existing: {
          coupon: mapCoupon(coupon),
          promotionCode: mapPromotionCode({ ...promo, coupon })
        }
      },
      { status: 409 }
    );
  }

  const restrictedUserEmail = parsed.data.restrictedUserEmail?.trim() || null;
  const restrictedUserId = parsed.data.restrictedUserId?.trim() || null;
  let restrictedCustomerId: string | null = null;
  let restrictedMeta: { userId?: string; email?: string | null } | null = null;

  if (restrictedUserEmail || restrictedUserId) {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json({ error: 'supabase_service_role_missing' }, { status: 503 });
    }
    const admin = createSupabaseAdminClient();
    let userId = restrictedUserId;
    let email = restrictedUserEmail;

    if (!userId && restrictedUserEmail) {
      const { data: profile } = await admin
        .from('profiles')
        .select('user_id,email')
        .ilike('email', restrictedUserEmail)
        .maybeSingle();
      if (!profile?.user_id) {
        return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
      }
      userId = profile.user_id;
      email = profile.email ?? restrictedUserEmail;
    }

    if (!userId) {
      return NextResponse.json({ error: 'user_not_found' }, { status: 404 });
    }

    const { data: mapping, error: mappingError } = await admin
      .from('stripe_customers')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (mappingError) {
      console.error('stripe customer lookup error', mappingError);
      return NextResponse.json({ error: 'failed_to_resolve_customer' }, { status: 500 });
    }

    if (mapping?.stripe_customer_id) {
      restrictedCustomerId = mapping.stripe_customer_id;
    } else {
      const customer = await stripe.customers.create(
        {
          email: email ?? undefined,
          metadata: { user_id: userId }
        },
        {
          idempotencyKey: buildIdempotencyKey('customer', { userId, email })
        }
      );
      restrictedCustomerId = customer.id;
      const { error: upsertError } = await admin
        .from('stripe_customers')
        .upsert({ user_id: userId, stripe_customer_id: restrictedCustomerId }, { onConflict: 'user_id' });
      if (upsertError) {
        console.error('stripe customer upsert error', upsertError);
        return NextResponse.json({ error: 'failed_to_save_customer' }, { status: 500 });
      }
    }

    restrictedMeta = { userId, email };
  }

  const coupon = await stripe.coupons.create({
    duration,
    percent_off: percentOff,
    amount_off: amountOff,
    currency: amountOff ? (currency || 'usd') : undefined,
    duration_in_months: duration === 'repeating' ? durationInMonths : undefined,
    name: code
  }, {
    idempotencyKey: buildIdempotencyKey('coupon', {
      code,
      percentOff: percentOff ?? null,
      amountOff: amountOff ?? null,
      currency: amountOff ? (currency || 'usd') : null,
      duration,
      durationInMonths: duration === 'repeating' ? durationInMonths ?? null : null
    })
  });

  const promotionCode = await stripe.promotionCodes.create({
    coupon: coupon.id,
    code,
    max_redemptions: maxRedemptions ?? undefined,
    customer: restrictedCustomerId ?? undefined,
    metadata: restrictedMeta
      ? {
          restricted_user_id: restrictedMeta.userId ?? '',
          restricted_user_email: restrictedMeta.email ?? ''
        }
      : undefined,
    active: true
  }, {
    idempotencyKey: buildIdempotencyKey('promo', {
      code,
      coupon: coupon.id,
      maxRedemptions: maxRedemptions ?? null,
      customer: restrictedCustomerId ?? null
    })
  });

  return NextResponse.json({
    coupon: mapCoupon(coupon),
    promotionCode: mapPromotionCode(promotionCode)
  });
}

export async function PATCH(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: 'stripe_not_configured' }, { status: 503 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data: profile } = await supabase.from('profiles').select('role').eq('user_id', user.id).maybeSingle();
  if (profile?.role !== 'admin') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const json = await request.json().catch(() => ({}));
  const parsed = updateSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 });

  const promotionCode = await stripe.promotionCodes.update(parsed.data.promotionCodeId, {
    active: parsed.data.active
  });

  return NextResponse.json({ promotionCode: mapPromotionCode(promotionCode) });
}
