import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AccountDeletionError, deleteAccountWithGuards } from '@/lib/server/accountDeletion';
import { createSupabaseServerClient } from '@/lib/server/supabaseServer';
import { isSupabaseConfigured } from '@/lib/server/env';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  confirm: z.string().min(1)
});

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const payload = await deleteAccountWithGuards({
      userId: user.id,
      email: user.email ?? null,
      confirm: parsed.data.confirm
    });
    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AccountDeletionError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    console.error('account delete error', error);
    return NextResponse.json({ error: 'failed_to_delete' }, { status: 500 });
  }
}
